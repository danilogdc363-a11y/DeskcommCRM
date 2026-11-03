import { describe, expect, it } from "vitest";

import { celulaCsv, csvDeConversoes } from "./exportar-csv";
import type { LinhaDoHistorico } from "./historico";

const base: LinhaDoHistorico = {
  id: "1",
  leadId: "lead-1",
  tituloDoLead: "Maria",
  plataforma: "meta_ads",
  evento: "Purchase",
  status: "sent",
  motivo: null,
  detalhe: null,
  eventoId: null,
  protocolo: "fbtrace123",
  acaoGoogle: null,
  valorCentavos: 12345,
  moeda: "BRL",
  ocorridoEm: "2026-11-01T10:00:00Z",
  tentadoEm: "2026-11-01T10:00:05Z",
};

describe("celulaCsv", () => {
  it("protege aspas, vírgula e quebra de linha", () => {
    expect(celulaCsv('a "b", c\nd')).toBe('"a ""b"", c\nd"');
  });
  it("neutraliza fórmula", () => {
    expect(celulaCsv("=SOMA(A1)")).toBe("'=SOMA(A1)");
  });
  it("vazio vira célula vazia", () => {
    expect(celulaCsv(null)).toBe("");
  });
});

describe("csvDeConversoes", () => {
  it("escreve cabeçalho, valor em reais e situação", () => {
    const [cab = "", linha = ""] = csvDeConversoes([base]).replace("﻿", "").split("\n");
    expect(cab.startsWith("tentado_em,ocorrido_em,negocio")).toBe(true);
    expect(linha).toContain(",Maria,meta_ads,Purchase,entregue,,123.45,BRL,fbtrace123,");
  });
  it("não deixa nome de negócio virar fórmula", () => {
    const csv = csvDeConversoes([{ ...base, tituloDoLead: "=HYPERLINK(1)" }]);
    expect(csv).toContain("'=HYPERLINK(1)");
  });
  it("sem linhas, só o cabeçalho", () => {
    expect(csvDeConversoes([]).trim().split("\n")).toHaveLength(1);
  });
});
