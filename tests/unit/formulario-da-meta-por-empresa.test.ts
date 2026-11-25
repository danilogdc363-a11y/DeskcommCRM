/**
 * Formulário da Meta POR EMPRESA (Acelera) — as garantias que não podem
 * quebrar quando várias empresas dividem o mesmo app e a mesma URL:
 *
 *  1. o login de formulários é pedido à parte e o `state` carrega o propósito;
 *  2. a URL de aviso só responde ao desafio com a senha DERIVADA do segredo;
 *  3. o aviso é recusado sem assinatura, ANTES de qualquer leitura de banco;
 *  4. cada lead vai para a empresa dona da PÁGINA — nunca para outra — e
 *     página que ninguém ligou não escreve em lugar nenhum;
 *  5. falha de um lead não derruba o lote, e só falha NOSSA pede reenvio.
 */
import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEGREDO_DO_APP = "segredo-do-app-da-meta-com-tamanho-ok";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAGINA_A = "111111111111111";
const PAGINA_B = "222222222222222";

const fontes = [
  { id: "fonte-a", name: "Formulário da Meta — Loja A", organization_id: ORG_A, default_pipeline_id: "p-a", default_stage_id: "s-a", is_active: true, meta_page_id: PAGINA_A, meta_lead_retrieval: true, meta_page_token_encrypted: "\\xaa" },
  { id: "fonte-b", name: "Formulário da Meta — Loja B", organization_id: ORG_B, default_pipeline_id: "p-b", default_stage_id: "s-b", is_active: true, meta_page_id: PAGINA_B, meta_lead_retrieval: true, meta_page_token_encrypted: "\\xbb" },
];
const consultas: { tabela: string; pagina: string[] }[] = [];
const recebidos: { fonteId: string; org: string; leadgen: string }[] = [];
let receberLanca: (leadgen: string) => unknown = () => undefined;

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/channels/meta/app", () => ({
  appDaMeta: vi.fn(async () => ({ appSecret: "segredo-do-app-da-meta-com-tamanho-ok", verifyToken: null })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => ({
        in: async (_coluna: string, paginas: string[]) => {
          consultas.push({ tabela, pagina: paginas });
          return { data: fontes.filter((f) => paginas.includes(f.meta_page_id)), error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/leads/lead-ads/receber", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/leads/lead-ads/receber")>();
  return {
    ...real,
    receberLead: vi.fn(async (_admin: unknown, fonte: { id: string; organizationId: string }, lead: { leadgenId: string }) => {
      recebidos.push({ fonteId: fonte.id, org: fonte.organizationId, leadgen: lead.leadgenId });
      const erro = receberLanca(lead.leadgenId);
      if (erro) throw erro;
      return { estado: "entrou", leadId: "l", contatoId: "c" };
    }),
  };
});

import { GET, POST } from "@/app/api/v1/webhooks/lead-ads/route";
import { ApiError } from "@/lib/api/types";
import { emitirEstado, verificarEstado } from "@/lib/plataformas-de-anuncio/meta/login/estado";
import { ESCOPO_DE_FORMULARIOS, ESCOPO_DE_LEITURA, montarUrlDeLogin } from "@/lib/plataformas-de-anuncio/meta/login/oauth";
import { verifyTokenDoFormulario } from "@/lib/leads/lead-ads/verificacao";

const URL_DO_AVISO = "https://comercial.exemplo.com.br/api/v1/webhooks/lead-ads";

function aviso(...leads: { pagina: string; leadgen: string }[]) {
  return JSON.stringify({
    object: "page",
    entry: leads.map((l) => ({
      id: l.pagina,
      time: Math.floor(Date.now() / 1000),
      changes: [{ field: "leadgen", value: { leadgen_id: l.leadgen, page_id: l.pagina, form_id: "9", created_time: 1 } }],
    })),
  });
}

function postar(corpo: string, segredo: string | null = SEGREDO_DO_APP) {
  const headers = new Headers({ "content-type": "application/json" });
  if (segredo) headers.set("x-hub-signature-256", `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`);
  return POST(new NextRequest(URL_DO_AVISO, { method: "POST", headers, body: corpo }));
}

beforeEach(() => {
  consultas.length = 0;
  recebidos.length = 0;
  receberLanca = () => undefined;
});

describe("login de formulários, à parte do de anúncios", () => {
  const app = { appId: "723939443513987", appSecret: SEGREDO_DO_APP };
  const opcoes = { state: "x", redirectUri: "https://comercial.exemplo.com.br/api/v1/meta-ads/oauth/callback" };

  it("sem propósito pede SÓ ads_read (o login de anúncios não muda)", () => {
    const scope = new URL(montarUrlDeLogin(app, opcoes)).searchParams.get("scope");
    expect(scope).toBe(ESCOPO_DE_LEITURA);
  });

  it("com propósito `formularios` pede também as cinco permissões de formulário (inclui pages_manage_ads, que a Meta exige para listar os formulários)", () => {
    const scope = new URL(montarUrlDeLogin(app, { ...opcoes, para: "formularios" })).searchParams.get("scope")!;
    expect(scope.split(",")).toEqual(["ads_read", "leads_retrieval", "pages_show_list", "pages_manage_metadata", "pages_read_engagement", "pages_manage_ads"]);
    expect(ESCOPO_DE_FORMULARIOS).toHaveLength(5);
  });

  const segredo = "segredo-interno-de-teste-bem-comprido";
  const base = { organizationId: ORG_A, userId: "22222222-2222-4222-8222-222222222222" };

  it("o propósito viaja no `state` assinado, com e sem sessão", () => {
    const agora = new Date();
    for (const authSessionId of [undefined, "sessao-1"]) {
      const s = emitirEstado({ ...base, authSessionId, para: "formularios" }, { segredo, agora, nonce: "n1" });
      expect(verificarEstado(s, { segredo, agora })).toMatchObject({ organizationId: ORG_A, nonce: "n1", para: "formularios", ...(authSessionId ? { authSessionId } : {}) });
    }
  });

  it("state sem propósito segue válido e sem `para` (estados emitidos antes continuam funcionando)", () => {
    const agora = new Date();
    const s = emitirEstado({ ...base, authSessionId: "sessao-1" }, { segredo, agora, nonce: "n2" });
    const lido = verificarEstado(s, { segredo, agora });
    expect(lido).toMatchObject({ authSessionId: "sessao-1" });
    expect(lido?.para).toBeUndefined();
  });

  it("propósito adulterado ou desconhecido é recusado", () => {
    const agora = new Date();
    const s = emitirEstado({ ...base, para: "formularios" }, { segredo, agora, nonce: "n3" });
    const [carga, assinatura] = s.split(".");
    const adulterada = Buffer.from(Buffer.from(carga!, "base64url").toString("utf8").replace("formularios", "outracoisa")).toString("base64url");
    expect(verificarEstado(`${adulterada}.${assinatura}`, { segredo, agora })).toBeNull();
  });
});

describe("segredo do ambiente diferente do segredo gravado no banco (tela Admin)", () => {
  const DO_AMBIENTE = "segredo-do-app-do-login-no-ambiente-ok";

  beforeEach(() => vi.stubEnv("META_APP_SECRET", DO_AMBIENTE));
  afterEach(() => vi.unstubAllEnvs());

  it("o aviso assinado com o segredo do ambiente (app do login) entra, mesmo o banco guardando outro", async () => {
    const r = await postar(aviso({ pagina: PAGINA_A, leadgen: "1001" }), DO_AMBIENTE);
    expect(r.status).toBe(200);
    expect(recebidos.map((x) => x.leadgen)).toEqual(["1001"]);
  });

  it("o assinado com o segredo do banco continua entrando", async () => {
    const r = await postar(aviso({ pagina: PAGINA_A, leadgen: "1002" }), SEGREDO_DO_APP);
    expect(r.status).toBe(200);
    expect(recebidos.map((x) => x.leadgen)).toEqual(["1002"]);
  });

  it("segredo de qualquer outro app continua recusado", async () => {
    expect((await postar(aviso({ pagina: PAGINA_A, leadgen: "1003" }), "segredo-de-um-terceiro-qualquer-12345")).status).toBe(401);
    expect(recebidos).toHaveLength(0);
  });

  it("a conferência da URL pela Meta aceita a senha derivada de qualquer um dos dois segredos", async () => {
    const consulta = (token: string) =>
      GET(new NextRequest(`${URL_DO_AVISO}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc`));
    expect((await consulta(verifyTokenDoFormulario(DO_AMBIENTE))).status).toBe(200);
    expect((await consulta(verifyTokenDoFormulario(SEGREDO_DO_APP))).status).toBe(200);
    expect((await consulta(verifyTokenDoFormulario("outro-segredo-qualquer-do-mundo-12345"))).status).toBe(403);
  });
});

describe("GET — a Meta confere a URL", () => {
  const consulta = (token: string) =>
    GET(new NextRequest(`${URL_DO_AVISO}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=desafio-123`));

  it("devolve o desafio em texto puro com a senha derivada do segredo do app", async () => {
    const r = await consulta(verifyTokenDoFormulario(SEGREDO_DO_APP));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("desafio-123");
    expect(r.headers.get("content-type")).toContain("text/plain");
  });

  it("senha errada: 403, sem eco do desafio", async () => {
    const r = await consulta("qualquer-coisa");
    expect(r.status).toBe(403);
    expect(await r.text()).toBe("");
  });
});

describe("POST — o aviso do formulário", () => {
  it("sem assinatura ou com assinatura de outro segredo: 401 e NADA é lido", async () => {
    const corpo = aviso({ pagina: PAGINA_A, leadgen: "1001" });
    expect((await postar(corpo, null)).status).toBe(401);
    expect((await postar(corpo, "segredo-de-outro-app-qualquer-um-ok")).status).toBe(401);
    expect(consultas).toHaveLength(0);
    expect(recebidos).toHaveLength(0);
  });

  it("cada lead vai para a empresa dona da PÁGINA, mesmo vindos no mesmo lote", async () => {
    const r = await postar(aviso({ pagina: PAGINA_A, leadgen: "1001" }, { pagina: PAGINA_B, leadgen: "2002" }));
    expect(r.status).toBe(200);
    expect(recebidos).toEqual(
      expect.arrayContaining([
        { fonteId: "fonte-a", org: ORG_A, leadgen: "1001" },
        { fonteId: "fonte-b", org: ORG_B, leadgen: "2002" },
      ]),
    );
    expect(recebidos).toHaveLength(2);
    // Uma consulta só, por página — a empresa nunca vem do corpo.
    expect(consultas).toEqual([{ tabela: "webhook_sources", pagina: [PAGINA_A, PAGINA_B] }]);
  });

  it("Página que nenhuma empresa ligou: 200 e nada é escrito (a Meta não reenvia para sempre)", async () => {
    const r = await postar(aviso({ pagina: "999999999999999", leadgen: "3003" }));
    expect(r.status).toBe(200);
    expect(recebidos).toHaveLength(0);
  });

  it("lead recusado pelo funil (ApiError) não pede reenvio e não segura os outros do lote", async () => {
    receberLanca = (id) => (id === "1001" ? new ApiError(422, "stage_pipeline_mismatch", undefined, "rid", "x") : undefined);
    const r = await postar(aviso({ pagina: PAGINA_A, leadgen: "1001" }, { pagina: PAGINA_B, leadgen: "2002" }));
    expect(r.status).toBe(200);
    expect(recebidos.map((x) => x.leadgen).sort()).toEqual(["1001", "2002"]);
  });

  it("falha NOSSA (erro inesperado) responde 500 para a Meta reenviar — e o outro lead entrou", async () => {
    receberLanca = (id) => (id === "1001" ? new Error("banco caiu") : undefined);
    const r = await postar(aviso({ pagina: PAGINA_A, leadgen: "1001" }, { pagina: PAGINA_B, leadgen: "2002" }));
    expect(r.status).toBe(500);
    expect(recebidos.map((x) => x.leadgen).sort()).toEqual(["1001", "2002"]);
  });

  it("JSON quebrado com assinatura boa: 400", async () => {
    expect((await postar("{isso nao e json")).status).toBe(400);
  });
});
