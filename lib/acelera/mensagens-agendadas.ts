/**
 * ACELERA (só do fork): mensagem agendada por conversa.
 *
 * Efeito colateral + retry = idempotência. A regra aqui é "no máximo uma vez":
 *  - o UPDATE condicional `pendente → enviando` é a trava; só um relógio ganha;
 *  - o id do agendamento é o id da mensagem (`internalMessageId`), segunda defesa;
 *  - falha não é retentada sozinha, e linha presa em `enviando` vira `falhou`
 *    pedindo conferência, porque não dá para saber se o canal recebeu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { ApiError } from "@/lib/api/types";
import { estadoDaJanela } from "@/lib/channels/janela";
import { ehOperante, STATUS_OPERANTE, statusDaOrgEmbutida } from "@/lib/organizacao/operante";

export const FUSO_DO_AGENDAMENTO = "America/Sao_Paulo";
const TETO_DE_ANTECEDENCIA_MS = 90 * 24 * 60 * 60 * 1000;
const LOTE_POR_RODADA = 50;
/** Maior que qualquer timeout de envio ao canal; abaixo disso a linha ainda pode estar saindo. */
const PRESA_APOS_MS = 10 * 60 * 1000;

export const criarAgendamentoSchema = z.object({
  corpo: z.string().trim().min(1).max(4096),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
});

/** Dia e hora de parede em São Paulo viram instante; data inexistente (31/02) vira null. */
export function instanteDoAgendamento(dia: string, hora: string): Date | null {
  const [ano, mes, diaDoMes] = dia.split("-").map(Number) as [number, number, number];
  const [h, minuto] = hora.split(":").map(Number) as [number, number];
  if (mes < 1 || mes > 12 || diaDoMes < 1 || h > 23 || minuto > 59) return null;
  const instante = instanteDe({ ano, mes, dia: diaDoMes, hora: h, minuto }, FUSO_DO_AGENDAMENTO);
  const lido = partesNoFuso(instante, FUSO_DO_AGENDAMENTO);
  return lido.mes === mes && lido.dia === diaDoMes ? instante : null;
}

export function recusaDoInstante(instante: Date | null, agora: Date): string | null {
  if (!instante) return "Data ou hora inválida.";
  if (instante.getTime() <= agora.getTime()) return "Escolha um dia e hora no futuro.";
  if (instante.getTime() - agora.getTime() > TETO_DE_ANTECEDENCIA_MS)
    return "Agende para no máximo 90 dias à frente.";
  return null;
}

export interface ConversaParaEnvio {
  status: string;
  last_inbound_at: string | null;
  contacts: { is_blocked: boolean | null; is_personal: boolean | null } | null;
  channel_sessions: { provider: string | null } | null;
}

const ENCERRADA = new Set(["closed", "resolved", "archived"]);

/**
 * Por que esta conversa não pode receber agora; null quando pode. A janela é
 * cobrada aqui porque o handler só a cobra de token e IA: o composer humano é
 * barrado pela tela, e no relógio não há tela nenhuma.
 */
export function motivoParaNaoEnviar(conversa: ConversaParaEnvio, agora: Date): string | null {
  if (ENCERRADA.has(conversa.status)) return "A conversa estava encerrada no horário agendado.";
  if (conversa.contacts?.is_blocked) return "O contato está bloqueado.";
  if (conversa.contacts?.is_personal) return "O contato está marcado como pessoal.";
  const janela = estadoDaJanela(
    conversa.channel_sessions?.provider ?? null,
    conversa.last_inbound_at,
    agora,
  );
  if (janela.tipo === "fechada")
    return "A janela de 24 horas da API oficial estava fechada: o cliente não escreveu nas últimas 24 horas.";
  return null;
}

interface MensagemDevolvida {
  id: string;
  status: string;
  error_message?: string | null;
}

interface EnvioDaAgendada {
  organizationId: string;
  conversationId: string;
  agendamentoId: string;
  autorId: string;
  corpo: string;
}

export type EnviarAgendada = (envio: EnvioDaAgendada) => Promise<MensagemDevolvida>;

interface LinhaVencida {
  id: string;
  organization_id: string;
  conversation_id: string;
  corpo: string;
  criado_por: string;
  organizations: unknown;
}

export interface ResultadoDaRodada {
  enviadas: number;
  falhas: number;
  destravadas: number;
}

async function concluir(
  admin: SupabaseClient,
  linha: { id: string; organization_id: string },
  campos: { status: "enviada" | "falhou"; motivo_falha?: string; message_id?: string },
  agora: Date,
): Promise<void> {
  const { error } = await admin
    .from("mensagens_agendadas")
    .update({ ...campos, concluida_em: agora.toISOString() })
    .eq("id", linha.id)
    .eq("organization_id", linha.organization_id)
    .eq("status", "enviando");
  // A linha fica em `enviando` e a rodada seguinte a destrava como `falhou`: nunca reenvia.
  if (error) throw new Error(`Não foi possível registrar o desfecho: ${error.message}`);
}

