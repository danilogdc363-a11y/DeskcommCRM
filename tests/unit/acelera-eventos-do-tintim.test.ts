/** (Acelera) Os nomes do Tintim continuam valendo nas regras por etapa. */
import { describe, expect, it } from "vitest";

import { ehEventoDaMeta, eventoDaEtapaTemSaida } from "@/lib/conversoes/regras-meta";

describe("eventos do Tintim", () => {
  it.each(["Contact", "Respondidos", "Schedule"])("%s é aceito e exige conexão direta", (nome) => {
    expect(ehEventoDaMeta(nome)).toBe(true);
    expect(eventoDaEtapaTemSaida(nome, true)).toBe(true);
    expect(eventoDaEtapaTemSaida(nome, false)).toBe(false);
  });
});
