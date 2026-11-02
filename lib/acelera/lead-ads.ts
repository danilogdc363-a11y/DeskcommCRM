/**
 * (Acelera) Formulário nativo do Instagram/Facebook entrando no CRM.
 *
 * A Meta avisa só o id do lead (`leadgen`); as respostas são buscadas na Graph e
 * repassadas à captação pública (`/api/v1/webhooks/in/[token]`), que já cuida de
 * contato, card, deduplicação por `external_id` e do histórico "Leads recebidos".
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";
import { baseDaGraphDeAnuncio } from "@/lib/plataformas-de-anuncio/meta/graph-base";

const TEMPO_LIMITE_MS = 8_000;
const CAMPOS_DO_LEAD = "id,created_time,ad_id,adset_id,campaign_id,form_id,platform,field_data";

type Fetch = typeof fetch;

export function assinaturaDaMetaConfere(
  corpo: string,
  cabecalho: string | null,
  segredo: string,
): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", segredo).update(corpo).digest();
  const recebido = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export function idsDeLeadDoAviso(corpo: unknown): string[] {
  const entradas = (corpo as { entry?: unknown } | null)?.entry;
  if (!Array.isArray(entradas)) return [];
  const ids: string[] = [];
  for (const entrada of entradas) {
    const mudancas = (entrada as { changes?: unknown }).changes;
    if (!Array.isArray(mudancas)) continue;
    for (const mudanca of mudancas as { field?: unknown; value?: { leadgen_id?: unknown } }[]) {
      const id = mudanca.value?.leadgen_id;
      if (mudanca.field === "leadgen" && typeof id === "string" && /^\d+$/.test(id)) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

interface LeadDaMeta {
  id: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
  platform?: string;
  field_data?: { name?: string; values?: unknown[] }[];
}

/** Corpo plano da captação: as respostas como vieram e a origem do anúncio. */
export function corpoDaCaptacao(lead: LeadDaMeta): Record<string, string> {
  const corpo: Record<string, string> = {
    external_id: `meta_lead:${lead.id}`,
    meta_lead_id: lead.id,
    utm_source: lead.platform === "ig" ? "instagram" : "facebook",
    utm_medium: "lead_ads",
  };
  if (lead.campaign_id) corpo.utm_campaign = lead.campaign_id;
  if (lead.adset_id) corpo.utm_adset = lead.adset_id;
  if (lead.ad_id) corpo.utm_ad = lead.ad_id;
  if (lead.form_id) corpo.meta_form_id = lead.form_id;
  for (const campo of lead.field_data ?? []) {
    const valor = (campo.values ?? []).filter((v) => typeof v === "string").join(", ");
    if (campo.name && valor) corpo[campo.name] = valor;
  }
  return corpo;
}

const CAMPOS_DE_CONTATO = new Set(["full_name", "phone_number"]);

/**
 * Pede ao Acelera OS o aviso no WhatsApp do comercial. O lead já está gravado:
 * falha aqui só vira log, para a Meta não reenviar e duplicar nada.
 */
export async function avisarComercial(
  lead: LeadDaMeta,
  deps: { fetch?: Fetch; env?: Record<string, string | undefined>; agora?: number } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const url = env.ACELERA_LEADS_AVISO_URL;
  const segredo = env.ACELERA_LEADS_AVISO_SECRET;
  if (!url || !segredo) return;
  const valor = (nome: string) => {
    const campo = lead.field_data?.find((c) => c.name === nome);
    return (campo?.values ?? []).filter((v) => typeof v === "string").join(", ") || null;
  };
  const respostas: Record<string, string> = {};
  for (const campo of lead.field_data ?? []) {
    const resposta = campo.name ? valor(campo.name) : null;
    if (campo.name && resposta && !CAMPOS_DE_CONTATO.has(campo.name)) respostas[campo.name] = resposta;
  }
  const corpo = JSON.stringify({
    nome: valor("full_name"),
    telefone: valor("phone_number"),
    plataforma: lead.platform === "ig" ? "instagram" : "facebook",
    respostas,
  });
  const carimbo = Math.floor((deps.agora ?? Date.now()) / 1000);
  const assinatura = createHmac("sha256", segredo)
    .update(`${carimbo}.${lead.id}.${corpo}`)
    .digest("hex");
  try {
    const resposta = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-delivery": lead.id,
        "x-webhook-signature": `t=${carimbo},v1=${assinatura}`,
      },
      body: corpo,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) logger.error("[acelera.lead-ads] aviso recusado", { status: resposta.status });
  } catch (erro) {
    logger.error("[acelera.lead-ads] aviso falhou", {
      motivo: erro instanceof Error ? erro.message : "desconhecido",
    });
  }
}

/** Busca o lead na Graph e entrega à captação. Lança para a Meta reenviar o aviso. */
export async function importarLeadDaMeta(
  leadId: string,
  deps: { fetch?: Fetch; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const buscar = deps.fetch ?? fetch;
  const token = env.ACELERA_LEADS_PAGE_TOKEN;
  const destino = env.ACELERA_LEADS_INBOUND_URL;
  if (!token || !destino) throw new Error("lead_ads_nao_configurado");

  const resposta = await buscar(`${baseDaGraphDeAnuncio()}/${leadId}?fields=${CAMPOS_DO_LEAD}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  if (!resposta.ok) throw new Error(`graph_${resposta.status}`);
  const lead = (await resposta.json()) as LeadDaMeta;

  const entrega = await buscar(destino, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpoDaCaptacao(lead)),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  // 4xx é recusa da captação (ex.: sem telefone) e fica em "Leads recebidos":
  // reenviar não muda o desfecho.
  if (entrega.status >= 500 || entrega.status === 429) throw new Error(`captacao_${entrega.status}`);
  if (entrega.ok) await avisarComercial(lead, deps);
}
