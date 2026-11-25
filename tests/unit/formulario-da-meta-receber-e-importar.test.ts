/**
 * Receber UM lead e "Trazer leads antigos": o miolo que o aviso e o botão
 * compartilham. Mede que lead sem resposta NUNCA vira card inventado, que o
 * motivo vai para "Leads recebidos", e que clicar de novo não duplica nem
 * relê a Meta para quem já entrou.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGINA = "924300437422209";

const registros: Record<string, unknown>[] = [];
const entradas: string[] = [];
const jaEntraram = new Set<string>();
const leituras: string[] = [];
let leituraDaMeta: (id: string) => unknown;

vi.mock("@/lib/webhooks/captacao", async (o) => ({
  ...(await o<typeof import("@/lib/webhooks/captacao")>()),
  registrarCaptacao: vi.fn(async (_a: unknown, c: Record<string, unknown>) => void registros.push(c)),
}));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: vi.fn(async (_a: unknown, v: string) => (v === "\\xruim" ? null : "token-da-pagina-".padEnd(30, "t"))),
}));
vi.mock("@/lib/leads/lead-ads/entrada", () => ({
  cardPeloLeadgenId: vi.fn(async (_a: unknown, _o: string, id: string) => (jaEntraram.has(id) ? { id: `card-${id}`, contactId: "c" } : null)),
  entradaDoLeadDoFormulario: vi.fn(async (_a: unknown, _f: unknown, lead: { leadgenId: string }) => {
    entradas.push(lead.leadgenId);
    return { leadgenId: lead.leadgenId, desfecho: "criado", leadId: "l", contatoId: "c" };
  }),
}));
vi.mock("@/lib/leads/lead-ads/respostas-na-meta", async (o) => ({
  ...(await o<typeof import("@/lib/leads/lead-ads/respostas-na-meta")>()),
  buscarRespostasDoLead: vi.fn(async ({ leadgenId }: { leadgenId: string }) => {
    leituras.push(leadgenId);
    return leituraDaMeta(leadgenId);
  }),
}));
const paginasDaGraph = { formularios: ["555"], leads: ["1", "2", "3"] as string[] };
vi.mock("@/lib/leads/lead-ads/graph", async (o) => ({
  ...(await o<typeof import("@/lib/leads/lead-ads/graph")>()),
  listarTudo: vi.fn(async (p: { caminho: string; consulta?: Record<string, string> }) => {
    if (p.caminho.endsWith("/leadgen_forms")) return { ok: true, itens: paginasDaGraph.formularios.map((id) => ({ id })), cortou: false };
    return { ok: true, itens: paginasDaGraph.leads.map((id) => ({ id })), cortou: false, filtro: p.consulta?.filtering };
  }),
}));

import { importarLeadsAntigos } from "@/lib/leads/lead-ads/conexao";
import { fonteDaPagina, leadSoComIds, receberLead } from "@/lib/leads/lead-ads/receber";

const bom = (_id: string) => ({
  ok: true,
  respostas: [
    { campo: "full_name", valor: "Maria" },
    { campo: "phone_number", valor: "+5511988887777" },
  ],
  origem: { adId: "1", adNome: "A", adsetId: "2", adsetNome: "C", campaignId: "3", campaignNome: "Camp", formId: "f1", plataforma: "fb", criadoEm: 1 },
});

function fonte(extra: Record<string, unknown> = {}) {
  return fonteDaPagina({
    id: "fonte-a",
    name: "Formulário da Meta — Loja",
    organization_id: ORG,
    default_pipeline_id: "p",
    default_stage_id: "s",
    is_active: true,
    meta_page_id: PAGINA,
    meta_lead_retrieval: true,
    meta_page_token_encrypted: "\\xok",
    ...extra,
  });
}

/** Cliente mínimo: só `from("webhook_sources")` encadeado até `maybeSingle`. */
function adminCom(linha: Record<string, unknown> | null) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: linha, error: null });
  return { from: () => b } as never;
}

const ctx = () => ({ requestId: "rid", tokens: new Map<string, string | null>() });

beforeEach(() => {
  registros.length = 0;
  entradas.length = 0;
  leituras.length = 0;
  jaEntraram.clear();
  leituraDaMeta = bom;
  paginasDaGraph.leads = ["1", "2", "3"];
});

