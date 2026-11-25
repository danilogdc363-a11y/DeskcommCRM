import type { Lead } from "@/lib/types/leads";

import { compararNaEtapa } from "./entrada-na-etapa";

/**
 * ACELERA (fork): a ORDEM em que os cards aparecem DENTRO de cada coluna do
 * quadro. É só apresentação — nada é gravado no banco: a `position_in_stage` que
 * o operador montou arrastando continua intacta e volta quando ele escolhe
 * "Ordem do quadro".
 *
 * Datas: o sentido está no nome (novos/antigos), porque "ordenar por data" sem
 * dizer o sentido é a pergunta que todo mundo erra metade das vezes.
 */
export const ORDENS_DO_QUADRO = [
  "criacao_novos",
  "criacao_antigos",
  "edicao",
  "contato_recentes",
  "contato_antigos",
  "nome_az",
  "nome_za",
] as const;

export type OrdemDoQuadro = (typeof ORDENS_DO_QUADRO)[number];

/** Vale para valor vindo da URL (que é texto livre): qualquer outro vira "ordem do quadro". */
export function ehOrdemDoQuadro(valor: unknown): valor is OrdemDoQuadro {
  return typeof valor === "string" && (ORDENS_DO_QUADRO as readonly string[]).includes(valor);
}

/** Tempo de uma data ISO; `null` quando não há (ou não é) data. */
function tempoDe(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Compara duas datas, MAIS RECENTE PRIMEIRO (`recentesPrimeiro`) ou mais antiga.
 * Quem não tem a data vai SEMPRE para o fim, nos dois sentidos: "sem contato"
 * não é nem o mais novo nem o mais antigo, e no topo da coluna ele esconderia
 * quem de fato tem data.
 */
function porData(
  a: string | null | undefined,
  b: string | null | undefined,
  recentesPrimeiro: boolean,
): number {
  const ta = tempoDe(a);
  const tb = tempoDe(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return recentesPrimeiro ? tb - ta : ta - tb;
}

function porNome(a: Lead, b: Lead): number {
  return (a.title ?? "").localeCompare(b.title ?? "", "pt-BR", {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * O comparador da ordem escolhida, ou `null` para "ordem do quadro" (nada a
 * fazer — a lista já vem na `position_in_stage`).
 *
 * O desempate é SEMPRE o comparador canônico da etapa (`position_in_stage`, depois
 * `id`): dois cards empatados nunca trocam de lugar a cada render (#3461).
 */
export function comparadorDaOrdem(
  ordem: OrdemDoQuadro | null | undefined,
): ((a: Lead, b: Lead) => number) | null {
  if (!ordem) return null;
  const principal = ((): ((a: Lead, b: Lead) => number) => {
    switch (ordem) {
      case "criacao_novos":
        return (a, b) => porData(a.created_at, b.created_at, true);
      case "criacao_antigos":
        return (a, b) => porData(a.created_at, b.created_at, false);
      case "edicao":
        return (a, b) => porData(a.updated_at, b.updated_at, true);
      case "contato_recentes":
        return (a, b) => porData(a.conversa?.last_message_at, b.conversa?.last_message_at, true);
      case "contato_antigos":
        return (a, b) => porData(a.conversa?.last_message_at, b.conversa?.last_message_at, false);
      case "nome_az":
        return porNome;
      case "nome_za":
        return (a, b) => porNome(b, a);
    }
  })();
  return (a, b) => principal(a, b) || compararNaEtapa(a, b);
}
