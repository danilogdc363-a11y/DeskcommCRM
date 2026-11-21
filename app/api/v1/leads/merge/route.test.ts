/**
 * POST /api/v1/leads/merge — a PORTA do "Unificar fichas". Quem prova a fusão de
 * verdade (FK pelo catálogo, lápide, transação) é
 * `tests/invariants/unificar-negocios.test.ts`, com Postgres.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";

const rpc = vi.fn();
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function chamar(corpo: unknown): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/v1/leads/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

const resultado = (previa: boolean) => ({
  previa,
  negocio_id: A,
  negocios_mesclados: [B, C],
  contatos_a_juntar: [],
  repontado: { "crm_lead_activities.lead_id": 2 },
  nao_repontado: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID } as never,
    org: { orgId: ORG, name: "Org" } as never,
  });
  rpc.mockResolvedValue({ data: resultado(false), error: null });
});

describe("POST /leads/merge: quem pode e o que valida", () => {
  it("sem papel de gestor → 403, nada é chamado", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: "forbidden_role" } }, { status: 403 }),
    } as never);
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [B] });
    expect(requireRole).toHaveBeenCalledWith("manager", expect.anything());
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("principal entre os absorvidos → 422", async () => {
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [A, B] });
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("absorvido repetido → 422", async () => {
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [B, B] });
    expect(res.status).toBe(422);
  });

  it("nenhum absorvido → 422", async () => {
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [] });
    expect(res.status).toBe(422);
  });
});

describe("POST /leads/merge: prévia e unificação", () => {
  it("prévia chama a função com p_previa=true e NÃO audita", async () => {
    rpc.mockResolvedValue({ data: resultado(true), error: null });
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [B, C], preview: true });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_mesclar_negocios", {
      p_organization_id: ORG,
      p_negocio_principal: A,
      p_negocios_secundarios: [B, C],
      p_previa: true,
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("unificação usa a org da SESSÃO e audita quem, o quê e o que foi movido", async () => {
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [B, C] });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "fn_mesclar_negocios",
      expect.objectContaining({ p_organization_id: ORG, p_previa: false }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lead.merged",
        actorUserId: USER_ID,
        organizationId: ORG,
        resourceId: A,
        metadata: expect.objectContaining({
          merged_lead_ids: [B, C],
          repointed: { "crm_lead_activities.lead_id": 2 },
        }),
      }),
    );
  });

  it("negócio já unificado → 404 com mensagem leiga", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "negocio_secundario_indisponivel", code: "P0002" },
    });
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [B] });
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(404);
    expect(json.error.message).toMatch(/já ter sido unificado/);
    expect(audit).not.toHaveBeenCalled();
  });

  it("erro inesperado → 500 sem vazar a mensagem do banco", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "crm_x" does not exist', code: "42P01" },
    });
    const res = await chamar({ primary_lead_id: A, secondary_lead_ids: [B] });
    const texto = await res.text();
    expect(res.status).toBe(500);
    expect(texto).not.toContain("crm_x");
  });
});
