/**
 * (Acelera) Traz o acervo do WhatsApp para a conversa de quem já é lead.
 *
 * Só contato com negócio entra: o número também tem conversa pessoal, e ela não
 * pertence ao CRM. Só o que é mais antigo que a primeira mensagem viva da
 * conversa entra: o resto o webhook já gravou. Toda linha leva
 * `metadata.historico_importado`, que os gatilhos de `messages` leem para não
 * tratar o passado como atendimento (acelera_0003).
 *
 * Mídia não é baixada: a linha guarda o texto ou um aviso de que havia mídia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MensagemDoAcervo } from "@/lib/waha/client";
import { bareWaMessageId } from "@/lib/waha/message-id";

const TAMANHO_DA_PAGINA = 100;
/** Teto por contato, o mesmo do dossiê que consome estas mensagens. */
const LIMITE_POR_CONTATO = 5_000;
const AVISO_DE_MIDIA = "[Mídia do histórico não importada]";
const VIOLACAO_DE_UNICIDADE = "23505";

export interface CanalDoAcervo {
  checkContactExists(
    session: string,
    phoneDigits: string,
  ): Promise<{ numberExists: boolean; chatId?: string | null }>;
  listarMensagensDoChat(
    session: string,
    chatId: string,
    pagina: { limit: number; offset: number },
  ): Promise<MensagemDoAcervo[]>;
}

export interface SessaoDoAcervo {
  organizationId: string;
  canalId: string;
  nomeDaSessao: string;
}

export interface ContatoDoAcervo {
  id: string;
  phone_number: string | null;
}

export interface ResultadoDoContato {
  importadas: number;
  repetidas: number;
  conversa_criada: boolean;
  sem_whatsapp: boolean;
}

/** Linha de `messages`, ou `null` para o que não é fala (reação, aviso vazio). */
export function linhaDoHistorico(
  mensagem: MensagemDoAcervo,
  destino: { organizationId: string; canalId: string; contatoId: string; conversaId: string },
): Record<string, unknown> | null {
  const texto = mensagem.body?.trim() || null;
  if (!mensagem.id || !mensagem.timestamp || (!texto && !mensagem.hasMedia)) return null;
  const quando = new Date(mensagem.timestamp * 1000).toISOString();
  return {
    organization_id: destino.organizationId,
    channel_session_id: destino.canalId,
    contact_id: destino.contatoId,
    conversation_id: destino.conversaId,
    // A mesma forma do webhook: entrada com id completo, saída com a cauda.
    external_id: mensagem.fromMe ? bareWaMessageId(mensagem.id) : mensagem.id,
    direction: mensagem.fromMe ? "outbound" : "inbound",
    sent_via: mensagem.fromMe ? "external_device" : "crm",
    status: mensagem.fromMe ? "sent" : "received",
    type: mensagem.hasMedia ? "document" : "text",
    body: texto ?? AVISO_DE_MIDIA,
    sent_at: quando,
    created_at: quando,
    metadata: { historico_importado: true },
  };
}

/** Conversa existente, ou uma nova fechada: fechada não entra na fila de atendimento. */
async function conversaDoContato(
  db: SupabaseClient,
  sessao: SessaoDoAcervo,
  contatoId: string,
): Promise<{ id: string; criada: boolean }> {
  const { data: existente, error } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", sessao.organizationId)
    .eq("contact_id", contatoId)
    .eq("channel_session_id", sessao.canalId)
    .eq("is_group", false)
    .maybeSingle();
  if (error) throw new Error(`conversa_${error.code}`);
  if (existente) return { id: existente.id as string, criada: false };

  const { data: nova, error: erroAoCriar } = await db
    .from("conversations")
    .insert({
      organization_id: sessao.organizationId,
      contact_id: contatoId,
      channel_session_id: sessao.canalId,
      status: "closed",
    })
    .select("id")
    .single();
  if (erroAoCriar) throw new Error(`conversa_${erroAoCriar.code}`);
  return { id: nova.id as string, criada: true };
}

/** A primeira mensagem viva: dela para frente, o webhook é a fonte. */
async function inicioDaConversaViva(
  db: SupabaseClient,
  organizationId: string,
  conversaId: string,
): Promise<number> {
  const { data, error } = await db
    .from("messages")
    .select("sent_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversaId)
    .or("metadata->>historico_importado.is.null,metadata->>historico_importado.neq.true")
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`inicio_${error.code}`);
  return data ? new Date(data.sent_at as string).getTime() : Number.POSITIVE_INFINITY;
}

/** Idempotente: repetir encontra o `external_id` já gravado e segue. */
export async function importarHistoricoDoContato(
  db: SupabaseClient,
  canal: CanalDoAcervo,
  sessao: SessaoDoAcervo,
  contato: ContatoDoAcervo,
): Promise<ResultadoDoContato> {
  const resultado: ResultadoDoContato = {
    importadas: 0,
    repetidas: 0,
    conversa_criada: false,
    sem_whatsapp: false,
  };
  const digitos = contato.phone_number?.replace(/\D/g, "");
  if (!digitos) return { ...resultado, sem_whatsapp: true };
  // O nono dígito do cadastro nem sempre é o do WhatsApp: o canal diz qual é o chat.
  const chat = await canal.checkContactExists(sessao.nomeDaSessao, digitos);
  if (!chat.numberExists || !chat.chatId) return { ...resultado, sem_whatsapp: true };

  let conversa: { id: string; criada: boolean } | null = null;
  let limiteMs = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < LIMITE_POR_CONTATO; offset += TAMANHO_DA_PAGINA) {
    const pagina = await canal.listarMensagensDoChat(sessao.nomeDaSessao, chat.chatId, {
      limit: TAMANHO_DA_PAGINA,
      offset,
    });
    if (pagina.length === 0) break;
    // Só aqui: contato sem acervo não ganha conversa vazia.
    if (!conversa) {
      conversa = await conversaDoContato(db, sessao, contato.id);
      resultado.conversa_criada = conversa.criada;
      limiteMs = await inicioDaConversaViva(db, sessao.organizationId, conversa.id);
    }
    for (const mensagem of pagina) {
      if (mensagem.timestamp * 1000 >= limiteMs) continue;
      const linha = linhaDoHistorico(mensagem, {
        organizationId: sessao.organizationId,
        canalId: sessao.canalId,
        contatoId: contato.id,
        conversaId: conversa.id,
      });
      if (!linha) continue;
      const { error } = await db.from("messages").insert(linha);
      if (error?.code === VIOLACAO_DE_UNICIDADE) resultado.repetidas += 1;
      else if (error) throw new Error(`mensagem_${error.code}`);
      else resultado.importadas += 1;
    }
    if (pagina.length < TAMANHO_DA_PAGINA) break;
  }
  return resultado;
}
