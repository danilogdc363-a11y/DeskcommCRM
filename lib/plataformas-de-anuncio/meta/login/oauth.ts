/**
 * As chamadas OAuth da Meta para o login de LEITURA de anúncios.
 *
 * - escopo SÓ `ads_read` (lê desempenho; não cria, pausa nem altera nada);
 * - o `code` vira token curto, e o curto vira token de LONGA duração (~60 dias);
 * - o App Secret viaja no CORPO de um POST (nunca em query string, que vaza em
 *   log de proxy);
 * - toda chamada tem timeout, e nenhum token entra em log ou em erro.
 *
 * A URL de retorno é exatamente a cadastrada no app da Meta: o caminho abaixo
 * somado à URL pública da instalação.
 */
import { VERSAO_PADRAO_DA_GRAPH } from "@/lib/graph-version";

import { baseDaGraphDeAnuncio } from "../graph-base";
import type { AppDeLoginDaMeta } from "./app";

export const CAMINHO_DO_CALLBACK = "/api/v1/meta-ads/oauth/callback";
export const ESCOPO_DE_LEITURA = "ads_read";
const TIMEOUT_MS = 10_000;
/** Renova quando falta menos que isto para vencer. */
export const RENOVAR_QUANDO_FALTAR_MS = 7 * 24 * 60 * 60 * 1000;
/** A Meta nem sempre devolve `expires_in`; token de longa duração dura ~60 dias. */
const VALIDADE_PADRAO_S = 60 * 24 * 60 * 60;

export function urlDeRetorno(baseDoApp: string): string {
  return new URL(CAMINHO_DO_CALLBACK, baseDoApp).toString();
}

export function montarUrlDeLogin(app: AppDeLoginDaMeta, opcoes: { state: string; redirectUri: string }): string {
  const url = new URL(`https://www.facebook.com/${VERSAO_PADRAO_DA_GRAPH}/dialog/oauth`);
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("redirect_uri", opcoes.redirectUri);
  url.searchParams.set("state", opcoes.state);
  url.searchParams.set("scope", ESCOPO_DE_LEITURA);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export type TokenDaMeta =
  | { ok: true; accessToken: string; expiraEm: Date }
  | {
      ok: false;
      motivo: "rejeitado" | "indisponivel" | "resposta_invalida";
      /** A Meta disse que o app não tem o recurso (ads_read sem acesso avançado). */
      recursoIndisponivel: boolean;
    };

/** Mensagens com que a Meta diz que o app não tem o recurso (acesso avançado). */
function ehRecursoIndisponivel(corpo: unknown): boolean {
  const erro = (corpo as { error?: { message?: string } } | null)?.error;
  const msg = (erro?.message ?? "").toLowerCase();
  return msg.includes("feature unavailable") || msg.includes("advanced access") || msg.includes("not available");
}

async function pedirToken(parametros: Record<string, string>, agora: Date): Promise<TokenDaMeta> {
  let resposta: Response;
  try {
    resposta = await fetch(`${baseDaGraphDeAnuncio()}/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parametros).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, motivo: "indisponivel", recursoIndisponivel: false };
  }
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    /* corpo que não é JSON cai nos desfechos abaixo */
  }
  if (!resposta.ok) {
    return { ok: false, motivo: "rejeitado", recursoIndisponivel: ehRecursoIndisponivel(corpo) };
  }
  const dados = corpo as { access_token?: unknown; expires_in?: unknown } | null;
  const token = typeof dados?.access_token === "string" ? dados.access_token.trim() : "";
  if (token.length < 20) return { ok: false, motivo: "resposta_invalida", recursoIndisponivel: false };
  const segundos =
    typeof dados?.expires_in === "number" && dados.expires_in > 0 ? dados.expires_in : VALIDADE_PADRAO_S;
  return { ok: true, accessToken: token, expiraEm: new Date(agora.getTime() + segundos * 1000) };
}

/** `code` → token curto. */
export function trocarCodigoPorToken(
  app: AppDeLoginDaMeta,
  code: string,
  opcoes: { redirectUri: string; agora: Date },
): Promise<TokenDaMeta> {
  return pedirToken(
    { client_id: app.appId, client_secret: app.appSecret, redirect_uri: opcoes.redirectUri, code },
    opcoes.agora,
  );
}

/** Token (curto ou longo) → token de LONGA duração. Serve também para renovar. */
export function trocarPorTokenDeLongaDuracao(
  app: AppDeLoginDaMeta,
  token: string,
  opcoes: { agora: Date },
): Promise<TokenDaMeta> {
  return pedirToken(
    {
      grant_type: "fb_exchange_token",
      client_id: app.appId,
      client_secret: app.appSecret,
      fb_exchange_token: token,
    },
    opcoes.agora,
  );
}
