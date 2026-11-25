/**
 * O desenho POR EMPRESA do formulário da Meta, em peças puras:
 * - a senha de verificação derivada do segredo do app (sem variável nova);
 * - a tradução dos erros da Meta para português que diz o que fazer;
 * - a inscrição do app no webhook (idempotente, sem token na URL);
 * - as Páginas da pessoa (só as que têm token) e a paginação por cursor.
 */
import { describe, expect, it, vi } from "vitest";

import { traduzirErroDaMeta } from "./erros-da-meta";
import { chamarGraph, listarTudo } from "./graph";
import { garantirInscricaoDoApp, inscreverPagina, listarPaginasDoUsuario, urlDoWebhookDeFormulario } from "./paginas";
import { verifyTokenConfere, verifyTokenDoFormulario } from "./verificacao";

const SEGREDO = "segredo-do-app-da-meta-com-tamanho-ok";
const TOKEN = "EAAB-token-do-usuario-".padEnd(40, "x");

function fetchRoteado(rota: (url: string, init: RequestInit) => { corpo: unknown; status?: number }) {
  const espiao = vi.fn(async (url: string, init: RequestInit = {}) => {
    const r = rota(String(url), init);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  });
  return { espiao, fetch: espiao as unknown as typeof fetch };
}

describe("senha de verificação derivada", () => {
  it("é estável, depende do segredo e só confere com ele", () => {
    const a = verifyTokenDoFormulario(SEGREDO);
    expect(a).toBe(verifyTokenDoFormulario(SEGREDO));
    expect(a).toHaveLength(32);
    expect(a).not.toBe(verifyTokenDoFormulario(`${SEGREDO}x`));
    expect(a).not.toContain(SEGREDO);
    expect(verifyTokenConfere(a, SEGREDO)).toBe(true);
    expect(verifyTokenConfere(a, `${SEGREDO}x`)).toBe(false);
    expect(verifyTokenConfere("errado", SEGREDO)).toBe(false);
    expect(verifyTokenConfere(null, SEGREDO)).toBe(false);
    expect(verifyTokenConfere(a, null)).toBe(false);
  });
});

describe("traduzirErroDaMeta", () => {
  const recusada = (codigo: number | null, mensagem: string, status = 400) =>
    ({ ok: false as const, motivo: "recusada" as const, status, erro: { codigo, subcodigo: null, mensagem } });

  it("acesso a leads (Lead Access Manager) diz onde liberar", () => {
    const e = traduzirErroDaMeta(recusada(100, "Leads Access Manager: CRM not authorized"));
    expect(e.codigo).toBe("acesso_a_leads");
    expect(e.mensagem).toContain("Acesso a leads");
    expect(e.mensagem).toContain("CRMs");
  });

  it("login vencido pede para conectar de novo", () => {
    const e = traduzirErroDaMeta(recusada(190, "Error validating access token", 401));
    expect(e.codigo).toBe("login_vencido");
    expect(e.mensagem).toContain("Conectar formulários");
  });

  it("permissão não aprovada explica que hoje só quem tem função no app consegue", () => {
    const e = traduzirErroDaMeta(recusada(200, "(#200) Requires leads_retrieval permission", 403));
    expect(e.codigo).toBe("permissao_nao_aprovada");
    expect(e.mensagem).toContain("função no app");
  });

  it("permissão pedida pela Meta aparece pelo NOME (ex.: pages_manage_ads) e o texto original fica no detalhe técnico", () => {
    const e = traduzirErroDaMeta(recusada(200, "(#200) This endpoint requires the 'pages_manage_ads' permission", 403));
    expect(e.codigo).toBe("permissao_nao_aprovada");
    expect(e.mensagem).toContain("pages_manage_ads");
    expect(e.mensagem).toContain("Reconectar formulários");
    expect(e.detalheTecnico).toContain("requires the 'pages_manage_ads'");
  });

  it("sem poder sobre a Página, limite e Meta fora do ar têm frase própria", () => {
    expect(traduzirErroDaMeta(recusada(10, "Application does not have permission", 403)).codigo).toBe("sem_permissao_na_pagina");
    expect(traduzirErroDaMeta(recusada(4, "rate", 400)).codigo).toBe("limite_da_meta");
    expect(traduzirErroDaMeta({ ok: false, motivo: "rede", status: null, erro: null }).codigo).toBe("meta_fora_do_ar");
    expect(traduzirErroDaMeta(recusada(1, "unknown", 500)).codigo).toBe("meta_fora_do_ar");
    expect(traduzirErroDaMeta(recusada(999, "estranho", 400)).codigo).toBe("erro_da_meta");
  });

  it("nunca devolve o texto cru da Meta", () => {
    const e = traduzirErroDaMeta(recusada(999, "SECRET-DETAIL-IN-ENGLISH", 400));
    expect(e.mensagem).not.toContain("SECRET-DETAIL");
  });
});

