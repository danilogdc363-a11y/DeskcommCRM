/**
 * Raio-X do período: receita fechada, retorno sobre o investido, custo por
 * lead, CAC, payback, funil por coorte com custo por etapa, fechados e custo
 * por lead semana a semana. Funções PURAS — a rota busca, aqui só se conta.
 *
 * ## De onde vem cada número
 *
 * - Investido: gasto da conta de anúncios padrão (leitura de Meta Ads), sem
 *   imposto. `null` quando a conta não está conectada: tudo que depende dele
 *   (retorno, CPL, CAC, payback, custo por etapa) também vira `null`, nunca 0.
 * - Leads e funil: a coorte (leads criados no período e até onde chegaram).
 * - Receita e fechados: negócios do funil ganhos (`closed_at`) no período —
 *   podem ter chegado antes dele, como no Raio-X feito à mão.
 * - Payback: CAC ÷ (ticket médio ÷ 30). Supõe que o valor do negócio é a
 *   MENSALIDADE (o caso da Acelera); outro modelo de cobrança pede outra conta.
 */
import { somarDias, type LinhaDaCoorte } from "./funil-meta";

export interface Fechado {
  id: string;
  titulo: string;
  valorCents: number;
}

export interface SemanaDeCusto {
  /** YYYY-MM-DD inclusivos. */
  de: string;
  ate: string;
  investidoCents: number | null;
  leads: number;
}

export interface EtapaDoRaioX {
  rotulo: string;
  quantidade: number;
  /** Conversão a partir da etapa anterior (0–1); null na primeira. */
  conversaoDaAnterior: number | null;
  /** Investido ÷ quantidade; null sem investimento ou sem ninguém. */
  custoCents: number | null;
}

export interface RaioX {
  receitaCents: number;
  clientes: number;
  ticketMedioCents: number | null;
  investidoCents: number | null;
  retorno: number | null;
  leads: number;
  custoPorLeadCents: number | null;
  cacCents: number | null;
  paybackDias: number | null;
  funil: EtapaDoRaioX[];
  fechados: Fechado[];
  semanas: Array<SemanaDeCusto & { custoPorLeadCents: number | null }>;
}

const divide = (a: number | null, b: number): number | null =>
  a === null || b === 0 ? null : a / b;

/**
 * As quatro etapas do Raio-X a partir da coorte: leads (topo), reunião marcada
 * (Schedule), reunião feita (QualifiedLead) e vendas (etapa ganha). Etapa que o
 * funil não tem fica de fora, em vez de inventar zero.
 */
export function etapasDoRaioX(
  coorte: LinhaDaCoorte[],
): Array<{ rotulo: string; quantidade: number }> {
  const topo = coorte[0];
  if (!topo) return [];
  const pelo = (pred: (e: LinhaDaCoorte) => boolean, rotulo: string) => {
    const e = coorte.find(pred);
    return e ? [{ rotulo, quantidade: e.leads }] : [];
  };
  return [
    { rotulo: "Leads", quantidade: topo.leads },
    ...pelo((e) => e.eventoMeta === "Schedule", "Reuniões marcadas"),
    ...pelo((e) => e.eventoMeta === "QualifiedLead", "Reuniões feitas"),
    ...pelo((e) => e.ganha, "Vendas"),
  ];
}

export function montarRaioX(input: {
  coorte: LinhaDaCoorte[];
  fechados: Fechado[];
  investidoCents: number | null;
  semanas: SemanaDeCusto[];
}): RaioX {
  const fechados = [...input.fechados].sort((a, b) => b.valorCents - a.valorCents);
  const receitaCents = fechados.reduce((s, f) => s + f.valorCents, 0);
  const clientes = fechados.length;
  const ticketMedioCents = clientes ? receitaCents / clientes : null;
  const investido = input.investidoCents;
  const leads = input.coorte[0]?.leads ?? 0;
  const cacCents = divide(investido, clientes);

  const base = etapasDoRaioX(input.coorte);
  const funil = base.map((e, i) => ({
    ...e,
    conversaoDaAnterior: i === 0 ? null : divide(e.quantidade, base[i - 1]!.quantidade),
    custoCents: divide(investido, e.quantidade),
  }));

  return {
    receitaCents,
    clientes,
    ticketMedioCents,
    investidoCents: investido,
    retorno: investido ? receitaCents / investido : null,
    leads,
    custoPorLeadCents: divide(investido, leads),
    cacCents,
    paybackDias:
      cacCents !== null && ticketMedioCents ? Math.round(cacCents / (ticketMedioCents / 30)) : null,
    funil,
    fechados,
    semanas: input.semanas.map((s) => ({
      ...s,
      custoPorLeadCents: divide(s.investidoCents, s.leads),
    })),
  };
}

/** Semanas de segunda a domingo, cortadas nas bordas do período. */
export function semanasDoPeriodo(
  primeiroDia: string,
  ultimoDia: string,
): Array<{ de: string; ate: string }> {
  const out: Array<{ de: string; ate: string }> = [];
  let inicio = primeiroDia;
  while (inicio <= ultimoDia) {
    const [a, m, d] = inicio.split("-").map(Number) as [number, number, number];
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
    const fimDaSemana = somarDias(inicio, dow === 0 ? 0 : 7 - dow);
    const fim = fimDaSemana < ultimoDia ? fimDaSemana : ultimoDia;
    out.push({ de: inicio, ate: fim });
    inicio = somarDias(fim, 1);
  }
  return out;
}

/** Gasto da Graph vem em reais como texto ("123.45"). */
export function gastoEmCentavos(linhas: Array<{ spend?: string }>): number {
  return Math.round(linhas.reduce((s, l) => s + (Number(l.spend) || 0), 0) * 100);
}
