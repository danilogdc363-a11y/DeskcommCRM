import { describe, expect, it } from "vitest";

import { csvDeLeads, origemDoLead } from "./exportar-leads";

describe("exportar leads", () => {
  it("lê a origem do contato e cai no lead", () => {
    expect(
      origemDoLead({ ad_platform: "meta_ads", utm_campaign: "Camp A" }, { utm_ad: "Ad 1" }),
    ).toEqual({
      plataforma: "meta_ads",
      campanha: "Camp A",
      conjunto: null,
      anuncio: "Ad 1",
      origem: null,
    });
  });

  it("escreve valor em reais, telefone e protege fórmula no nome", () => {
    const csv = csvDeLeads([
      {
        id: "l1",
        criadoEm: "2026-11-01T10:00:00Z",
        titulo: "=1+1",
        nomeDoContato: "Davy",
        telefone: "5524993092992",
        etapa: "Novo",
        situacao: "open",
        valorCentavos: 100,
        moeda: "BRL",
        plataforma: "meta_ads",
        campanha: null,
        conjunto: null,
        anuncio: null,
        origem: null,
      },
    ]);
    expect(csv).toContain("'=1+1,Davy,5524993092992,Novo,open,1.00,BRL,meta_ads");
  });
});