describe("chamarGraph e listarTudo", () => {
  it("o token vai no cabeçalho; paginação por cursor, sem `paging.next` com token", async () => {
    const { espiao, fetch } = fetchRoteado((url) => {
      const depois = new URL(url).searchParams.get("after");
      return depois
        ? { corpo: { data: [{ id: "2" }], paging: { cursors: { after: "c2" } } } }
        : { corpo: { data: [{ id: "1" }], paging: { cursors: { after: "c1" }, next: "https://graph/x?access_token=VAZA" } } };
    });
    const r = await listarTudo<{ id: string }>({ caminho: "me/accounts", token: TOKEN, fetchImpl: fetch });
    expect(r).toMatchObject({ ok: true, itens: [{ id: "1" }, { id: "2" }] });
    for (const [url, init] of espiao.mock.calls) {
      expect(String(url)).not.toContain(TOKEN);
      expect(String(url)).not.toContain("access_token");
      expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(espiao).toHaveBeenCalledTimes(2);
  });

  it("erro no corpo de um 200 conta como recusa", async () => {
    const { fetch } = fetchRoteado(() => ({ corpo: { error: { code: 190, message: "x" } } }));
    const r = await chamarGraph({ caminho: "me", token: TOKEN, fetchImpl: fetch });
    expect(r).toMatchObject({ ok: false, motivo: "recusada" });
  });
});

describe("Páginas e inscrição", () => {
  it("lista só Páginas com id numérico e token; o token fica para o servidor", async () => {
    const { fetch } = fetchRoteado(() => ({
      corpo: {
        data: [
          { id: "924300437422209", name: "Danilo gestor", access_token: "PAGINA-".padEnd(30, "t") },
          { id: "123", name: "Sem token" },
          { id: "abc", name: "Id ruim", access_token: "PAGINA-".padEnd(30, "u") },
        ],
      },
    }));
    const r = await listarPaginasDoUsuario(TOKEN, { fetchImpl: fetch });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paginas.map((p) => p.id)).toEqual(["924300437422209"]);
  });

  it("inscreve a Página no campo leadgen, com o token da Página no cabeçalho", async () => {
    const { espiao, fetch } = fetchRoteado(() => ({ corpo: { success: true } }));
    await inscreverPagina("924300437422209", "TOKEN-DA-PAGINA", { fetchImpl: fetch });
    const [url, init] = espiao.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/924300437422209/subscribed_apps");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe("subscribed_fields=leadgen");
    expect(url).not.toContain("TOKEN-DA-PAGINA");
  });

  it("o app já inscrito na nossa URL não é reescrito (idempotente)", async () => {
    const url = urlDoWebhookDeFormulario("https://comercial.exemplo.com.br");
    const { espiao, fetch } = fetchRoteado(() => ({
      corpo: { data: [{ object: "page", callback_url: url, active: true, fields: [{ name: "leadgen" }] }] },
    }));
    const r = await garantirInscricaoDoApp({ appId: "1", appSecret: SEGREDO }, "https://comercial.exemplo.com.br", { fetchImpl: fetch });
    expect(r).toEqual({ ok: true, mudou: false });
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("app sem inscrição: cadastra URL, campo e a senha DERIVADA — token do app no cabeçalho, nunca na URL", async () => {
    const { espiao, fetch } = fetchRoteado((_u, init) =>
      init.method === "POST" ? { corpo: { success: true } } : { corpo: { data: [] } },
    );
    const r = await garantirInscricaoDoApp({ appId: "777", appSecret: SEGREDO }, "https://comercial.exemplo.com.br", { fetchImpl: fetch });
    expect(r).toEqual({ ok: true, mudou: true });
    const [url, init] = espiao.mock.calls[1]! as unknown as [string, RequestInit];
    expect(url).toContain("/777/subscriptions");
    expect(url).not.toContain(SEGREDO);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer 777|${SEGREDO}`);
    const corpo = new URLSearchParams(String(init.body));
    expect(corpo.get("object")).toBe("page");
    expect(corpo.get("fields")).toBe("leadgen");
    expect(corpo.get("callback_url")).toBe("https://comercial.exemplo.com.br/api/v1/webhooks/lead-ads");
    expect(corpo.get("verify_token")).toBe(verifyTokenDoFormulario(SEGREDO));
  });

  it("se a Meta recusar o cadastro do app, devolve a falha (a tela mostra o passo manual)", async () => {
    const { fetch } = fetchRoteado((_u, init) =>
      init.method === "POST" ? { corpo: { error: { code: 100, message: "callback" } }, status: 400 } : { corpo: { data: [] } },
    );
    const r = await garantirInscricaoDoApp({ appId: "777", appSecret: SEGREDO }, "https://comercial.exemplo.com.br", { fetchImpl: fetch });
    expect(r.ok).toBe(false);
  });
});
