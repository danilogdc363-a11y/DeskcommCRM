/**
 * Login com o Facebook (Meta Ads): de onde vem o App ID/segredo e a renovação
 * sob demanda do token. Banco e Meta simulados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: vi.fn(async (_admin: unknown, valor: string) => valor.replace(/^enc:/, "")),
  encryptWebhookSecret: vi.fn(async (_admin: unknown, valor: string) => `enc:${valor}`),
}));

import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { appDeLoginDaMeta, appDeLoginDoAmbiente } from "@/lib/plataformas-de-anuncio/meta/login/app";

type Linha = Record<string, unknown> | null;

/** Cliente mínimo: `from(tabela).select().eq()...maybeSingle()` e `update().eq().eq()`. */
function bancoSimulado(tabelas: Record<string, Linha>, atualizacoes: Array<{ tabela: string; valores: unknown }> = []) {
  return {
    from(tabela: string) {
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: async () => ({ data: tabelas[tabela] ?? null, error: null }),
        update: (valores: unknown) => {
          atualizacoes.push({ tabela, valores });
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
      return cadeia;
    },
  } as never;
}

describe("app do login com o Facebook", () => {
  it("o .env só vale com ID e segredo juntos", () => {
    expect(appDeLoginDoAmbiente({ META_APP_ID: "1", META_APP_SECRET: "" })).toBeNull();
    expect(appDeLoginDoAmbiente({ META_APP_ID: "  ", META_APP_SECRET: "s" })).toBeNull();
    expect(appDeLoginDoAmbiente({ META_APP_ID: "123", META_APP_SECRET: "s" })).toEqual({ appId: "123", appSecret: "s" });
  });

  it("banco primeiro: o par do banco vence o do .env", async () => {
    const admin = bancoSimulado({ platform_meta_app: { app_id: "999", app_secret_encrypted: "enc:do-banco" } });
    expect(await appDeLoginDaMeta(admin, { META_APP_ID: "1", META_APP_SECRET: "do-env" })).toEqual({
      appId: "999",
      appSecret: "do-banco",
    });
  });

  it("não mistura as origens: ID do banco sem segredo cai inteiro para o .env", async () => {
    const admin = bancoSimulado({ platform_meta_app: { app_id: "999", app_secret_encrypted: null } });
    expect(await appDeLoginDaMeta(admin, { META_APP_ID: "1", META_APP_SECRET: "do-env" })).toEqual({
      appId: "1",
      appSecret: "do-env",
    });
  });

  it("sem nada em lugar nenhum devolve null (e não lança)", async () => {
    const admin = bancoSimulado({ platform_meta_app: null });
    expect(await appDeLoginDaMeta(admin, {})).toBeNull();
  });
});

describe("renovação sob demanda do token", () => {
  const AGORA = new Date("2026-11-05T12:00:00Z");
  const dia = 24 * 3600 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "segredo-do-app");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function meta(resposta: Response) {
    const f = vi.fn(async () => resposta);
    vi.stubGlobal("fetch", f);
    return f;
  }

  function conexao(expiraEm: string | null) {
    return {
      platform_meta_app: null,
      ad_insights_connections: {
        access_token_encrypted: "enc:" + "A".repeat(30),
        default_account_id: "act_1",
        token_expires_at: expiraEm,
      },
    };
  }

  it("falta pouco: troca, grava o novo e devolve o novo", async () => {
    const atualizacoes: Array<{ tabela: string; valores: unknown }> = [];
    const f = meta(new Response(JSON.stringify({ access_token: "N".repeat(40), expires_in: 5184000 })));
    const admin = bancoSimulado(conexao(new Date(AGORA.getTime() + 2 * dia).toISOString()), atualizacoes);

    const r = await lerCredencialDeLeitura(admin, "org-1", "meta_ads");

    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, credencial: { accessToken: "N".repeat(40), contaPadrao: "act_1" } });
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]!.valores).toMatchObject({ access_token_encrypted: "enc:" + "N".repeat(40) });
  });

  it("longe de vencer: não chama a Meta", async () => {
    const f = meta(new Response("{}"));
    const admin = bancoSimulado(conexao(new Date(AGORA.getTime() + 30 * dia).toISOString()));
    const r = await lerCredencialDeLeitura(admin, "org-1", "meta_ads");
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, credencial: { accessToken: "A".repeat(30) } });
  });

  it("token colado à mão (sem vencimento): nunca renova", async () => {
    const f = meta(new Response("{}"));
    const r = await lerCredencialDeLeitura(bancoSimulado(conexao(null)), "org-1", "meta_ads");
    expect(f).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("a Meta recusa a renovação: a leitura segue com o token que existe", async () => {
    meta(new Response(JSON.stringify({ error: { message: "x" } }), { status: 400 }));
    const atualizacoes: Array<{ tabela: string; valores: unknown }> = [];
    const admin = bancoSimulado(conexao(new Date(AGORA.getTime() + 1 * dia).toISOString()), atualizacoes);
    const r = await lerCredencialDeLeitura(admin, "org-1", "meta_ads");
    expect(r).toMatchObject({ ok: true, credencial: { accessToken: "A".repeat(30) } });
    expect(atualizacoes).toHaveLength(0);
  });

  it("já vencido: não tenta renovar", async () => {
    const f = meta(new Response("{}"));
    const admin = bancoSimulado(conexao(new Date(AGORA.getTime() - dia).toISOString()));
    await lerCredencialDeLeitura(admin, "org-1", "meta_ads");
    expect(f).not.toHaveBeenCalled();
  });
});
