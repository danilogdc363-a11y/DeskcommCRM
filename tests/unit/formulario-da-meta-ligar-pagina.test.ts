/**
 * Ligar, desligar e receber pela PÁGINA — a regra de posse e o que nunca vaza.
 *
 * O banco é simulado por um construtor encadeável que registra cada consulta:
 * o que se mede é (a) o filtro por empresa em TODA consulta, (b) que o token da
 * Página só existe cifrado e nunca sai em resposta, e (c) o desfecho de cada
 * recusa (Página de outra empresa, destino que sumiu, Meta recusando).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAGINA = "924300437422209";
const TOKEN_DA_PAGINA = "EAAB-token-da-pagina-".padEnd(40, "p");

type Linha = Record<string, unknown> | null;
const cenario = {
  etapaExiste: true,
  fonteDaPagina: null as Linha,
  insercao: { data: { id: "fonte-nova" }, error: null } as { data: Linha; error: { code?: string; message: string } | null },
  credencial: { ok: true, credencial: { accessToken: "token-do-usuario-".padEnd(30, "u"), contaPadrao: null } } as unknown,
  paginas: { ok: true, paginas: [{ id: PAGINA, nome: "Danilo gestor", tokenDaPagina: TOKEN_DA_PAGINA }] } as unknown,
  inscricaoDaPagina: { ok: true, dados: { success: true } } as unknown,
  inscricaoDoApp: { ok: true, mudou: true } as unknown,
};
const consultas: { tabela: string; filtros: Record<string, unknown>; op: string; valores?: Record<string, unknown> }[] = [];
const auditorias: Record<string, unknown>[] = [];
const desinscritas: string[] = [];

function construtor(tabela: string) {
  const reg = { tabela, filtros: {} as Record<string, unknown>, op: "select", valores: undefined as Record<string, unknown> | undefined };
  consultas.push(reg);
  const resultado = (): { data: Linha; error: { code?: string; message: string } | null } => {
    if (reg.op === "insert") return cenario.insercao;
    if (tabela === "crm_stages") return { data: cenario.etapaExiste ? { id: "s" } : null, error: null };
    if (tabela === "webhook_sources") return { data: cenario.fonteDaPagina, error: null };
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {};
  const encadear = (nome: string, fn?: (...a: unknown[]) => void) =>
    (b[nome] = (...a: unknown[]) => {
      fn?.(...a);
      return b;
    });
  encadear("select");
  encadear("eq", (c, v) => (reg.filtros[c as string] = v));
  encadear("not", (c) => (reg.filtros[`${c as string}:not-null`] = true));
  encadear("update", (v) => ((reg.op = "update"), (reg.valores = v as Record<string, unknown>)));
  encadear("insert", (v) => ((reg.op = "insert"), (reg.valores = v as Record<string, unknown>)));
  b.maybeSingle = async () => resultado();
  b.single = async () => resultado();
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: reg.op === "update" ? null : null }).then(ok);
  return b;
}

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (a: Record<string, unknown>) => void auditorias.push(a)) }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais-de-leitura", () => ({ lerCredencialDeLeitura: vi.fn(async () => cenario.credencial) }));
vi.mock("@/lib/plataformas-de-anuncio/meta/login/app", () => ({ appDeLoginDaMeta: () => ({ appId: "723939443513987", appSecret: "segredo-do-app-da-meta-com-tamanho-ok" }) }));
vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: vi.fn(async (_a: unknown, v: string) => `\\xenc-${v}`),
  decryptWebhookSecret: vi.fn(async (_a: unknown, v: string) => v.replace("\\xenc-", "")),
}));
vi.mock("@/lib/leads/lead-ads/paginas", () => ({
  listarPaginasDoUsuario: vi.fn(async () => cenario.paginas),
  permissoesConcedidas: vi.fn(async () => ({ ok: true, concedidas: ["ads_read", "leads_retrieval", "pages_show_list", "pages_manage_metadata", "pages_read_engagement", "pages_manage_ads"] })),
  inscreverPagina: vi.fn(async () => cenario.inscricaoDaPagina),
  desinscreverPagina: vi.fn(async (id: string) => (desinscritas.push(id), { ok: true, dados: {} })),
  paginaEstaInscrita: vi.fn(async () => ({ ok: true, inscrita: true })),
  garantirInscricaoDoApp: vi.fn(async () => cenario.inscricaoDoApp),
}));

import { conectarPagina, desconectarPagina, listarPaginasDaEmpresa } from "@/lib/leads/lead-ads/conexao";

const admin = { from: construtor } as never;
const entrada = {
  organizationId: ORG,
  userId: USER,
  pageId: PAGINA,
  funilId: "p",
  etapaId: "s",
  baseDoApp: "https://comercial.exemplo.com.br",
  requestId: "rid",
};

beforeEach(() => {
  consultas.length = 0;
  auditorias.length = 0;
  desinscritas.length = 0;
  cenario.etapaExiste = true;
  cenario.fonteDaPagina = null;
  cenario.insercao = { data: { id: "fonte-nova" }, error: null };
  cenario.credencial = { ok: true, credencial: { accessToken: "token-do-usuario-".padEnd(30, "u"), contaPadrao: null } };
  cenario.paginas = { ok: true, paginas: [{ id: PAGINA, nome: "Danilo gestor", tokenDaPagina: TOKEN_DA_PAGINA }] };
  cenario.inscricaoDaPagina = { ok: true, dados: { success: true } };
  cenario.inscricaoDoApp = { ok: true, mudou: true };
});

describe("conectarPagina", () => {
  it("liga: grava a fonte DA EMPRESA com o token cifrado, busca ligada, e audita sem o token", async () => {
    const r = await conectarPagina(admin, entrada);
    expect(r).toEqual({ ok: true, fonteId: "fonte-nova", avisoDoApp: null });
    const gravacao = consultas.find((c) => c.tabela === "webhook_sources" && c.op === "insert")!;
    expect(gravacao.valores).toMatchObject({
      organization_id: ORG,
      meta_page_id: PAGINA,
      meta_lead_retrieval: true,
      is_active: true,
      default_pipeline_id: "p",
      default_stage_id: "s",
      created_by_user_id: USER,
    });
    expect(String(gravacao.valores!.meta_page_token_encrypted)).toBe(`\\xenc-${TOKEN_DA_PAGINA}`);
    expect(JSON.stringify(gravacao.valores)).not.toContain(`"${TOKEN_DA_PAGINA}"`);
    expect(String(gravacao.valores!.path_token).length).toBeGreaterThan(20);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ action: "meta_lead_ads.page_connected", organizationId: ORG });
    expect(JSON.stringify(auditorias[0])).not.toContain(TOKEN_DA_PAGINA);
  });

  it("o funil/etapa precisam ser DESTA empresa (a consulta filtra por organization_id)", async () => {
    cenario.etapaExiste = false;
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: false, codigo: "destino_invalido", status: 422 });
    const c = consultas.find((q) => q.tabela === "crm_stages")!;
    expect(c.filtros).toMatchObject({ organization_id: ORG, pipeline_id: "p", id: "s" });
    expect(consultas.some((q) => q.op === "insert")).toBe(false);
  });

  it("Página já ligada a OUTRA empresa: 409 e nada é gravado nem inscrito", async () => {
    cenario.fonteDaPagina = { id: "fonte-alheia", organization_id: OUTRA };
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: false, codigo: "pagina_de_outra_empresa", status: 409 });
    expect(consultas.some((q) => q.op === "insert" || q.op === "update")).toBe(false);
  });

  it("Página já ligada à MESMA empresa: atualiza a fonte (trocar funil/etapa), não duplica", async () => {
    cenario.fonteDaPagina = { id: "fonte-minha", organization_id: ORG };
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: true, fonteId: "fonte-minha" });
    const a = consultas.find((q) => q.op === "update")!;
    expect(a.filtros).toMatchObject({ organization_id: ORG, id: "fonte-minha" });
    expect(consultas.some((q) => q.op === "insert")).toBe(false);
  });

  it("sem login de formulários feito: pede para conectar, sem tocar a Meta", async () => {
    cenario.credencial = { ok: false, motivo: "sem_conexao" };
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: false, codigo: "sem_login", status: 409 });
  });

  it("Página que a pessoa não administra não aparece na Meta: 404 claro", async () => {
    cenario.paginas = { ok: true, paginas: [] };
    expect(await conectarPagina(admin, entrada)).toMatchObject({ ok: false, codigo: "pagina_nao_encontrada", status: 404 });
  });

  it("a Meta recusa ligar a Página (acesso a leads): a frase diz o que fazer e NADA fica gravado", async () => {
    cenario.inscricaoDaPagina = { ok: false, motivo: "recusada", status: 400, erro: { codigo: 100, subcodigo: null, mensagem: "Leads Access Manager: CRM not authorized" } };
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: false, codigo: "acesso_a_leads" });
    if (!r.ok) expect(r.mensagem).toContain("Acesso a leads");
    expect(consultas.some((q) => q.op === "insert" || q.op === "update")).toBe(false);
  });

  it("a Meta não aceita cadastrar o endereço no app: a Página liga e a tela mostra o único passo manual", async () => {
    cenario.inscricaoDoApp = { ok: false, motivo: "recusada", status: 400, erro: null };
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.avisoDoApp).toContain("passo único");
  });

  it("falha ao gravar depois de inscrever: desinscreve a Página (nada fica meio ligado)", async () => {
    cenario.insercao = { data: null, error: { message: "banco caiu" } };
    const r = await conectarPagina(admin, entrada);
    expect(r).toMatchObject({ ok: false, codigo: "erro_ao_gravar" });
    expect(desinscritas).toEqual([PAGINA]);
  });
});

describe("desconectarPagina", () => {
  it("solta a Página e apaga o token, só na fonte DESTA empresa; a fonte fica pausada para o histórico", async () => {
    cenario.fonteDaPagina = { id: "fonte-minha", organization_id: ORG, meta_page_token_encrypted: `\\xenc-${TOKEN_DA_PAGINA}`, meta_lead_retrieval: true, is_active: true };
    const r = await desconectarPagina(admin, { organizationId: ORG, userId: USER, pageId: PAGINA, requestId: "rid" });
    expect(r).toEqual({ ok: true });
    const leitura = consultas.find((q) => q.op === "select" && q.tabela === "webhook_sources")!;
    expect(leitura.filtros).toMatchObject({ organization_id: ORG, meta_page_id: PAGINA });
    const a = consultas.find((q) => q.op === "update")!;
    expect(a.filtros).toMatchObject({ organization_id: ORG, id: "fonte-minha" });
    expect(a.valores).toMatchObject({ meta_page_id: null, meta_page_token_encrypted: null, is_active: false });
    expect(desinscritas).toEqual([PAGINA]);
    expect(auditorias[0]).toMatchObject({ action: "meta_lead_ads.page_disconnected" });
  });

  it("Página que não é desta empresa: 404 (não confirma que existe em outra)", async () => {
    cenario.fonteDaPagina = null;
    expect(await desconectarPagina(admin, { organizationId: ORG, userId: USER, pageId: PAGINA, requestId: "rid" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("listarPaginasDaEmpresa", () => {
  it("login sem pages_manage_ads (conexão antiga): pede para reconectar, não finge que está tudo certo", async () => {
    const mod = await import("@/lib/leads/lead-ads/paginas");
    vi.mocked(mod.permissoesConcedidas).mockResolvedValueOnce({
      ok: true,
      concedidas: ["ads_read", "leads_retrieval", "pages_show_list", "pages_manage_metadata", "pages_read_engagement"],
    });
    const r = await listarPaginasDaEmpresa(admin, ORG);
    expect(r.loginFeito).toBe(false);
    expect(r.permissoesFaltando).toEqual(["pages_manage_ads"]);
    expect(r.aviso).toContain("Conectar formulários");
  });

  it("sem login de formulários: não chama a Meta e diz o que fazer", async () => {
    cenario.credencial = { ok: false, motivo: "sem_conexao" };
    const r = await listarPaginasDaEmpresa(admin, ORG);
    expect(r.loginFeito).toBe(false);
    expect(r.aviso).toContain("Conectar formulários");
  });

  it("com login: lista as Páginas da pessoa e NUNCA devolve token", async () => {
    const r = await listarPaginasDaEmpresa(admin, ORG);
    expect(r.loginFeito).toBe(true);
    expect(r.paginas).toEqual([expect.objectContaining({ id: PAGINA, nome: "Danilo gestor", conectada: false })]);
    expect(JSON.stringify(r)).not.toContain(TOKEN_DA_PAGINA);
    const leitura = consultas.find((q) => q.tabela === "webhook_sources")!;
    expect(leitura.filtros).toMatchObject({ organization_id: ORG });
  });
});
