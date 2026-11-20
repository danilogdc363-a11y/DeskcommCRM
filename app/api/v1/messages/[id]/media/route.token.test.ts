/**
 * ACELERA (fork) — GET /api/v1/messages/{id}/media com `Bearer dsk_…`.
 *
 * O Acelera OS baixa o áudio do histórico comercial para transcrever. Prova:
 *  - token com `mcp:read` → a mídia sai, e a organização é a da LINHA DO TOKEN
 *    (o filtro `organization_id` da consulta usa ela);
 *  - mensagem de outra organização → 404, mesmo com token válido;
 *  - token recusado (sem escopo, inválido) → a resposta do autenticador, nada lido;
 *  - sem Bearer → caminho de sessão de sempre (o token nem é consultado).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ orgAtivaDaApi: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));
vi.mock("@/lib/messaging/media/voice-transcode", () => ({
  ConversorOcupado: class extends Error {},
  TETO_REPRODUCAO_BYTES: 16 * 1024 * 1024,
  paraReproducaoAac: vi.fn(),
}));

import { resolveAuthDual } from "@/lib/api/auth-dual";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { GET } from "./route";

const ORG_DO_TOKEN = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const MENSAGEM = "55555555-5555-4555-8555-555555555555";

type Linha = Record<string, unknown>;
let MENSAGENS: Linha[] = [];
const FILTROS: Array<[string, unknown]> = [];
const ASSINADOS: string[] = [];

function adminFake() {
  return {
    from: () => {
      const filtros: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          FILTROS.push([c, v]);
          return q;
        },
        maybeSingle: async () => ({
          data: MENSAGENS.find((m) => filtros.every(([c, v]) => m[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          ASSINADOS.push(path);
          return { data: { signedUrl: `https://storage.test/${path}?token=t` }, error: null };
        },
      }),
    },
  };
}

function audio(org: string): Linha {
  return {
    id: MENSAGEM,
    organization_id: org,
    media_url: null,
    media_mime: "audio/ogg",
    media_size_bytes: 1000,
    media_storage_path: `${org}/conv/${MENSAGEM}.ogg`,
    metadata: null,
    channel_session_id: null,
  };
}

function pedido(auth?: string) {
  return new NextRequest(`http://localhost/api/v1/messages/${MENSAGEM}/media`, {
    headers: auth ? { authorization: auth } : {},
  });
}
const PARAMS = { params: Promise.resolve({ id: MENSAGEM }) };

beforeEach(() => {
  vi.clearAllMocks();
  MENSAGENS = [];
  FILTROS.length = 0;
  ASSINADOS.length = 0;
  vi.mocked(createAdminClient).mockReturnValue(adminFake() as never);
  vi.mocked(resolveAuthDual).mockResolvedValue({
    ok: true,
    organizationId: ORG_DO_TOKEN,
    actor: { type: "api_token", id: "tok" },
    supabase: adminFake(),
    via: "token",
    scopes: ["mcp:read"],
    apiTokenId: "tok-1",
  } as never);
});

describe("mídia com Bearer dsk_ (Acelera OS)", () => {
  it("token com mcp:read baixa o áudio da própria organização", async () => {
    MENSAGENS = [audio(ORG_DO_TOKEN)];
    const res = await GET(pedido("Bearer dsk_abc_def"), PARAMS);
    expect(res.status).toBe(302);
    expect(resolveAuthDual).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "mcp:read", role: "agent" }),
    );
    expect(FILTROS).toContainEqual(["organization_id", ORG_DO_TOKEN]);
    expect(ASSINADOS).toEqual([`${ORG_DO_TOKEN}/conv/${MENSAGEM}.ogg`]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("mensagem de outra organização → 404, nada assinado", async () => {
    MENSAGENS = [audio(OUTRA_ORG)];
    const res = await GET(pedido("Bearer dsk_abc_def"), PARAMS);
    expect(res.status).toBe(404);
    expect(ASSINADOS).toEqual([]);
  });

  it("token recusado → a resposta do autenticador, nada lido", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: "forbidden_role" } }, { status: 403 }),
    } as never);
    MENSAGENS = [audio(ORG_DO_TOKEN)];
    const res = await GET(pedido("Bearer dsk_abc_def"), PARAMS);
    expect(res.status).toBe(403);
    expect(FILTROS).toEqual([]);
    expect(ASSINADOS).toEqual([]);
  });

  it("sem Bearer segue o caminho de sessão e não consulta token", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    vi.mocked(loadAuthUser).mockResolvedValue(null as never);
    vi.mocked(orgAtivaDaApi).mockResolvedValue({ ok: true, org: null } as never);
    const res = await GET(pedido(), PARAMS);
    expect(res.status).toBe(401);
    expect(resolveAuthDual).not.toHaveBeenCalled();
  });
});

import { isPublicPath } from "@/lib/auth/public-paths";

describe("proxy deixa o Bearer chegar só à rota de mídia", () => {
  it("/messages/<uuid>/media passa; o resto de /messages/<id> segue só-sessão", () => {
    expect(isPublicPath(`/api/v1/messages/${MENSAGEM}/media`)).toBe(true);
    expect(isPublicPath(`/api/v1/messages/${MENSAGEM}`)).toBe(false);
    expect(isPublicPath(`/api/v1/messages/${MENSAGEM}/media/extra`)).toBe(false);
    expect(isPublicPath(`/api/v1/messages/qualquer/media`)).toBe(false);
  });
});
