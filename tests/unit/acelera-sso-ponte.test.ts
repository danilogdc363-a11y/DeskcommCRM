import { describe, expect, it } from "vitest";
import { pontaDeCarregamento } from "@/lib/acelera-sso/ponte";

describe("ponte do login único (ACELERA)", () => {
  it("mostra carregamento na cor da marca e redireciona com CSP por hash", async () => {
    const r = pontaDeCarregamento("/app", "Acelera CRM", "#FF7300");
    const html = await r.text();
    expect(html).toContain("Entrando no Acelera CRM");
    expect(html).toContain("#FF7300");
    expect(html).toContain('window.location.replace("/app")');
    const csp = r.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/script-src 'sha256-/);
    expect(csp).toMatch(/style-src 'sha256-/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("cor inválida cai no laranja e nome é escapado", async () => {
    const html = await pontaDeCarregamento("/app", "<b>x</b>", "red;}").text();
    expect(html).toContain("#FF7300");
    expect(html).not.toContain("<b>x</b>");
  });
});
