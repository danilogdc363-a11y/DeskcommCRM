/**
 * (Acelera) As operações da Meta sobre PÁGINAS e sobre o webhook do app.
 *
 * - listar as Páginas da pessoa e o token de cada uma (`/me/accounts`);
 * - inscrever / desinscrever o app numa Página (`subscribed_apps`, campo `leadgen`);
 * - cadastrar o endereço do webhook no app (`/{app-id}/subscriptions`), com a
 *   senha de verificação DERIVADA (`verificacao.ts`).
 *
 * O token da Página sai daqui para o servidor gravar cifrado e NUNCA vai ao
 * navegador. O token do app (`APP_ID|APP_SECRET`) vai no cabeçalho.
 */
import { chamarGraph, listarTudo, type RespostaDaGraph } from "./graph";
import { verifyTokenDoFormulario } from "./verificacao";

export const CAMPO_DO_FORMULARIO = "leadgen";

export interface PaginaDaMeta {
  id: string;
  nome: string;
  /** Token da Página: uso do servidor. Nunca serializar para a resposta da API. */
  tokenDaPagina: string;
}

interface ContaDaGraph {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
}

export async function listarPaginasDoUsuario(
  tokenDoUsuario: string,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<
  { ok: true; paginas: PaginaDaMeta[] } | Extract<RespostaDaGraph<never>, { ok: false }>
> {
  const r = await listarTudo<ContaDaGraph>(
    {
      caminho: "me/accounts",
      token: tokenDoUsuario,
      consulta: { fields: "id,name,access_token" },
      fetchImpl: opcoes.fetchImpl,
    },
    200,
  );
  if (!r.ok) return r;
  const paginas: PaginaDaMeta[] = [];
  for (const c of r.itens) {
    if (typeof c.id !== "string" || !/^\d{1,32}$/.test(c.id)) continue;
    if (typeof c.access_token !== "string" || c.access_token.length < 20) continue;
    paginas.push({
      id: c.id,
      nome: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 200) : `Página ${c.id}`,
      tokenDaPagina: c.access_token,
    });
  }
  return { ok: true, paginas };
}

/** Permissões que o login concedeu (`/me/permissions`) — a verdade, não o que foi pedido. */
export async function permissoesConcedidas(
  tokenDoUsuario: string,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; concedidas: string[] } | Extract<RespostaDaGraph<never>, { ok: false }>> {
  const r = await chamarGraph<{ data?: { permission?: unknown; status?: unknown }[] }>({
    caminho: "me/permissions",
    token: tokenDoUsuario,
    fetchImpl: opcoes.fetchImpl,
  });
  if (!r.ok) return r;
  const concedidas = (r.dados.data ?? [])
    .filter((p) => p.status === "granted" && typeof p.permission === "string")
    .map((p) => p.permission as string);
  return { ok: true, concedidas };
}

export async function inscreverPagina(
  pageId: string,
  tokenDaPagina: string,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<RespostaDaGraph<{ success?: boolean }>> {
  return chamarGraph({
    metodo: "POST",
    caminho: `${pageId}/subscribed_apps`,
    token: tokenDaPagina,
    formulario: { subscribed_fields: CAMPO_DO_FORMULARIO },
    fetchImpl: opcoes.fetchImpl,
  });
}

export async function desinscreverPagina(
  pageId: string,
  tokenDaPagina: string,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<RespostaDaGraph<{ success?: boolean }>> {
  return chamarGraph({
    metodo: "DELETE",
    caminho: `${pageId}/subscribed_apps`,
    token: tokenDaPagina,
    fetchImpl: opcoes.fetchImpl,
  });
}

/** A Página está inscrita no NOSSO app com o campo de formulário? */
export async function paginaEstaInscrita(
  pageId: string,
  tokenDaPagina: string,
  appId: string,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; inscrita: boolean } | Extract<RespostaDaGraph<never>, { ok: false }>> {
  const r = await chamarGraph<{ data?: { id?: unknown; subscribed_fields?: unknown }[] }>({
    caminho: `${pageId}/subscribed_apps`,
    token: tokenDaPagina,
    fetchImpl: opcoes.fetchImpl,
  });
  if (!r.ok) return r;
  const nosso = (r.dados.data ?? []).find((a) => a.id === appId);
  const campos = Array.isArray(nosso?.subscribed_fields) ? (nosso.subscribed_fields as unknown[]) : [];
  return { ok: true, inscrita: Boolean(nosso) && campos.includes(CAMPO_DO_FORMULARIO) };
}

export function urlDoWebhookDeFormulario(baseDoApp: string): string {
  return new URL("/api/v1/webhooks/lead-ads", baseDoApp).toString();
}

/**
 * Garante que o app da Meta recebe os avisos de formulário em NOSSA URL.
 *
 * Idempotente: lê a inscrição do objeto `page` e só escreve se a URL ou o campo
 * não conferem. A Meta confere a URL na hora (GET com a senha derivada), então
 * isto só dá certo com o CRM no ar naquele endereço.
 */
export async function garantirInscricaoDoApp(
  app: { appId: string; appSecret: string },
  baseDoApp: string,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; mudou: boolean } | Extract<RespostaDaGraph<never>, { ok: false }>> {
  const tokenDoApp = `${app.appId}|${app.appSecret}`;
  const url = urlDoWebhookDeFormulario(baseDoApp);

  const atual = await chamarGraph<{
    data?: { object?: unknown; callback_url?: unknown; active?: unknown; fields?: { name?: unknown }[] }[];
  }>({ caminho: `${app.appId}/subscriptions`, token: tokenDoApp, fetchImpl: opcoes.fetchImpl });
  if (atual.ok) {
    const pagina = (atual.dados.data ?? []).find((s) => s.object === "page");
    const campos = (pagina?.fields ?? []).map((f) => f.name);
    if (pagina && pagina.callback_url === url && pagina.active !== false && campos.includes(CAMPO_DO_FORMULARIO)) {
      return { ok: true, mudou: false };
    }
  }

  const gravou = await chamarGraph({
    metodo: "POST",
    caminho: `${app.appId}/subscriptions`,
    token: tokenDoApp,
    formulario: {
      object: "page",
      callback_url: url,
      fields: CAMPO_DO_FORMULARIO,
      verify_token: verifyTokenDoFormulario(app.appSecret),
    },
    fetchImpl: opcoes.fetchImpl,
  });
  if (!gravou.ok) return gravou;
  return { ok: true, mudou: true };
}
