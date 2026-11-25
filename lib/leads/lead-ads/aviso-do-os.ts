/**
 * (Acelera) LEGADO TRANSITÓRIO — o aviso do lead novo no WhatsApp do comercial,
 * pelo Acelera OS.
 *
 * É de UMA instalação (duas variáveis no servidor), não por empresa, e por isso
 * NÃO é o desenho final: foi mantido só para não interromper o que já funciona.
 * O substituto por empresa é a regra de automação "lead novo" → "Mensagem para a
 * equipe". Quando estiver provado em produção, apagar este arquivo e a chamada
 * em `receber.ts`.
 *
 * Só avisa o card que nasceu AGORA (reenvio da Meta e lead antigo importado não
 * avisam). Falha aqui só vira log: o lead já está gravado.
 */
import { createHmac } from "node:crypto";

import { logger } from "@/lib/logger";

import type { LeadDoFormulario } from "./payload";

const TEMPO_LIMITE_MS = 8_000;

export async function avisarComercialPeloOs(
  lead: LeadDoFormulario,
  deps: { fetch?: typeof fetch; env?: Record<string, string | undefined>; agora?: number } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const url = env.ACELERA_LEADS_AVISO_URL;
  const segredo = env.ACELERA_LEADS_AVISO_SECRET;
  if (!url || !segredo) return;

  const respostas: Record<string, string> = { ...lead.campos };
  if (lead.email) respostas.email = lead.email;
  const corpo = JSON.stringify({
    nome: lead.nome,
    telefone: lead.telefone,
    plataforma: lead.plataforma === "ig" ? "instagram" : "facebook",
    respostas,
  });
  const carimbo = Math.floor((deps.agora ?? Date.now()) / 1000);
  const assinatura = createHmac("sha256", segredo).update(`${carimbo}.${lead.leadgenId}.${corpo}`).digest("hex");
  try {
    const resposta = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-delivery": lead.leadgenId,
        "x-webhook-signature": `t=${carimbo},v1=${assinatura}`,
      },
      body: corpo,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) logger.error("[lead-ads] aviso pelo OS recusado", { status: resposta.status });
  } catch (erro) {
    logger.error("[lead-ads] aviso pelo OS falhou", { motivo: erro instanceof Error ? erro.message : "desconhecido" });
  }
}
