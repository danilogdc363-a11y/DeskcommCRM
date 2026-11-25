import { describe, expect, it } from "vitest";

import { applyFilters, filtersFromParams, filtersToParams } from "./filters";
import { filtrosForaDaLista } from "./filtros-da-lista";
import { ehTemperatura, temperaturaEfetiva } from "./temperatura";
import { updateLeadSchema } from "@/lib/schemas/leads";
import type { Lead } from "@/lib/types/leads";

const ia = (band: "frio" | "morno" | "quente") => ({
  probability: 50,
  reason: "",
  band,
  factors: [],
  at: null,
});

const lead = (id: string, resto: Partial<Lead> = {}): Lead =>
  ({ id, title: id, status: "open", created_at: "2026-11-10T12:00:00", ...resto }) as Lead;

describe("temperaturaEfetiva", () => {
  it("a marcada à mão VENCE a da IA", () => {
    expect(temperaturaEfetiva({ temperatura_manual: "frio", score: ia("quente") })).toEqual({
      band: "frio",
      origem: "manual",
    });
  });
  it("sem marcação, vale a da IA", () => {
    expect(temperaturaEfetiva({ temperatura_manual: null, score: ia("morno") })).toEqual({
      band: "morno",
      origem: "ia",
    });
  });
  it("sem nada, não há temperatura", () => {
    expect(temperaturaEfetiva({})).toBeNull();
    expect(temperaturaEfetiva({ temperatura_manual: null, score: null })).toBeNull();
  });
  it("valor fora do vocabulário é ignorado (cai na IA)", () => {
    expect(temperaturaEfetiva({ temperatura_manual: "fervendo", score: ia("frio") })?.origem).toBe("ia");
    expect(ehTemperatura("quente")).toBe(true);
    expect(ehTemperatura("fervendo")).toBe(false);
  });
});

describe("filtro por temperatura", () => {
  const quenteManual = lead("a", { temperatura_manual: "quente" });
  const frioManualQuenteIa = lead("b", { temperatura_manual: "frio", score: ia("quente") });
  const quenteIa = lead("c", { score: ia("quente") });
  const semNada = lead("d");

  it("casa pela temperatura EFETIVA (manual vence a IA) e tira quem não tem", () => {
    const r = applyFilters([quenteManual, frioManualQuenteIa, quenteIa, semNada], { temperatura: "quente" });
    expect(r.map((l) => l.id)).toEqual(["a", "c"]);
  });
  it("sem o filtro, ninguém some", () => {
    expect(applyFilters([quenteManual, semNada], {})).toHaveLength(2);
  });
  it("vai e volta pela URL; valor inválido some", () => {
    expect(filtersFromParams(new URLSearchParams(filtersToParams({ temperatura: "morno" }))).temperatura).toBe("morno");
    expect(filtersFromParams(new URLSearchParams("temperatura=xx")).temperatura).toBeUndefined();
  });
  it("a aba Lista avisa que o filtro só vale no quadro", () => {
    expect(filtrosForaDaLista({ temperatura: "frio" })).toEqual(["temperatura"]);
  });
});

describe("PATCH do lead: temperatura_manual", () => {
  it("aceita as três e o null (volta ao automático)", () => {
    for (const v of ["frio", "morno", "quente", null]) {
      expect(updateLeadSchema.safeParse({ temperatura_manual: v }).success).toBe(true);
    }
  });
  it("recusa valor fora do vocabulário (o CHECK do banco diria o mesmo)", () => {
    expect(updateLeadSchema.safeParse({ temperatura_manual: "fervendo" }).success).toBe(false);
  });
  it("ausente não toca o campo", () => {
    expect(updateLeadSchema.parse({ title: "ok" })).not.toHaveProperty("temperatura_manual");
  });
});
