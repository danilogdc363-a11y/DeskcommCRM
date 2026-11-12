/**
 * O que o Meta REGISTROU no conjunto de dados — `/{dataset_id}/stats`.
 *
 * Usa o mesmo conjunto e token que o CRM guarda para a API de Conversões
 * (`lerCredencial`), só no servidor. O token vai no header, nunca na URL nem
 * em log, e nunca sai desta função.
 *
 * Só eventos do servidor (`event_source=SERVER_ONLY`): os do navegador vêm do
 * site, não do CRM. ⚠️ Esse filtro e o formato da resposta foram conferidos
 * pela ferramenta de Meta Ads, não por chamada direta à Graph com este token;
 * a primeira carga real é a prova. Se a Graph recusar o parâmetro, a tela diz
 * "sem dados do Meta" em vez de inventar diferença.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import {
  lerStatsDoMeta,
  type ContagemDoMeta,
  type RespostaDeStats,
} from "@/lib/reports/funil-meta";

import { baseDaGraphDeAnuncio } from "./graph-base";

const TEMPO_LIMITE_MS = 15_000;
const MAXIMO_DE_PAGINAS = 10;

/** Motivo legível para a tela; o detalhe da plataforma fica no log. */
export type MotivoSemStats =
  | "sem_conexao"
  | "conexao_desabilitada"
  | "credencial_incompleta"
  | "cifra_indisponivel"
  | "leitura_indisponivel"
  | "recusado_pelo_meta"
  | "falha_de_rede";

export type LeituraDeStats =
  | { ok: true; datasetId: string; contagens: ContagemDoMeta[] }
  | { ok: false; motivo: MotivoSemStats };

type Pagina = RespostaDeStats & { paging?: { next?: string } };

export async function lerEstatisticasDoConjunto(
  admin: SupabaseClient,
  organizationId: string,
  janela: { de: Date; ate: Date },
  buscar: typeof fetch = fetch,
): Promise<LeituraDeStats> {
  const cred = await lerCredencial(admin, organizationId, "meta_ads", { exigirAcaoDeVenda: false });
  if (!cred.ok) return { ok: false, motivo: cred.motivo };
  const { datasetId, accessToken } = cred.credencial;

  const inicial = new URL(`${baseDaGraphDeAnuncio()}/${encodeURIComponent(datasetId)}/stats`);
  inicial.searchParams.set("aggregation", "event");
  inicial.searchParams.set("event_source", "SERVER_ONLY");
  inicial.searchParams.set("start_time", String(Math.floor(janela.de.getTime() / 1000)));
  inicial.searchParams.set("end_time", String(Math.floor(janela.ate.getTime() / 1000)));

  const baldes: NonNullable<RespostaDeStats["data"]> = [];
  let url: URL | null = inicial;
  for (let pagina = 0; url && pagina < MAXIMO_DE_PAGINAS; pagina++) {
    let resposta: Response;
    try {
      resposta = await buscar(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch (erro) {
      logger.warn("[ads.meta.stats] falha de rede", {
        erro: erro instanceof Error ? erro.message : "?",
      });
      return { ok: false, motivo: "falha_de_rede" };
    }

    const texto = await resposta.text().catch(() => "");
    if (!resposta.ok) {
      let mensagem: string | undefined;
      try {
        mensagem = (JSON.parse(texto) as { error?: { message?: string } }).error?.message;
      } catch {
        // corpo não-JSON
      }
      logger.warn("[ads.meta.stats] leitura recusada", { status: resposta.status, mensagem });
      return { ok: false, motivo: "recusado_pelo_meta" };
    }

    let json: Pagina;
    try {
      json = JSON.parse(texto) as Pagina;
    } catch {
      return { ok: false, motivo: "recusado_pelo_meta" };
    }
    baldes.push(...(json.data ?? []));
    url = proximaPagina(json.paging?.next, inicial.origin);
  }

  return { ok: true, datasetId, contagens: lerStatsDoMeta({ data: baldes }) };
}

/**
 * `paging.next` volta com o token embutido na query (é a plataforma que o
 * monta). Ele sai antes de seguir: o token só viaja no header, e só para o
 * mesmo host da Graph.
 */
export function proximaPagina(next: string | undefined, origem: string): URL | null {
  if (!next) return null;
  try {
    const u = new URL(next);
    if (u.origin !== origem) return null;
    u.searchParams.delete("access_token");
    return u;
  } catch {
    return null;
  }
}
