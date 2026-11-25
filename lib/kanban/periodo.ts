import type { Lead } from "@/lib/types/leads";

/** `AAAA-MM-DD` — o que o `<input type="date">` entrega e a URL carrega. */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Vale para valor vindo da URL: só um dia real do calendário é aceito. */
export function ehDiaValido(valor: unknown): valor is string {
  if (typeof valor !== "string" || !DIA.test(valor)) return false;
  const d = new Date(`${valor}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** O dia (`AAAA-MM-DD`) de um instante, no relógio de quem olha — não em UTC. */
export function diaLocalDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * O que o período olha: `criados_ou_movidos` (o padrão — quem chegou OU entrou na
 * etapa atual no período) ou só `criados` (quem chegou no período).
 */
export type ModoDoPeriodo = "criados_ou_movidos" | "criados";

export function ehModoDoPeriodo(valor: unknown): valor is ModoDoPeriodo {
  return valor === "criados_ou_movidos" || valor === "criados";
}

function diaAAAAMMDD(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * "Últimos N dias": HOJE e os N−1 dias anteriores (7 dias = 7 dias do calendário,
 * contando hoje), no relógio de quem olha. É por isso que a tela mostra as duas
 * datas nos campos — o atalho só preenche o período, não esconde a conta.
 */
export function ultimosDias(n: number, agora: Date = new Date()): { de: string; ate: string } {
  const dias = Math.max(1, Math.floor(n));
  const ate = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const de = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate() - (dias - 1));
  return { de: diaAAAAMMDD(de), ate: diaAAAAMMDD(ate) };
}

/** Os atalhos do filtro de período, na ordem em que a tela os oferece. */
export const ATALHOS_DE_PERIODO = [
  "hoje",
  "ontem",
  "esta_semana",
  "semana_passada",
  "ultimos_7",
  "este_mes",
  "mes_passado",
  "ultimos_30",
] as const;

export type AtalhoDePeriodo = (typeof ATALHOS_DE_PERIODO)[number];

/**
 * O período de cada atalho, no relógio de quem olha.
 *
 * Semana = SEGUNDA a DOMINGO (a semana de trabalho): "esta semana" e "semana
 * passada" são semanas inteiras, e dias que ainda não chegaram não têm negócio —
 * o recorte não muda por isso. Mês = do dia 1 ao último dia. Os "últimos N dias"
 * contam hoje (ver `ultimosDias`). A tela mostra as datas nos campos, então a
 * conta nunca fica escondida.
 */
export function periodoDoAtalho(
  atalho: AtalhoDePeriodo,
  agora: Date = new Date(),
): { de: string; ate: string } {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const soma = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
  const um = (d: Date) => ({ de: diaAAAAMMDD(d), ate: diaAAAAMMDD(d) });
  // getDay(): domingo = 0 → segunda = 0 dias desde a segunda, domingo = 6.
  const segundaDestaSemana = soma(hoje, -((hoje.getDay() + 6) % 7));

  switch (atalho) {
    case "hoje":
      return um(hoje);
    case "ontem":
      return um(soma(hoje, -1));
    case "esta_semana":
      return { de: diaAAAAMMDD(segundaDestaSemana), ate: diaAAAAMMDD(soma(segundaDestaSemana, 6)) };
    case "semana_passada": {
      const segunda = soma(segundaDestaSemana, -7);
      return { de: diaAAAAMMDD(segunda), ate: diaAAAAMMDD(soma(segunda, 6)) };
    }
    case "ultimos_7":
      return ultimosDias(7, agora);
    case "este_mes":
      return {
        de: diaAAAAMMDD(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
        ate: diaAAAAMMDD(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)),
      };
    case "mes_passado":
      return {
        de: diaAAAAMMDD(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)),
        ate: diaAAAAMMDD(new Date(hoje.getFullYear(), hoje.getMonth(), 0)),
      };
    case "ultimos_30":
      return ultimosDias(30, agora);
  }
}

/** Qual atalho o período atual é (se for exatamente um deles); `null` = personalizado. */
export function atalhoAtivoDoPeriodo(
  de: string | undefined,
  ate: string | undefined,
  agora: Date = new Date(),
): AtalhoDePeriodo | null {
  if (!de || !ate) return null;
  return (
    ATALHOS_DE_PERIODO.find((a) => {
      const p = periodoDoAtalho(a, agora);
      return p.de === de && p.ate === ate;
    }) ?? null
  );
}

/**
 * O negócio CAIU no período? Duas portas, qualquer uma basta
 * (no modo `criados`, só a primeira):
 *
 *  1. foi CRIADO no período (chegou nele);
 *  2. ENTROU na etapa atual no período (`stage_changed_at`, o carimbo do trigger
 *     da 0071).
 *
 * ⚠️ Limite honesto da segunda porta: o carimbo é o da ÚLTIMA mudança de etapa.
 * Um negócio que andou dentro do período e andou de novo depois dele sai do
 * recorte — o histórico completo de cada movimento mora em outra tabela e não vem
 * com o quadro. É o que o filtro afirma e é o que a tela diz.
 *
 * Extremos abertos valem: só `de` = "a partir de"; só `ate` = "até". Os dois
 * extremos são INCLUSIVOS e o dia é o do relógio de quem olha (um negócio das
 * 22h de ontem não pula para hoje por causa do UTC).
 */
export function negocioNoPeriodo(
  lead: Pick<Lead, "created_at" | "stage_changed_at">,
  de: string | undefined,
  ate: string | undefined,
  modo: ModoDoPeriodo = "criados_ou_movidos",
): boolean {
  if (!de && !ate) return true;
  const dentro = (iso: string | null | undefined): boolean => {
    const dia = diaLocalDe(iso);
    if (!dia) return false;
    if (de && dia < de) return false;
    if (ate && dia > ate) return false;
    return true;
  };
  return dentro(lead.created_at) || (modo !== "criados" && dentro(lead.stage_changed_at));
}
