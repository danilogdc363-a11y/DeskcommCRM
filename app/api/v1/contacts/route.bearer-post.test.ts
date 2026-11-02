import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createContactHandler } from "./_handler";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/legal/perfil-do-pais", async () => {
  const actual = await vi.importActual<typeof import("@/lib/legal/perfil-do-pais")>(
    "@/lib/legal/perfil-do-pais",
  );
  return { ...actual, perfilDaOrganizacao: vi.fn(async () => actual.perfilDoPais("BR")) };
});
vi.mock("./_handler", () => ({
  listContactsHandler: vi.fn(),
  createContactHandler: vi.fn(async () => ({ id: "c1" })),
}));
vi.mock("@/lib/mcp/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/auth")>("@/lib/mcp/auth");
  return { ...actual, validateBearerToken: vi.fn() };
});

const { validateBearerToken } = await import("@/lib/mcp/auth");
const ORG = "22222222-2222-4222-8222-222222222222";

function token(scopes: string[]) {
  vi.mocked(validateBearerToken).mockResolvedValue({
    organizationId: ORG,
    role: "agent" as never,
    actor: { type: "ai_agent", id: "t", role: "agent" as never, api_token_id: "t" },
    apiTokenId: "t",
    scopes,
  });
}

function post() {
  return new NextRequest("http://localhost/api/v1/contacts", {
    method: "POST",
    headers: { authorization: "Bearer dsk_x", "content-type": "application/json" },
    body: JSON.stringify({ name: "Lead", phone_number: "+5511999998888", source: "formulario" }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/v1/contacts com Bearer", () => {
  it("mcp:write cria na org do token", async () => {
    token(["mcp:write"]);
    const { POST } = await import("./route");
    const res = await POST(post());
    expect(res.status).toBe(201);
    expect(vi.mocked(createContactHandler).mock.calls[0]?.[1]).toMatchObject({
      organization_id: ORG,
    });
  });

  it("só mcp:read é recusado", async () => {
    token(["mcp:read"]);
    const { POST } = await import("./route");
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(createContactHandler).not.toHaveBeenCalled();
  });
});
