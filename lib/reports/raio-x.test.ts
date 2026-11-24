import { describe, expect, it } from "vitest";

import type { LinhaDaCoorte } from "./funil-meta";
import { gastoEmCentavos, montarRaioX, semanasDoPeriodo } from "./raio-x";

const etapa = (
  etapaId: string,
  leads: number,
  eventoMeta: string | null,
  ganha = false,
): LinhaDaCoorte => ({
  etapaId,
  nome: etapaId,
  eventoMeta,
  ganha,
  leads,
  taxa: 0,
});

// Os números do Raio-X de julho feito à mão.
const COORTE = [
  etapa("novo", 173, "Contact"),
  etapa("atend", 120, "Respondidos"),
  etapa("marc", 30, "Schedule"),
  etapa("feita", 23, "QualifiedLead"),
  etapa("neg", 10, "InitiateCheckout"),
  etapa("fechou", 6, "Purchase", true),
];
const FECHADOS = [400000, 350000, 300000, 250000, 125000, 62500].map((v, i) => ({
  id: String(i),
  titulo: `Cliente ${i}`,
  valorCents: v,
}));

describe("montarRaioX", () => {
  it("reproduz o Raio-X de julho", () => {
    const r = montarRaioX({
      coorte: COORTE,
      fechados: FECHADOS,
      investidoCents: 877800,
      semanas: [],
    });
    expect(r.receitaCents).toBe(1487500);
    expect(r.clientes).toBe(6);
    expect(Math.round(r.ticketMedioCents!)).toBe(247917);
    expect(r.retorno!.toFixed(2)).toBe("1.69");
    expect(Math.round(r.custoPorLeadCents!)).toBe(5074);
    expect(Math.round(r.cacCents!)).toBe(146300);
    expect(r.paybackDias).toBe(18);
    expect(r.funil.map((e) => [e.rotulo, e.quantidade])).toEqual([
      ["Leads", 173],
      ["Reuniões marcadas", 30],
      ["Reuniões feitas", 23],
      ["Vendas", 6],
    ]);
    expect(r.funil[1]!.conversaoDaAnterior!.toFixed(3)).toBe("0.173");
    expect(Math.round(r.funil[1]!.custoCents!)).toBe(29260);
    expect(r.fechados[0]!.valorCents).toBe(400000);
  });

  it("sem conta de anúncios: nada que depende do investido vira zero", () => {
    const r = montarRaioX({
      coorte: COORTE,
      fechados: FECHADOS,
      investidoCents: null,
      semanas: [],
    });
    expect([
      r.retorno,
      r.custoPorLeadCents,
      r.cacCents,
      r.paybackDias,
      r.funil[0]!.custoCents,
    ]).toEqual([null, null, null, null, null]);
    expect(r.receitaCents).toBe(1487500);
  });

  it("sem venda: ticket, CAC e payback ficam vazios, sem dividir por zero", () => {
    const r = montarRaioX({ coorte: COORTE, fechados: [], investidoCents: 100000, semanas: [] });
    expect([r.ticketMedioCents, r.cacCents, r.paybackDias]).toEqual([null, null, null]);
  });

  it("funil sem etapa de reunião omite a etapa em vez de inventar zero", () => {
    const r = montarRaioX({
      coorte: [etapa("novo", 10, "Contact"), etapa("fechou", 2, null, true)],
      fechados: [],
      investidoCents: null,
      semanas: [],
    });
    expect(r.funil.map((e) => e.rotulo)).toEqual(["Leads", "Vendas"]);
  });

  it("custo por lead por semana", () => {
    const r = montarRaioX({
      coorte: COORTE,
      fechados: [],
      investidoCents: 1,
      semanas: [
        { de: "2026-07-01", ate: "2026-07-05", investidoCents: 39000, leads: 10 },
        { de: "2026-07-06", ate: "2026-07-12", investidoCents: 1000, leads: 0 },
        { de: "2026-07-13", ate: "2026-07-19", investidoCents: null, leads: 5 },
      ],
    });
    expect(r.semanas.map((s) => s.custoPorLeadCents)).toEqual([3900, null, null]);
  });
});

describe("semanasDoPeriodo", () => {
  it("segunda a domingo, cortado nas bordas", () => {
    expect(semanasDoPeriodo("2026-11-05", "2026-11-18")).toEqual([
      { de: "2026-11-05", ate: "2026-11-08" },
      { de: "2026-11-09", ate: "2026-11-15" },
      { de: "2026-11-16", ate: "2026-11-18" },
    ]);
  });
});

describe("gastoEmCentavos", () => {
  it("soma o spend das campanhas em reais", () => {
    expect(gastoEmCentavos([{ spend: "12.34" }, { spend: "0.66" }, {}])).toBe(1300);
  });
});
