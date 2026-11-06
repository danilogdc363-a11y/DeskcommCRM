/**
 * Login com o Facebook (Meta Ads): `state` assinado e chamadas OAuth.
 * A Meta é SEMPRE simulada: nenhuma chamada real, nenhum token real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitirEstado as emitirDoGoogle } from "@/lib/plataformas-de-anuncio/google/estado";
import { emitirEstado, verificarEstado } from "@/lib/plataformas-de-anuncio/meta/login/estado";
import {
  CAMINHO_DO_CALLBACK,
  montarUrlDeLogin,
  trocarCodigoPorToken,
  trocarPorTokenDeLongaDuracao,
  urlDeRetorno,
} from "@/lib/plataformas-de-anuncio/meta/login/oauth";

const SEGREDO = "segredo-de-teste-com-mais-de-16";
const AGORA = new Date("2026-11-05T12:00:00Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const APP = { appId: "123456789", appSecret: "segredo-do-app-de-teste" };

describe("state do login com o Facebook", () => {
  it("emite e verifica o que foi emitido", () => {
    const state = emitirEstado({ organizationId: ORG, userId: USER }, { segredo: SEGREDO, agora: AGORA, nonce: "abc" });
    expect(verificarEstado(state, { segredo: SEGREDO, agora: AGORA })).toMatchObject({
      organizationId: ORG,
      userId: USER,
      nonce: "abc",
    });
  });

  it("recusa state vencido (10 min)", () => {
    const state = emitirEstado({ organizationId: ORG, userId: USER }, { segredo: SEGREDO, agora: AGORA });
    const depois = new Date(AGORA.getTime() + 10 * 60 * 1000 + 1);
    expect(verificarEstado(state, { segredo: SEGREDO, agora: depois })).toBeNull();
  });

  it("recusa assinatura de outro segredo e carga adulterada", () => {
    const state = emitirEstado({ organizationId: ORG, userId: USER }, { segredo: SEGREDO, agora: AGORA });
    expect(verificarEstado(state, { segredo: "outro-segredo-bem-comprido", agora: AGORA })).toBeNull();
    const [carga, assinatura] = state.split(".");
    const adulterada = Buffer.from(Buffer.from(carga!, "base64url").toString().replace(ORG, "9".repeat(36))).toString("base64url");
    expect(verificarEstado(`${adulterada}.${assinatura}`, { segredo: SEGREDO, agora: AGORA })).toBeNull();
  });

  it("não aceita state emitido para o Google Ads, mesmo com o mesmo segredo", () => {
    const doGoogle = emitirDoGoogle({ organizationId: ORG, userId: USER }, { segredo: SEGREDO, agora: AGORA });
    expect(verificarEstado(doGoogle, { segredo: SEGREDO, agora: AGORA })).toBeNull();
  });

  it("recusa lixo sem lançar", () => {
    for (const lixo of [null, undefined, "", "a", "a.b.c", "!!.zz"]) {
      expect(verificarEstado(lixo, { segredo: SEGREDO, agora: AGORA })).toBeNull();
    }
  });

  it("preserva a sessão de quem iniciou", () => {
    const state = emitirEstado(
      { organizationId: ORG, userId: USER, authSessionId: "sess-1" },
      { segredo: SEGREDO, agora: AGORA },
    );
    expect(verificarEstado(state, { segredo: SEGREDO, agora: AGORA })?.authSessionId).toBe("sess-1");
  });
});

describe("URL de login", () => {
  it("pede SÓ ads_read e usa a URL de retorno exata", () => {
    const retorno = urlDeRetorno("https://comercial.aceleradelivery.com");
    expect(retorno).toBe("https://comercial.aceleradelivery.com/api/v1/meta-ads/oauth/callback");
    expect(CAMINHO_DO_CALLBACK).toBe("/api/v1/meta-ads/oauth/callback");

    const url = new URL(montarUrlDeLogin(APP, { state: "st", redirectUri: retorno }));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("scope")).toBe("ads_read");
    expect(url.searchParams.get("client_id")).toBe(APP.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(retorno);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.toString()).not.toContain(APP.appSecret);
  });
});

describe("troca de token (Meta simulada)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function simular(resposta: { status?: number; json?: unknown } | Error) {
    const fetchSimulado = vi.fn(async () => {
      if (resposta instanceof Error) throw resposta;
      return new Response(JSON.stringify(resposta.json ?? {}), { status: resposta.status ?? 200 });
    });
    vi.stubGlobal("fetch", fetchSimulado);
    return fetchSimulado;
  }

  it("troca o code, com o segredo no CORPO do POST e nunca na URL", async () => {
    const f = simular({ json: { access_token: "T".repeat(40), expires_in: 5000 } });
    const r = await trocarCodigoPorToken(APP, "codigo-1", { redirectUri: "https://x.test/cb", agora: AGORA });
    expect(r).toEqual({ ok: true, accessToken: "T".repeat(40), expiraEm: new Date(AGORA.getTime() + 5000 * 1000) });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/oauth/access_token");
    expect(url).not.toContain(APP.appSecret);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("client_secret=");
    expect(String(init.body)).toContain("code=codigo-1");
  });

  it("troca por token de longa duração; sem expires_in assume ~60 dias", async () => {
    const f = simular({ json: { access_token: "L".repeat(40) } });
    const r = await trocarPorTokenDeLongaDuracao(APP, "curto".repeat(6), { agora: AGORA });
    expect(r.ok && r.expiraEm.getTime() - AGORA.getTime()).toBe(60 * 24 * 3600 * 1000);
    expect(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain("grant_type=fb_exchange_token");
  });

  it("devolve recursoIndisponivel quando a Meta diz que o recurso não está disponível", async () => {
    simular({ status: 400, json: { error: { message: "Feature Unavailable: ads_read" } } });
    const r = await trocarCodigoPorToken(APP, "c", { redirectUri: "https://x.test/cb", agora: AGORA });
    expect(r).toMatchObject({ ok: false, motivo: "rejeitado", recursoIndisponivel: true });
  });

  it("recusa genérica não é 'recurso indisponível'", async () => {
    simular({ status: 400, json: { error: { message: "Invalid verification code format." } } });
    const r = await trocarCodigoPorToken(APP, "c", { redirectUri: "https://x.test/cb", agora: AGORA });
    expect(r).toMatchObject({ ok: false, recursoIndisponivel: false });
  });

  it("rede fora do ar e resposta sem token não lançam", async () => {
    simular(new Error("ECONNRESET"));
    expect(await trocarCodigoPorToken(APP, "c", { redirectUri: "x", agora: AGORA })).toMatchObject({
      ok: false,
      motivo: "indisponivel",
    });
    simular({ json: { foo: 1 } });
    expect(await trocarCodigoPorToken(APP, "c", { redirectUri: "x", agora: AGORA })).toMatchObject({
      ok: false,
      motivo: "resposta_invalida",
    });
  });
});
