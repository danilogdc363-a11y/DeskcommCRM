import type { ScoreBand } from "./score-band";

/**
 * ACELERA (fork): a TEMPERATURA do lead — quão quente ele está.
 *
 * Duas fontes, e a humana ganha:
 *  1. `crm_leads.temperatura_manual` — o operador marcou à mão (frio/morno/quente);
 *  2. a faixa da IA (`lead.score.band`, de `crm_lead_scores`), quando existe.
 *
 * A IA nunca escreve a marcação manual e a marcação manual nunca apaga o score da
 * IA: voltar para "Automático" é gravar `null`, e a faixa da IA reaparece.
 * O vocabulário é o de `ScoreBand` de propósito — uma temperatura só, nunca duas.
 */
export const TEMPERATURAS: readonly ScoreBand[] = ["quente", "morno", "frio"];

export function ehTemperatura(valor: unknown): valor is ScoreBand {
  return typeof valor === "string" && (TEMPERATURAS as readonly string[]).includes(valor);
}

export interface TemperaturaEfetiva {
  band: ScoreBand;
  /** `manual` = o operador marcou; `ia` = veio do score automático. */
  origem: "manual" | "ia";
}

/** `null` = sem temperatura (nem marcada, nem calculada). Valor fora do vocabulário é ignorado. */
export function temperaturaEfetiva(lead: {
  temperatura_manual?: string | null;
  score?: { band: ScoreBand } | null;
}): TemperaturaEfetiva | null {
  if (ehTemperatura(lead.temperatura_manual)) {
    return { band: lead.temperatura_manual, origem: "manual" };
  }
  const daIa = lead.score?.band;
  return ehTemperatura(daIa) ? { band: daIa, origem: "ia" } : null;
}
