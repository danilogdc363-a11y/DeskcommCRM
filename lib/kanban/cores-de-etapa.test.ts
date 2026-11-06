import { describe, expect, it } from "vitest";

import {
  PALETA_DE_ETAPA,
  corDaEtapa,
  corDoTextoSobre,
  corPadraoDaPosicao,
  hexValido,
  normalizarHex,
} from "./cores-de-etapa";

describe("paleta", () => {
  it("tem 10 cores únicas, todas em #RRGGBB", () => {
    expect(PALETA_DE_ETAPA).toHaveLength(10);
    expect(new Set(PALETA_DE_ETAPA.map((c) => c.hex)).size).toBe(10);
    for (const c of PALETA_DE_ETAPA) expect(hexValido(c.hex)).toBe(true);
  });
});

describe("hex", () => {
  it("normaliza o que a pessoa digita", () => {
    expect(normalizarHex("ff7300")).toBe("#FF7300");
    expect(normalizarHex("  #ab12cd ")).toBe("#AB12CD");
  });
  it("recusa o que o banco recusaria", () => {
    for (const ruim of ["", "#fff", "#12345", "#1234567", "#GGGGGG", "azul", "#12 456"]) {
      expect(normalizarHex(ruim)).toBeNull();
    }
  });
});

describe("cor padrão por posição", () => {
  const comum = { is_won: false, is_lost: false };
  it("etapas vizinhas nascem com cores diferentes", () => {
    const cores = [0, 1, 2, 3, 4, 5, 6].map((p) => corPadraoDaPosicao(p, comum));
    expect(new Set(cores).size).toBe(7);
  });
  it("repete em ciclo e aguenta posição negativa", () => {
    expect(corPadraoDaPosicao(7, comum)).toBe(corPadraoDaPosicao(0, comum));
    expect(hexValido(corPadraoDaPosicao(-1, comum))).toBe(true);
  });
  it("ganho é verde, perda é vermelha, e as comuns nunca usam esses dois", () => {
    const verde = corPadraoDaPosicao(0, { is_won: true, is_lost: false });
    const vermelho = corPadraoDaPosicao(0, { is_won: false, is_lost: true });
    expect(verde).not.toBe(vermelho);
    for (let p = 0; p < 14; p++) {
      const c = corPadraoDaPosicao(p, comum);
      expect(c).not.toBe(verde);
      expect(c).not.toBe(vermelho);
    }
  });
});

describe("corDaEtapa", () => {
  it("usa a cor escolhida quando ela é válida", () => {
    expect(corDaEtapa({ color: "#123ABC", is_won: false, is_lost: false }, 3)).toBe("#123ABC");
  });
  it("cai na padrão quando não há cor, ou ela veio quebrada", () => {
    const padrao = corPadraoDaPosicao(3, { is_won: false, is_lost: false });
    expect(corDaEtapa({ color: null, is_won: false, is_lost: false }, 3)).toBe(padrao);
    expect(corDaEtapa({ color: "azul", is_won: false, is_lost: false }, 3)).toBe(padrao);
  });
});

describe("contraste do texto", () => {
  it("escolhe o lado que passa de 4.5:1 em todas as cores da paleta", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contraste = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x! + 0.05) / (y! + 0.05);
    };
    for (const c of PALETA_DE_ETAPA) {
      expect(contraste(c.hex, corDoTextoSobre(c.hex))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
