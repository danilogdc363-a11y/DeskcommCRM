import { describe, expect, it } from "vitest";

import {
  compararComMeta,
  diaNoFuso,
  janelaDoPreset,
  janelaLivre,
  lerStatsDoMeta,
  montarFunil,
  resumirCliques,
  situacaoDe,
  type Etapa,
  type EnvioAoMeta,
} from "./funil-meta";

const ETAPAS: Etapa[] = [
  { id: "s1", nome: "Pedido novo", posicao: 0, ganha: false, eventoMeta: "Contact" },
  { id: "s2", nome: "Reunião marcada", posicao: 2, ganha: false, eventoMeta: "Schedule" },
  { id: "s3", nome: "Fechou", posicao: 5, ganha: true, eventoMeta: "Purchase" },
];

const envio = (
  eventName: string,
  criadoEm: string,
  status = "sent",
  metaEventName: string | null = null,
): EnvioAoMeta => ({ eventName, criadoEm, status, metaEventName });

describe("situacaoDe", () => {
  it("classifica bate, diferença, não chegou e só no Meta", () => {
    expect(situacaoDe(2, 2)).toBe("bate");
    expect(situacaoDe(3, 2)).toBe("diferenca");
    expect(situacaoDe(2, 0)).toBe("nao_chegou");
    expect(situacaoDe(0, 1)).toBe("so_no_meta");
  });
});

describe("compararComMeta", () => {
  it("2 vendas enviadas → 2 Purchase no Meta = bate", () => {
    const linhas = compararComMeta({
      etapas: ETAPAS,
      envios: [envio("Purchase", "2026-11-10T15:00:00Z"), envio("Purchase", "2026-11-10T18:00:00Z")],
      meta: [{ dia: "2026-11-10", evento: "Purchase", quantidade: 2 }],
      dias: ["2026-11-10"],
    });
    expect(linhas).toEqual([
      { dia: "2026-11-10", evento: "Purchase", etapa: "Fechou", crmEnviou: 2, metaRecebeu: 2, situacao: "bate" },
    ]);
  });

  it("agrupa o envio pelo dia de Los Angeles, não de Brasília nem UTC", () => {
    // 02:00 UTC de 11/11 = 23:00 de 10/11 em Brasília = 18:00 de 10/11 em LA.
    const linhas = compararComMeta({
      etapas: ETAPAS,
      envios: [envio("MetaEtapa:s2", "2026-11-11T02:00:00Z")],
      meta: [{ dia: "2026-11-10", evento: "Schedule", quantidade: 1 }],
      dias: ["2026-11-10", "2026-11-11"],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ dia: "2026-11-10", situacao: "bate" });
  });

  it("não conta envio que falhou e aponta o que não chegou", () => {
    const linhas = compararComMeta({
      etapas: ETAPAS,
      envios: [envio("MetaEtapa:s1", "2026-11-10T15:00:00Z"), envio("MetaEtapa:s1", "2026-11-10T16:00:00Z", "failed")],
      meta: [],
      dias: ["2026-11-10"],
    });
    expect(linhas).toEqual([
      expect.objectContaining({ evento: "Contact", crmEnviou: 1, metaRecebeu: 0, situacao: "nao_chegou" }),
    ]);
  });

  it("prefere meta_event_name gravado no envio e ignora eventos alheios do conjunto", () => {
    const linhas = compararComMeta({
      etapas: ETAPAS,
      envios: [envio("MetaEtapa:s1", "2026-11-10T15:00:00Z", "sent", "Lead")],
      meta: [
        { dia: "2026-11-10", evento: "Lead", quantidade: 3 },
        { dia: "2026-11-10", evento: "PageView", quantidade: 50 },
      ],
      dias: ["2026-11-10"],
    });
    expect(linhas).toEqual([
      expect.objectContaining({ evento: "Lead", etapa: null, crmEnviou: 1, metaRecebeu: 3, situacao: "diferenca" }),
    ]);
  });

  it("mostra evento das etapas que só o Meta registrou", () => {
    const linhas = compararComMeta({
      etapas: ETAPAS,
      envios: [],
      meta: [{ dia: "2026-11-09", evento: "Contact", quantidade: 1 }],
      dias: ["2026-11-09"],
    });
    expect(linhas[0]).toMatchObject({ situacao: "so_no_meta", etapa: "Pedido novo" });
  });
});

