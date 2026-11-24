/** (Acelera) Reenvio da Meta: sem aviso repetido e sem lote travado por um lead. */
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const env = {
  ACELERA_LEADS_PAGE_TOKEN: "t",
  ACELERA_LEADS_INBOUND_URL: "https://crm/in/x",
  ACELERA_LEADS_AVISO_URL: "https://os/aviso",
  ACELERA_LEADS_AVISO_SECRET: "s",
};
const lead = { id: "123", platform: "ig", field_data: [{ name: "full_name", values: ["Ana"] }] };
const captacao = (desfecho: string) =>
  new Response(JSON.stringify({ data: { lead_id: "l1", desfecho } }));

function fetchFalso(desfecho: string) {
  return vi.fn(async (url: string) => {
    if (url.startsWith("https://crm/in")) return captacao(desfecho);
    if (url.startsWith("https://os/aviso")) return new Response("{}");
    return new Response(JSON.stringify(lead));
  });
}

describe("importarLeadDaMeta avisa só lead novo", () => {
  it.each([
    ["criado", true],
    ["duplicado", false],
    ["atualizado", false],
  ])("desfecho %s → avisa: %s", async (desfecho, avisa) => {
    const { importarLeadDaMeta } = await import("@/lib/acelera/lead-ads");
    const fetch = fetchFalso(desfecho);
    await importarLeadDaMeta("123", { fetch: fetch as never, env });
    const urls = fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.includes("https://os/aviso")).toBe(avisa);
  });
});

describe("rota lead-ads com lote", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/acelera/lead-ads");
    vi.resetModules();
  });

  it("importa todos os leads mesmo se um falha, e responde 500 para a Meta reenviar", async () => {
    const importados: string[] = [];
    vi.doMock("@/lib/acelera/lead-ads", async (original) => ({
      ...(await original<typeof import("@/lib/acelera/lead-ads")>()),
      importarLeadDaMeta: vi.fn(async (id: string) => {
        if (id === "1") throw new Error("graph_400");
        importados.push(id);
      }),
    }));
    vi.stubEnv("ACELERA_LEADS_APP_SECRET", "segredo");
    const { POST } = await import("@/app/api/v1/webhooks/lead-ads/route");

    const corpo = JSON.stringify({
      entry: [
        { changes: ["1", "2", "3"].map((id) => ({ field: "leadgen", value: { leadgen_id: id } })) },
      ],
    });
    const assinatura = createHmac("sha256", "segredo").update(corpo).digest("hex");
    const { NextRequest } = await import("next/server");
    const resposta = await POST(
      new NextRequest("https://crm/api/v1/webhooks/lead-ads", {
        method: "POST",
        body: corpo,
        headers: { "x-hub-signature-256": `sha256=${assinatura}` },
      }),
    );

    expect(importados.sort()).toEqual(["2", "3"]);
    expect(resposta.status).toBe(500);
  });
});