describe("receberLead", () => {
  it("caminho bom: lê a Meta com o token da Página e entra pelo escritor do CRM", async () => {
    const r = await receberLead({} as never, fonte(), leadSoComIds("1", PAGINA), ctx());
    expect(r).toMatchObject({ estado: "entrou" });
    expect(leituras).toEqual(["1"]);
    expect(entradas).toEqual(["1"]);
  });

  it("fonte pausada: não lê a Meta, não cria nada, e o motivo aparece em Leads recebidos", async () => {
    const r = await receberLead({} as never, fonte({ is_active: false }), leadSoComIds("1", PAGINA), ctx());
    expect(r).toMatchObject({ estado: "ignorado", motivo: "pagina_desligada" });
    expect(leituras).toEqual([]);
    expect(entradas).toEqual([]);
    expect(registros[0]).toMatchObject({ organizationId: ORG, webhookSourceId: "fonte-a", outcome: "recusado", rejectReason: "lead_ads_fonte_pausada" });
  });

  it("token que não decifra: não inventa dado — registra o motivo", async () => {
    const r = await receberLead({} as never, fonte({ meta_page_token_encrypted: "\\xruim" }), leadSoComIds("1", PAGINA), ctx());
    expect(r).toMatchObject({ estado: "ignorado", motivo: "sem_respostas_na_meta", detalhe: "token_indecifravel" });
    expect(entradas).toEqual([]);
    expect(registros[0]).toMatchObject({ rejectReason: "lead_ads_busca_falhou" });
  });

  it("a Meta recusa a leitura: nenhum card em branco, e a frase em português volta para a tela", async () => {
    leituraDaMeta = () => ({
      ok: false,
      motivo: "recusada_pela_meta",
      detalhe: "http_403_codigo_100",
      erro: { codigo: "acesso_a_leads", mensagem: "Libere o acesso a leads" },
    });
    const r = await receberLead({} as never, fonte(), leadSoComIds("1", PAGINA), ctx());
    expect(r).toMatchObject({ estado: "ignorado", erro: { codigo: "acesso_a_leads" } });
    expect(entradas).toEqual([]);
    expect(registros[0]).toMatchObject({ rejectReason: "lead_ads_busca_falhou", fields: expect.objectContaining({ leadgen_id: "1", page_id: PAGINA }) });
  });

  it("busca desligada na fonte: ignora com o motivo certo, sem chamar a Meta", async () => {
    const r = await receberLead({} as never, fonte({ meta_lead_retrieval: false }), leadSoComIds("1", PAGINA), ctx());
    expect(r).toMatchObject({ estado: "ignorado", motivo: "sem_field_data" });
    expect(leituras).toEqual([]);
  });

  it("leads antigos: quem já entrou é pulado SEM ler a Meta e SEM nova linha em Leads recebidos", async () => {
    jaEntraram.add("1");
    const r = await receberLead({} as never, fonte(), leadSoComIds("1", PAGINA), { ...ctx(), pularSeJaEntrou: true });
    expect(r).toMatchObject({ estado: "duplicado" });
    expect(leituras).toEqual([]);
    expect(registros).toEqual([]);
  });

  it("o token é decifrado uma vez por lote, mesmo com vários leads", async () => {
    const c = ctx();
    await receberLead({} as never, fonte(), leadSoComIds("1", PAGINA), c);
    await receberLead({} as never, fonte(), leadSoComIds("2", PAGINA), c);
    expect(c.tokens.size).toBe(1);
  });
});

describe("importarLeadsAntigos", () => {
  const entrada = { organizationId: ORG, pageId: PAGINA, dias: 30, requestId: "rid", agora: new Date("2026-11-24T12:00:00Z") };

  it("só olha a Página DESTA empresa e conta entraram / já existiam", async () => {
    jaEntraram.add("2");
    const r = await importarLeadsAntigos(adminCom({ id: "fonte-a", name: "x", organization_id: ORG, default_pipeline_id: "p", default_stage_id: "s", is_active: true, meta_page_id: PAGINA, meta_lead_retrieval: true, meta_page_token_encrypted: "\\xok" }), entrada);
    expect(r).toMatchObject({ ok: true, encontrados: 3, entraram: 2, jaExistiam: 1, falharam: 0, parouNoLimite: false });
    expect(entradas.sort()).toEqual(["1", "3"]);
    expect(leituras.sort()).toEqual(["1", "3"]);
  });

  it("Página que não é desta empresa: 404, nada é lido", async () => {
    const r = await importarLeadsAntigos(adminCom(null), entrada);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(leituras).toEqual([]);
  });

  it("lote grande: para no limite do clique e avisa que dá para continuar", async () => {
    paginasDaGraph.leads = Array.from({ length: 400 }, (_, i) => String(1000 + i));
    const r = await importarLeadsAntigos(adminCom({ id: "fonte-a", name: "x", organization_id: ORG, default_pipeline_id: "p", default_stage_id: "s", is_active: true, meta_page_id: PAGINA, meta_lead_retrieval: true, meta_page_token_encrypted: "\\xok" }), entrada);
    expect(r).toMatchObject({ ok: true, parouNoLimite: true });
    if (r.ok) expect(r.entraram).toBeLessThanOrEqual(155);
  });
});

describe("aviso do comercial pelo OS (legado transitório)", () => {
  it("avisa só o card que nasceu agora; lead antigo importado e reentrega NÃO avisam", async () => {
    const aviso = await import("@/lib/leads/lead-ads/aviso-do-os");
    const espiao = vi.spyOn(aviso, "avisarComercialPeloOs").mockResolvedValue(undefined);
    await receberLead({} as never, fonte(), leadSoComIds("7", PAGINA), ctx());
    expect(espiao).toHaveBeenCalledTimes(1);
    await receberLead({} as never, fonte(), leadSoComIds("8", PAGINA), { ...ctx(), semAviso: true });
    expect(espiao).toHaveBeenCalledTimes(1);
    espiao.mockRestore();
  });

  it("sem as duas variáveis não chama ninguém; com elas, assina com carimbo e não vaza o segredo", async () => {
    const { avisarComercialPeloOs } = await import("@/lib/leads/lead-ads/aviso-do-os");
    const lead = leadSoComIds("9", PAGINA, { nome: "Maria", telefone: "+5511988887777", plataforma: "ig", campos: { cidade: "SP" } });
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await avisarComercialPeloOs(lead, { fetch: f as unknown as typeof fetch, env: {} });
    expect(f).not.toHaveBeenCalled();
    await avisarComercialPeloOs(lead, { fetch: f as unknown as typeof fetch, env: { ACELERA_LEADS_AVISO_URL: "https://os.exemplo/aviso", ACELERA_LEADS_AVISO_SECRET: "s3gredo-do-aviso" }, agora: 1_000_000 });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ nome: "Maria", telefone: "+5511988887777", plataforma: "instagram", respostas: { cidade: "SP" } });
    const cab = (init.headers as Record<string, string>)["x-webhook-signature"]!;
    expect(cab).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
    expect(JSON.stringify(init)).not.toContain("s3gredo-do-aviso");
  });
});
