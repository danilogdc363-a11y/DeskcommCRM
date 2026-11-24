/** (Acelera) Recuperar leads do formulário nativo preenchidos antes do webhook. */
import { describe, expect, it, vi } from "vitest";

import { idsDeLeadDosFormulariosDesde, importarLeadDaMeta } from "@/lib/acelera/lead-ads";

const env = { ACELERA_LEADS_PAGE_TOKEN: "t", ACELERA_LEADS_INBOUND_URL: "https://crm/in/x" };
const json = (corpo: unknown) => new Response(JSON.stringify(corpo));

describe("idsDeLeadDosFormulariosDesde", () => {
  it("percorre todos os formulários e páginas, filtra pela data e tira repetidos", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/me/leadgen_forms")) return json({ data: [{ id: "f1" }, { id: "f2" }] });
      if (url.includes("/f1/leads") && !url.includes("pagina2"))
        return json({
          data: [{ id: "1" }, { id: "2" }],
          paging: { next: "https://g/f1/leads?pagina2" },
        });
      if (url.includes("pagina2")) return json({ data: [{ id: "3" }] });
      if (url.includes("/f2/leads")) return json({ data: [{ id: "2" }, { id: "lixo" }] });
      return new Response(null, { status: 404 });
    });

    const ids = await idsDeLeadDosFormulariosDesde(new Date("2026-11-01T03:00:00Z"), {
      fetch: fetch as never,
      env,
    });

    expect(ids).toEqual(["1", "2", "3"]);
    const urlDoFiltro = decodeURIComponent(String(fetch.mock.calls[1]?.[0]));
    expect(urlDoFiltro).toContain('"field":"time_created"');
    expect(urlDoFiltro).toContain('"value":1793502000');
  });

  it("recusa sem token e quando a Meta nega", async () => {
    await expect(idsDeLeadDosFormulariosDesde(new Date(), { env: {} })).rejects.toThrow(
      "lead_ads_nao_configurado",
    );
    const negado = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(
      idsDeLeadDosFormulariosDesde(new Date(), { fetch: negado as never, env }),
    ).rejects.toThrow("graph_403");
  });
});

describe("importarLeadDaMeta com avisar: false", () => {
  it("grava o lead e não chama o aviso do comercial", async () => {
    const fetch = vi.fn(async () => json({ id: "123", platform: "ig", field_data: [] }));
    await importarLeadDaMeta("123", {
      fetch: fetch as never,
      env: { ...env, ACELERA_LEADS_AVISO_URL: "https://os/aviso", ACELERA_LEADS_AVISO_SECRET: "s" },
      avisar: false,
    });
    const urls = fetch.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("os/aviso"))).toBe(false);
    expect(urls).toContain("https://crm/in/x");
  });
});
