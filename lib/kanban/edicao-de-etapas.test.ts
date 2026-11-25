import { describe, expect, it } from "vitest";

import {
  depoisDeParaEtapaNova,
  depoisDeParaMover,
  destinosAoArquivar,
  etapaQueNasceu,
  etapasDaResposta,
} from "./edicao-de-etapas";

const etapa = (id: string, papel: "won" | "lost" | null = null) => ({
  id,
  name: id,
  is_won: papel === "won",
  is_lost: papel === "lost",
});

const funil = [etapa("novo"), etapa("atendimento"), etapa("proposta"), etapa("ganho", "won"), etapa("perdido", "lost")];

describe("depoisDeParaMover", () => {
  it("para a esquerda, o vizinho novo é a etapa duas colunas antes", () => {
    expect(depoisDeParaMover(funil, "proposta", "esquerda")).toBe("novo");
  });

  it("a segunda coluna indo para a esquerda vira a primeira (null)", () => {
    expect(depoisDeParaMover(funil, "atendimento", "esquerda")).toBeNull();
  });

  it("para a direita, o vizinho novo é a coluna da direita", () => {
    expect(depoisDeParaMover(funil, "novo", "direita")).toBe("atendimento");
  });

  it("nas pontas não há para onde ir", () => {
    expect(depoisDeParaMover(funil, "novo", "esquerda")).toBeUndefined();
    expect(depoisDeParaMover(funil, "perdido", "direita")).toBeUndefined();
  });

  it("etapa que não está na lista não move", () => {
    expect(depoisDeParaMover(funil, "sumiu", "direita")).toBeUndefined();
  });
});

describe("depoisDeParaEtapaNova", () => {
  it("encaixa antes das colunas de fechamento e perda", () => {
    expect(depoisDeParaEtapaNova(funil)).toBe("proposta");
  });

  it("funil sem fechamento no fim: a etapa fica onde a rota pôs", () => {
    expect(depoisDeParaEtapaNova([etapa("a"), etapa("b")])).toBeUndefined();
  });

  it("só fechamento e perda: a nova vira a primeira", () => {
    expect(depoisDeParaEtapaNova([etapa("ganho", "won"), etapa("perdido", "lost")])).toBeNull();
  });

  it("funil vazio: nada a mover", () => {
    expect(depoisDeParaEtapaNova([])).toBeUndefined();
  });
});

describe("etapaQueNasceu", () => {
  it("acha a etapa que não existia antes", () => {
    expect(etapaQueNasceu(funil, [...funil, etapa("nova")])?.id).toBe("nova");
  });

  it("nada novo: undefined", () => {
    expect(etapaQueNasceu(funil, funil)).toBeUndefined();
  });
});

describe("destinosAoArquivar", () => {
  it("oferece todas as outras etapas, na ordem", () => {
    expect(destinosAoArquivar(funil, "atendimento").map((e) => e.id)).toEqual([
      "novo",
      "proposta",
      "ganho",
      "perdido",
    ]);
  });
});

describe("etapasDaResposta", () => {
  it("lê as etapas do corpo da rota", () => {
    expect(etapasDaResposta({ data: { etapas: [{ id: "a" }, { id: "b" }] } })).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("corpo fora do formato vira lista vazia", () => {
    expect(etapasDaResposta(null)).toEqual([]);
    expect(etapasDaResposta({ data: {} })).toEqual([]);
    expect(etapasDaResposta({ data: { etapas: [{ nome: "sem id" }] } })).toEqual([]);
  });
});
