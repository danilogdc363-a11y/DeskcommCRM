/**
 * ACELERA (só do fork): o botão "Disparar evento" da conversa.
 *
 * O evento sai movendo o card para a etapa cuja regra o envia: é o único caminho
 * com atividade no lead, idempotência do livro-razão e automações do funil.
 * Aqui mora a decisão pura de qual etapa serve e por que uma opção está fechada.
 */
import { eventoDaEtapaMeta, type RegraDeConversaoMeta } from "@/lib/conversoes/regras-meta";

export const FUNIL_DE_ORCAMENTOS_ID = "b90d61dc-a9af-4b1c-a8f2-994823bc34bf";

const EVENTOS_DA_CONVERSA = [
  { chave: "respondidos", rotulo: "Respondidos", metaEvent: "Respondidos" },
  { chave: "reuniao_marcada", rotulo: "Reunião marcada", metaEvent: "Schedule" },
  { chave: "reuniao_feita", rotulo: "Reunião feita", metaEvent: "QualifiedLead" },
  { chave: "fechou", rotulo: "Fechou", metaEvent: null },
] as const;

export type OrigemDoLead = "meta" | "outra" | "nenhuma";

export interface EtapaDoFunil {
  id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
}

export interface RegistroDoEvento {
  event_name: string;
  status: string;
  reason: string | null;
  detail: string | null;
  attempted_at: string | null;
}

export interface OpcaoDeEvento {
  chave: string;
  rotulo: string;
  stageId: string | null;
  etapa: string | null;
  /** Por que não dá para disparar; null = pode. */
  bloqueio: string | null;
  registro: { status: string; motivo: string | null; detalhe: string | null; em: string | null } | null;
}

const SEM_ORIGEM =
  "Este contato não tem origem de anúncio da Meta registrada, então a Meta não receberia o evento.";

export function opcoesDeEvento(entrada: {
  etapas: EtapaDoFunil[];
  etapaAtualId: string | null;
  regras: RegraDeConversaoMeta[];
  registros: RegistroDoEvento[];
  origem: OrigemDoLead;
}): OpcaoDeEvento[] {
  const { etapas, etapaAtualId, regras, registros, origem } = entrada;
  const ordenadas = [...etapas].sort((a, b) => a.position - b.position);
  const atual = ordenadas.find((e) => e.id === etapaAtualId) ?? null;

  return EVENTOS_DA_CONVERSA.map((evento) => {
    const etapa = evento.metaEvent
      ? ordenadas.find((e) =>
          regras.some((r) => r.enabled && r.metaEvent === evento.metaEvent && r.stageId === e.id),
        )
      : ordenadas.find((e) => e.is_won);
    const base = { chave: evento.chave, rotulo: evento.rotulo };
    if (!etapa) {
      return {
        ...base,
        stageId: null,
        etapa: null,
        bloqueio: "Nenhuma etapa deste funil envia este evento.",
        registro: null,
      };
    }
    const chaveDoRegistro = evento.metaEvent ? eventoDaEtapaMeta(etapa.id) : "Purchase";
    const linha = registros.find((r) => r.event_name === chaveDoRegistro);
    const registro = linha
      ? { status: linha.status, motivo: linha.reason, detalhe: linha.detail, em: linha.attempted_at }
      : null;

    let bloqueio: string | null = null;
    if (registro?.status === "sent") bloqueio = "Este evento já foi enviado para este lead.";
    else if (etapa.id === etapaAtualId) bloqueio = "O card já está nesta etapa.";
    else if (atual && etapa.position < atual.position) bloqueio = "O card já passou desta etapa.";
    else if (origem === "nenhuma" || (origem === "outra" && evento.metaEvent)) bloqueio = SEM_ORIGEM;

    return { ...base, stageId: etapa.id, etapa: etapa.name, bloqueio, registro };
  });
}

/** O negócio aberto do funil comercial, se houver; senão o mais recente. */
export function leadDaConversa<T extends { pipeline_id: string }>(abertos: T[]): T | null {
  return abertos.find((l) => l.pipeline_id === FUNIL_DE_ORCAMENTOS_ID) ?? abertos[0] ?? null;
}
