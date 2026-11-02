import { describe, expect, it } from "vitest";
import { urlDoNovoCliente } from "./novo-cliente-url";

describe("urlDoNovoCliente", () => {
  it("acrescenta o lead à tela do OS", () => {
    expect(urlDoNovoCliente("https://os.exemplo.com/app/acelera/empresas/novo", "abc")).toBe(
      "https://os.exemplo.com/app/acelera/empresas/novo?crmLead=abc",
    );
  });

  it.each([undefined, null, "", "  ", "nao-e-url", "javascript:alert(1)"])(
    "sem base válida (%s) não há link",
    (base) => {
      expect(urlDoNovoCliente(base, "abc")).toBeNull();
    },
  );
});
