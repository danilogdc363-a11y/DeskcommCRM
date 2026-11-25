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
 * O negócio CAIU no período? Duas portas, qualquer uma basta:
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
): boolean {
  if (!de && !ate) return true;
  const dentro = (iso: string | null | undefined): boolean => {
    const dia = diaLocalDe(iso);
    if (!dia) return false;
    if (de && dia < de) return false;
    if (ate && dia > ate) return false;
    return true;
  };
  return dentro(lead.created_at) || dentro(lead.stage_changed_at);
}
