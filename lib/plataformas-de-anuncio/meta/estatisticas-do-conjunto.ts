/**
 * O que o Meta REGISTROU no conjunto de dados — `/{dataset_id}/stats`.
 *
 * Usa o mesmo conjunto e token que o CRM guarda para a API de Conversões
 * (`lerCredencial`), só no servidor. O token vai no header, nunca na URL nem
 * em log, e nunca sai desta função.
 *
 * Só eventos do servidor (`event_source=SERVER_ONLY`): os do navegador vêm do site,
 * não do CRM, e misturar faria a comparação acusar diferença que não é nossa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import { lerStatsDoMeta, type ContagemDoMeta, type RespostaDeStats } from "@/lib/reports/funil-meta";

import { baseDaGraphDeAnuncio } from "./graph-base";

const TEMPO_LIMITE_MS = 15_000;

export type LeituraDeStats =
  | { ok: true; datasetId: string; contagens: ContagemDoMeta[] }
  | { ok: false; motivo: string };

export async function lerEstatisticasDoConjunto(
  admin: SupabaseClient,
  organizationId: string,
  janela: { de: Date; ate: Date },
): Promise<LeituraDeStats> {
  const cred = await lerCredencial(admin, organizationId, "meta_ads", { exigirAcaoDeVenda: false });
  if (!cred.ok) return { ok: false, motivo: cred.motivo };
  const { datasetId, accessToken } = cred.credencial;

  const url = new URL(`${baseDaGraphDeAnuncio()}/${encodeURIComponent(datasetId)}/stats`);
  url.searchParams.set("aggregation", "event");
  url.searchParams.set("event_source", "SERVER_ONLY");
  url.searchParams.set("start_time", String(Math.floor(janela.de.getTime() / 1000)));
  url.searchParams.set("end_time", String(Math.floor(janela.ate.getTime() / 1000)));

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return { ok: false, motivo: erro instanceof Error ? erro.message : "falha de rede" };
  }

  const texto = await resposta.text().catch(() => "");
  if (!resposta.ok) {
    let mensagem = `HTTP ${resposta.status}`;
    try {
      mensagem = (JSON.parse(texto) as { error?: { message?: string } }).error?.message ?? mensagem;
    } catch {
      // corpo não-JSON: fica o status
    }
    logger.warn("[ads.meta.stats] leitura recusada", { status: resposta.status });
    return { ok: false, motivo: mensagem };
  }

  try {
    return { ok: true, datasetId, contagens: lerStatsDoMeta(JSON.parse(texto) as RespostaDeStats) };
  } catch {
    return { ok: false, motivo: "resposta ilegível do Meta" };
  }
}
