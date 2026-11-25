/**
 * (Acelera) A chamada à Graph API do formulário da Meta, num lugar só.
 *
 * Todo pedido deste módulo: leva o token no cabeçalho (nunca na URL, que vai
 * parar em log), tem teto de tempo, e devolve o erro da Meta COMO DADO — código,
 * subcódigo e mensagem — em vez de lançar. Quem chama traduz em português
 * (`erros-da-meta.ts`). Nada aqui grava token em log.
 *
 * Paginação por cursor (`after`): o `paging.next` que a Meta devolve carrega o
 * `access_token` na URL, e é o que NÃO queremos repetir nem registrar.
 */
import { baseDaGraphDeAnuncio } from "@/lib/plataformas-de-anuncio/meta/graph-base";

export const TEMPO_LIMITE_PADRAO_MS = 8_000;

export interface ErroDaMeta {
  codigo: number | null;
  subcodigo: number | null;
  mensagem: string | null;
}

export type RespostaDaGraph<T> =
  | { ok: true; dados: T }
  | {
      ok: false;
      /** `rede` = nem chegou resposta (tempo esgotado, DNS). */
      motivo: "rede" | "recusada" | "ilegivel";
      status: number | null;
      erro: ErroDaMeta | null;
    };

export interface PedidoDaGraph {
  metodo?: "GET" | "POST" | "DELETE";
  /** Caminho depois da versão, sem `?`: `me/accounts`, `123/subscribed_apps`. */
  caminho: string;
  token: string;
  consulta?: Record<string, string>;
  /** Corpo `application/x-www-form-urlencoded` (POST). */
  formulario?: Record<string, string>;
  tempoLimiteMs?: number;
  fetchImpl?: typeof fetch;
}

function erroDoCorpo(corpo: unknown): ErroDaMeta | null {
  const e = (corpo as { error?: Record<string, unknown> } | null)?.error;
  if (!e || typeof e !== "object") return null;
  return {
    codigo: typeof e.code === "number" ? e.code : null,
    subcodigo: typeof e.error_subcode === "number" ? e.error_subcode : null,
    mensagem: typeof e.message === "string" ? e.message.slice(0, 300) : null,
  };
}

export async function chamarGraph<T = unknown>(pedido: PedidoDaGraph): Promise<RespostaDaGraph<T>> {
  const url = new URL(`${baseDaGraphDeAnuncio()}/${pedido.caminho.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(pedido.consulta ?? {})) url.searchParams.set(k, v);
  const buscar = pedido.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${pedido.token}`,
    accept: "application/json",
  };
  let body: string | undefined;
  if (pedido.formulario) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(pedido.formulario).toString();
  }

  let resposta: Response;
  try {
    resposta = await buscar(url.toString(), {
      method: pedido.metodo ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(pedido.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, motivo: "rede", status: null, erro: null };
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    /* corpo que não é JSON cai nos desfechos abaixo */
  }
  if (!resposta.ok) {
    return { ok: false, motivo: "recusada", status: resposta.status, erro: erroDoCorpo(corpo) };
  }
  // A Meta responde 200 com `error` em alguns casos; trate como recusa.
  const erroNoCorpo = erroDoCorpo(corpo);
  if (erroNoCorpo) return { ok: false, motivo: "recusada", status: resposta.status, erro: erroNoCorpo };
  if (corpo === null) return { ok: false, motivo: "ilegivel", status: resposta.status, erro: null };
  return { ok: true, dados: corpo as T };
}

interface PaginaDaGraph<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Todas as páginas de uma lista, seguindo o cursor `after`. Para no `maximo`
 * de itens (a lista devolvida pode passar um pouco dele, por página inteira).
 */
export async function listarTudo<T>(
  pedido: Omit<PedidoDaGraph, "metodo">,
  maximo = 1_000,
): Promise<
  | { ok: true; itens: T[]; cortou: boolean }
  | Extract<RespostaDaGraph<never>, { ok: false }>
> {
  const itens: T[] = [];
  let depois: string | undefined;
  for (let pagina = 0; pagina < 50; pagina++) {
    const consulta = { ...(pedido.consulta ?? {}), limit: "100", ...(depois ? { after: depois } : {}) };
    const r = await chamarGraph<PaginaDaGraph<T>>({ ...pedido, metodo: "GET", consulta });
    if (!r.ok) return r;
    itens.push(...(r.dados.data ?? []));
    // `next` ausente = última página (o cursor `after` sempre vem, mesmo na última).
    depois = r.dados.paging?.next ? r.dados.paging.cursors?.after : undefined;
    if (!depois) return { ok: true, itens, cortou: false };
    if (itens.length >= maximo) return { ok: true, itens, cortou: true };
  }
  return { ok: true, itens, cortou: true };
}