/** Quem morreu no meio do envio não volta para `pendente`: reenviar poderia duplicar. */
async function destravarPresas(admin: SupabaseClient, agora: Date): Promise<number> {
  const { data, error } = await admin
    .from("mensagens_agendadas")
    .update({
      status: "falhou",
      motivo_falha:
        "O envio foi interrompido e pode ou não ter saído. Confira a conversa antes de enviar de novo.",
      concluida_em: agora.toISOString(),
    })
    .eq("status", "enviando")
    .lt("travada_em", new Date(agora.getTime() - PRESA_APOS_MS).toISOString())
    .select("id");
  if (error) throw new Error(`Não foi possível destravar agendamentos: ${error.message}`);
  return data?.length ?? 0;
}

async function autorAindaEhDaOrganizacao(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

function motivoDoEnvio(mensagem: MensagemDevolvida): string | null {
  if (["sent", "delivered", "read"].includes(mensagem.status)) return null;
  return (
    mensagem.error_message ??
    "O canal não confirmou o envio. Confira a conexão do WhatsApp e a conversa."
  );
}

async function processar(
  admin: SupabaseClient,
  linha: LinhaVencida,
  agora: Date,
  enviar: EnviarAgendada,
): Promise<"enviada" | "falhou"> {
  const falhar = async (motivo_falha: string) => {
    await concluir(admin, linha, { status: "falhou", motivo_falha }, agora);
    return "falhou" as const;
  };
  try {
    if (!(await autorAindaEhDaOrganizacao(admin, linha.organization_id, linha.criado_por)))
      return await falhar("Quem agendou não faz mais parte da organização.");
    const { data, error } = await admin
      .from("conversations")
      .select(
        "status, last_inbound_at, contacts:contact_id(is_blocked, is_personal), channel_sessions:channel_session_id(provider)",
      )
      .eq("id", linha.conversation_id)
      .eq("organization_id", linha.organization_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return await falhar("A conversa não existe mais.");
    const motivo = motivoParaNaoEnviar(data as unknown as ConversaParaEnvio, agora);
    if (motivo) return await falhar(motivo);
    const mensagem = await enviar({
      organizationId: linha.organization_id,
      conversationId: linha.conversation_id,
      agendamentoId: linha.id,
      autorId: linha.criado_por,
      corpo: linha.corpo,
    });
    const recusa = motivoDoEnvio(mensagem);
    if (recusa) {
      await concluir(
        admin,
        linha,
        { status: "falhou", motivo_falha: recusa, message_id: mensagem.id },
        agora,
      );
      return "falhou";
    }
    await concluir(admin, linha, { status: "enviada", message_id: mensagem.id }, agora);
    return "enviada";
  } catch (erro) {
    return await falhar(
      erro instanceof ApiError ? erro.message : "Erro inesperado ao enviar. Confira a conversa.",
    );
  }
}

export async function rodarMensagensAgendadas(
  admin: SupabaseClient,
  agora: Date,
  enviar: EnviarAgendada,
): Promise<ResultadoDaRodada> {
  const destravadas = await destravarPresas(admin, agora);
  const { data, error } = await admin
    .from("mensagens_agendadas")
    .select(
      "id, organization_id, conversation_id, corpo, criado_por, organizations:organization_id!inner(status)",
    )
    .eq("status", "pendente")
    .eq("organizations.status", STATUS_OPERANTE)
    .lte("enviar_em", agora.toISOString())
    .order("enviar_em", { ascending: true })
    .limit(LOTE_POR_RODADA);
  if (error) throw new Error(`Não foi possível ler os agendamentos: ${error.message}`);

  const resultado: ResultadoDaRodada = { enviadas: 0, falhas: 0, destravadas };
  for (const linha of (data ?? []) as LinhaVencida[]) {
    if (!ehOperante(statusDaOrgEmbutida(linha.organizations as never))) continue;
    // A TRAVA: duas rodadas leem a mesma linha, só uma recebe a linha de volta aqui.
    const { data: travada, error: erroDaTrava } = await admin
      .from("mensagens_agendadas")
      .update({ status: "enviando", travada_em: new Date().toISOString() })
      .eq("id", linha.id)
      .eq("organization_id", linha.organization_id)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();
    if (erroDaTrava) throw new Error(`Não foi possível travar: ${erroDaTrava.message}`);
    if (!travada) continue;
    if ((await processar(admin, linha, agora, enviar)) === "enviada") resultado.enviadas += 1;
    else resultado.falhas += 1;
  }
  return resultado;
}
