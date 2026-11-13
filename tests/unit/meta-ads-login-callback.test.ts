/**
 * GET /api/v1/meta-ads/oauth/callback — a volta do "Conectar com o Facebook".
 * Tudo simulado: banco, Meta, cifra. Nenhuma chamada real.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEGREDO = "segredo-interno-de-teste-bem-comprido";
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const upserts: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
let nonceJaUsado = false;

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://comercial.aceleradelivery.com", INTERNAL_SECRET: "segredo-interno-de-teste-bem-comprido" },
}));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: vi.fn(async () => ({ nome: "Acelera CRM" })) }));
vi.mock("@/lib/impersonate/support", () => ({ supportCallbackWriteAllowed: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: vi.fn(async (_a: unknown, v: string) => `enc:${v}`),
  decryptWebhookSecret: vi.fn(async (_a: unknown, v: string) => v.replace(/^enc:/, "")),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: async () => (nonceJaUsado ? { error: { code: "23505" } } : { error: null }),
      upsert: async (valores: Record<string, unknown>) => {
        upserts.push({ tabela, valores });
        return { error: null };
      },
    }),
  }),
}));

import { assinarVinculo, NOME_DO_VINCULO } from "@/lib/agenda/google/vinculo";
import { emitirEstado } from "@/lib/plataformas-de-anuncio/meta/login/estado";

import { GET } from "@/app/api/v1/meta-ads/oauth/callback/route";

type Volta = Response & { html: string };

async function chamar(query: Record<string, string>, comVinculo = true, nonce = "nonce-1"): Promise<Volta> {
  const url = new URL("https://comercial.aceleradelivery.com/api/v1/meta-ads/oauth/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = new Headers();
  if (comVinculo) headers.set("cookie", `${NOME_DO_VINCULO}=${assinarVinculo(nonce, SEGREDO)}`);
  const r = await GET(new NextRequest(url, { headers }));
  return Object.assign(r, { html: await r.clone().text() });
}

function stateValido(nonce = "nonce-1") {
  return emitirEstado({ organizationId: ORG, userId: USER }, { segredo: SEGREDO, agora: new Date(), nonce });
}

// A volta é uma PÁGINA-PONTE (200 + `location.replace`), nunca um 302: o destino
// está no link de fallback do documento.
function destino(r: Volta) {
  const href = /<a href="([^"]+)"/.exec(r.html)?.[1] ?? "";
  return new URL(href.replace(/&amp;/g, "&"), "https://comercial.aceleradelivery.com");
}

describe("callback do login com o Facebook", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    upserts.length = 0;
    nonceJaUsado = false;
    vi.unstubAllGlobals();
    vi.stubEnv("META_APP_ID", "123456789");
    vi.stubEnv("META_APP_SECRET", "segredo-do-app");
  });

  it("volta por ponte (200 com HTML), nunca por redirect: o cookie de sessão é Strict", async () => {
    const r = await chamar({ error: "access_denied" });
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.html).toContain("window.location.replace(");
    expect(r.html).toContain("/app/settings/meta-ads?erro=cancelado");
    // só o cookie de vínculo é limpo; nenhum cookie de sessão é tocado
    const cookies = r.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${NOME_DO_VINCULO}=;`);
  });

  it("cancelar no Facebook volta com erro=cancelado, sem tocar no banco", async () => {
    const r = await chamar({ error: "access_denied" });
    expect(destino(r).pathname).toBe("/app/settings/meta-ads");
    expect(destino(r).searchParams.get("erro")).toBe("cancelado");
    expect(upserts).toHaveLength(0);
  });

  it("outra recusa da Meta vira meta_recusou", async () => {
    const r = await chamar({ error: "invalid_scope" });
    expect(destino(r).searchParams.get("erro")).toBe("meta_recusou");
  });

  it("sem META_APP_ID/META_APP_SECRET no ambiente: volta com app_nao_configurado e não gasta o code", async () => {
    vi.stubEnv("META_APP_ID", "");
    const fetchSimulado = vi.fn();
    vi.stubGlobal("fetch", fetchSimulado);
    const r = await chamar({ code: "c", state: stateValido() });
    expect(destino(r).searchParams.get("erro")).toBe("app_nao_configurado");
    expect(fetchSimulado).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("state inválido é recusado", async () => {
    const r = await chamar({ code: "c", state: "lixo.lixo" });
    expect(destino(r).searchParams.get("erro")).toBe("estado_invalido");
    expect(upserts).toHaveLength(0);
  });

  it("sem o cookie de vínculo (outro navegador) é recusado", async () => {
    const r = await chamar({ code: "c", state: stateValido() }, false);
    expect(destino(r).searchParams.get("erro")).toBe("estado_invalido");
    expect(upserts).toHaveLength(0);
  });

  it("state repetido (nonce já queimado) é recusado antes de gastar o code", async () => {
    nonceJaUsado = true;
    const fetchSimulado = vi.fn();
    vi.stubGlobal("fetch", fetchSimulado);
    const r = await chamar({ code: "c", state: stateValido() });
    expect(destino(r).searchParams.get("erro")).toBe("estado_invalido");
    expect(fetchSimulado).not.toHaveBeenCalled();
  });

  it("caminho feliz: troca duas vezes, cifra e grava só o token de longa duração com vencimento", async () => {
    const respostas = [
      { access_token: "C".repeat(40) },
      { access_token: "L".repeat(40), expires_in: 5184000 },
    ];
    const fetchSimulado = vi.fn(async () => new Response(JSON.stringify(respostas.shift())));
    vi.stubGlobal("fetch", fetchSimulado);

    const r = await chamar({ code: "codigo-1", state: stateValido() });

    expect(destino(r).searchParams.get("ok")).toBe("1");
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(upserts).toHaveLength(1);
    const gravado = upserts[0]!;
    expect(gravado.tabela).toBe("ad_insights_connections");
    expect(gravado.valores).toMatchObject({
      organization_id: ORG,
      platform: "meta_ads",
      access_token_encrypted: "enc:" + "L".repeat(40),
    });
    expect(typeof gravado.valores.token_expires_at).toBe("string");
    // Não mexe na conta padrão que a pessoa já escolheu.
    expect(gravado.valores).not.toHaveProperty("default_account_id");
    // O token nunca vai para a URL de volta.
    expect(r.html).not.toContain("L".repeat(20));
  });

  it("Meta diz recurso indisponível: explica na tela e não grava nada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "Feature Unavailable" } }), { status: 400 })),
    );
    const r = await chamar({ code: "c", state: stateValido() });
    expect(destino(r).searchParams.get("erro")).toBe("meta_recusou");
    expect(upserts).toHaveLength(0);
  });
});
