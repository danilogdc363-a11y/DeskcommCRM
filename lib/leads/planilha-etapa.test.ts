import { describe, expect, it } from "vitest";

import { lerPlanilhaDeLeads, resolverEtapas, type EtapaDoFunil } from "./planilha";

describe("lerPlanilhaDeLeads — coluna etapa", () => {
  it("lê a etapa (com ou sem acento no cabeçalho) e deixa nula quando a célula está vazia", () => {
    const r = lerPlanilhaDeLeads("nome;Estágio\nAna Souza;Proposta\nBruno Lima;\n");
    if ("erro" in r) throw new Error(r.erro);
    expect(r.leads.map((l) => l.etapa)).toEqual(["Proposta", null]);
    expect(r.colunasIgnoradas).toEqual([]);
  });

  it("aceita CSV com BOM e aspas ao redor da etapa", () => {
    const r = lerPlanilhaDeLeads('﻿nome,etapa\n"Silva, Maria","Em  negociação"\n');
    if ("erro" in r) throw new Error(r.erro);
    expect(r.leads[0]).toMatchObject({ title: "Silva, Maria", etapa: "Em negociação" });
  });

  it("telefone sem DDI ganha +55, também quando vem da matriz do XLSX", () => {
    const r = lerPlanilhaDeLeads([
      ["nome", "telefone"],
      ["Ana", "11988887777"],
    ]);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.leads[0]!.telefone).toBe("+5511988887777");
  });
});

describe("resolverEtapas", () => {
  const etapas: EtapaDoFunil[] = [
    { id: "e1", name: "Novo", is_won: false, is_lost: false },
    { id: "e2", name: "Em negociação", is_won: false, is_lost: false },
    { id: "e3", name: "Ganho", is_won: true, is_lost: false },
    { id: "e4", name: "Perdido", is_won: false, is_lost: true },
  ];
  const lead = (linha: number, etapa: string | null) => ({
    linha,
    title: `L${linha}`,
    description: null,
    value_cents: null,
    telefone: null,
    nome_do_contato: null,
    email: null,
    tags: [],
    source: "importacao_planilha",
    etapa,
  });

  it("vazia → etapa padrão; nome → id, sem acento nem caixa", () => {
    const r = resolverEtapas([lead(2, null), lead(3, "EM NEGOCIACAO")], etapas, "e1");
    expect(r.leads.map((l) => l.stage_id)).toEqual(["e1", "e2"]);
    expect(r.ignoradas).toEqual([]);
  });

  it("etapa desconhecida ou de ganho/perda ignora a linha e diz o motivo", () => {
    const r = resolverEtapas(
      [lead(2, "Inventada"), lead(3, "Ganho"), lead(4, "Perdido"), lead(5, "Novo")],
      etapas,
      "e1",
    );
    expect(r.leads.map((l) => l.linha)).toEqual([5]);
    expect(r.ignoradas.map((e) => e.linha)).toEqual([2, 3, 4]);
    expect(r.ignoradas[0]!.motivo).toContain("Inventada");
  });
});
