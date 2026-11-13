import { beforeEach, describe, expect, it, vi } from "vitest";

const lerCredencial = vi.fn();
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({
  lerCredencial: (...a: unknown[]) => lerCredencial(...a),
}));

import { lerEstatisticasDoConjunto, proximaPagina } from "./estatisticas-do-conjunto";

const admin = {} as never;
const janela = { de: new Date("2026-11-10T08:00:00Z"), ate: new Date("2026-11-11T08:00:00Z") };
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  lerCredencial.mockReset();
  lerCredencial.mockResolvedValue({
    ok: true,
    credencial: { datasetId: "123", accessToken: "SEGREDO" },
  });
});

describe("lerEstatisticasDoConjunto", () => {
  it("token só no header, segue paging.next sem token na URL e soma as páginas", async () => {
    const urls: string[] = [];
    const headers: string[] = [];
    const buscar = vi.fn(async (url: URL | string, init?: RequestInit) => {
      urls.push(String(url));
      headers.push(String((init?.headers as Record<string, string>).authorization));
      if (urls.length === 1) {
        return resposta(200, {
          data: [{ start_time: "2026-11-10T08:00:00+0000", data: [{ value: "Purchase", count: 1 }] }],
          paging: { next: "https://graph.facebook.com/v22.0/123/stats?after=x&access_token=SEGREDO" },
        });
      }
      return resposta(200, {
        data: [{ start_time: "2026-11-10T20:00:00+0000", data: [{ value: "Purchase", count: 2 }] }],
      });
    });

    const r = await lerEstatisticasDoConjunto(admin, "org", janela, buscar as never);
    expect(r).toEqual({
      ok: true,
      datasetId: "123",
      contagens: [{ dia: "2026-11-10", evento: "Purchase", quantidade: 3 }],
    });
    expect(urls[0]).toContain("event_source=SERVER_ONLY");
    expect(urls.every((u) => !u.includes("SEGREDO"))).toBe(true);
    expect(headers).toEqual(["Bearer SEGREDO", "Bearer SEGREDO"]);
  });

  it("erro HTTP do Meta vira motivo genérico", async () => {
    const buscar = vi.fn(async () => resposta(400, { error: { message: "Invalid parameter" } }));
    expect(await lerEstatisticasDoConjunto(admin, "org", janela, buscar as never)).toEqual({
      ok: false,
      motivo: "recusado_pelo_meta",
    });
  });

  it("timeout vira falha_de_rede", async () => {
    const buscar = vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    expect(await lerEstatisticasDoConjunto(admin, "org", janela, buscar as never)).toEqual({
      ok: false,
      motivo: "falha_de_rede",
    });
  });

  it("sem conexão nem chama o Meta", async () => {
    lerCredencial.mockResolvedValue({ ok: false, motivo: "sem_conexao" });
    const buscar = vi.fn();
    expect(await lerEstatisticasDoConjunto(admin, "org", janela, buscar as never)).toEqual({
      ok: false,
      motivo: "sem_conexao",
    });
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("proximaPagina", () => {
  it("não segue para outro host", () => {
    expect(
      proximaPagina("https://evil.example/x?access_token=a", "https://graph.facebook.com"),
    ).toBeNull();
  });
});
