import { describe, expect, it } from "vitest";
import { formatarReais, rotuloDoRepontado, sugerirPrincipal } from "./unificar-fichas";

describe("sugerirPrincipal", () => {
  it("prefere o ganho mais antigo (caso Bizzio: @bizziopizza de julho, não o Jeferson de hoje)", () => {
    expect(
      sugerirPrincipal([
        { id: "jef-aberto", created_at: "2026-11-18T16:45:00Z", status: "open" },
        { id: "jef-ganho", created_at: "2026-11-18T16:16:00Z", status: "won" },
        { id: "bizzio", created_at: "2026-07-04T03:43:49Z", status: "won" },
      ]),
    ).toBe("bizzio");
  });

  it("sem ganho, fica o mais antigo", () => {
    expect(
      sugerirPrincipal([
        { id: "b", created_at: "2026-02-01T00:00:00Z", status: "open" },
        { id: "a", created_at: "2026-01-01T00:00:00Z", status: "lost" },
      ]),
    ).toBe("a");
  });

  it("lista vazia → null", () => {
    expect(sugerirPrincipal([])).toBeNull();
  });
});

describe("rótulos", () => {
  it("tabela conhecida vira texto de quem opera", () => {
    expect(rotuloDoRepontado("crm_lead_activities.lead_id")).toMatch(/atividade/);
  });
  it("tabela desconhecida não quebra", () => {
    expect(rotuloDoRepontado("tabela_nova.lead_id")).toBe("registro(s) de tabela nova");
  });
  it("valor em reais", () => {
    expect(formatarReais(250000)).toMatch(/2\.500,00/);
    expect(formatarReais(null)).toBe("sem valor");
  });
});