describe("lerStatsDoMeta", () => {
  it("soma baldes por dia no fuso da conta", () => {
    const r = lerStatsDoMeta({
      data: [
        { start_time: "2026-11-10T08:00:00+0000", data: [{ value: "Purchase", count: 1 }] },
        { start_time: "2026-11-11T07:00:00+0000", data: [{ value: "Purchase", count: 1 }] },
        { start_time: "2026-11-11T09:00:00+0000", data: [{ value: "Purchase", count: 2 }] },
      ],
    });
    // 07:00 UTC de 11/11 ainda é 10/11 em LA (UTC-8 em novembro).
    expect(r).toEqual([
      { dia: "2026-11-10", evento: "Purchase", quantidade: 2 },
      { dia: "2026-11-11", evento: "Purchase", quantidade: 2 },
    ]);
  });
});

describe("montarFunil", () => {
  it("conta entradas reais, lead_created na primeira etapa e envios por etapa", () => {
    const linhas = montarFunil({
      etapas: ETAPAS,
      abertosPorEtapa: { s1: 4 },
      atividades: [
        { tipo: "lead_created", performedAt: "2026-11-10T12:00:00Z" },
        { tipo: "stage_changed", performedAt: "2026-11-10T12:00:00Z", fromStageId: "s1", toStageId: "s2" },
        { tipo: "stage_changed", performedAt: "2026-11-10T12:00:00Z", fromStageId: "s2", toStageId: "s2" },
      ],
      envios: [envio("MetaEtapa:s2", "2026-11-10T12:00:00Z"), envio("Purchase", "2026-11-10T12:00:00Z", "failed")],
    });
    expect(linhas.map((l) => [l.etapaId, l.abertosAgora, l.entradas, l.enviadosAoMeta, l.naoEnviados])).toEqual([
      ["s1", 4, 1, 0, 0],
      ["s2", 0, 1, 1, 0],
      ["s3", 0, 0, 0, 1],
    ]);
  });
});

describe("janelas", () => {
  // Quinta, 12/11/2026, 10:00 em Brasília.
  const agora = new Date("2026-11-12T13:00:00Z");

  it("últimos 7 dias incluem hoje e começam à meia-noite de Brasília", () => {
    const j = janelaDoPreset("7d", agora);
    expect([j.primeiroDia, j.ultimoDia]).toEqual(["2026-11-06", "2026-11-12"]);
    expect(j.de.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-11-13T03:00:00.000Z");
  });

  it("esta semana começa na segunda; semana passada é segunda a domingo", () => {
    expect(janelaDoPreset("semana", agora).primeiroDia).toBe("2026-11-09");
    const p = janelaDoPreset("semana_passada", agora);
    expect([p.primeiroDia, p.ultimoDia]).toEqual(["2026-11-02", "2026-11-08"]);
  });

  it("intervalo livre recusa invertido e acima do teto", () => {
    expect(janelaLivre("2026-11-10", "2026-11-01")).toBeNull();
    expect(janelaLivre("2026-01-01", "2026-11-01")).toBeNull();
    expect(janelaLivre("2026-11-01", "2026-11-03")?.ultimoDia).toBe("2026-11-03");
  });

  it("diaNoFuso respeita o fuso", () => {
    expect(diaNoFuso("2026-11-11T02:00:00Z", "America/Sao_Paulo")).toBe("2026-11-10");
  });
});

describe("resumirCliques", () => {
  it("conta cliques e os que viraram LeadSubmitted por dia de Brasília", () => {
    const r = resumirCliques(
      [
        { capturadoEm: "2026-11-10T12:00:00Z", status: "sent" },
        { capturadoEm: "2026-11-10T13:00:00Z", status: "skipped" },
      ],
      ["2026-11-10"],
    );
    expect(r).toMatchObject({ total: 2, leadSubmitted: 1 });
  });
});
