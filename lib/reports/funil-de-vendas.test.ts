import { describe, expect, it } from "vitest";

import {
  IDEAL,
  acharEtapasChave,
  contarEventosDoMeta,
  contarFunil,
  contarSemEnvio,
  etapasDosEventos,
  custoPor,
  destinoDaMudanca,
  ehDoMeta,
  janelaAnterior,
  janelaDoPreset,
  janelaLivre,
  somarGasto,
  somarLeadsDoMeta,
  taxa,
  variacao,
  type EntradaEmEtapa,
  type LeadDoFunil,
} from "./funil-de-vendas";

const nov = janelaLivre("2026-11-01", "2026-11-23")!;
// "Chegou até": reunião agendada inclui as etapas depois dela; realizada também.
const etapas = {
  reuniao: new Set(["reu", "feita", "won"]),
  compareceu: new Set(["feita", "won"]),
  ganha: new Set(["won"]),
};

function lead(id: string, criadoEm: string, etapaId: string, extra: Partial<LeadDoFunil> = {}): LeadDoFunil {
  return { id, contatoId: `c-${id}`, criadoEm, etapaId, doMeta: false, ...extra };
}

describe("janelas", () => {
  it("intervalo livre corta em Brasília", () => {
    expect(nov.de.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(nov.ate.toISOString()).toBe("2026-11-24T03:00:00.000Z");
  });

  it("recusa intervalo invertido, mal formado ou longo demais", () => {
    expect(janelaLivre("2026-11-10", "2026-11-01")).toBeNull();
    expect(janelaLivre("10/11/2026", "2026-11-12")).toBeNull();
    expect(janelaLivre("2026-01-01", "2026-12-31")).toBeNull();
  });

  it("este mês vai do dia 1 até hoje; mês passado é o mês inteiro", () => {
    const agora = new Date("2026-11-23T15:00:00Z");
    const este = janelaDoPreset("este_mes", agora);
    expect([este.primeiroDia, este.ultimoDia]).toEqual(["2026-11-01", "2026-11-23"]);
    const passado = janelaDoPreset("mes_passado", agora);
    expect([passado.primeiroDia, passado.ultimoDia]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("mês passado em janeiro volta para dezembro do ano anterior", () => {
    const j = janelaDoPreset("mes_passado", new Date("2027-01-10T15:00:00Z"));
    expect([j.primeiroDia, j.ultimoDia]).toEqual(["2026-12-01", "2026-12-31"]);
  });

  it("últimos 7 dias incluem hoje", () => {
    const j = janelaDoPreset("7d", new Date("2026-11-23T15:00:00Z"));
    expect([j.primeiroDia, j.ultimoDia]).toEqual(["2026-11-17", "2026-11-23"]);
  });

  it("período anterior tem o mesmo tamanho e encosta no atual", () => {
    const a = janelaAnterior(nov);
    expect([a.primeiroDia, a.ultimoDia]).toEqual(["2026-10-09", "2026-10-31"]);
    expect(a.ate.getTime()).toBe(nov.de.getTime());
  });
});

describe("ehDoMeta", () => {
  it("clique para WhatsApp e formulário com utm do Instagram/Facebook", () => {
    expect(ehDoMeta("meta_ads", null)).toBe(true);
    expect(ehDoMeta("webhook", { utm_source: "ig" })).toBe(true);
    expect(ehDoMeta("webhook", { source_name: "Facebook" })).toBe(true);
    expect(ehDoMeta("webhook", { utm_source: "teste" })).toBe(false);
    expect(ehDoMeta("whatsapp", null)).toBe(false);
  });
});

describe("contarFunil — coorte", () => {
  const leads = [
    lead("a", "2026-11-02T12:00:00Z", "reu"),
    lead("b", "2026-11-05T12:00:00Z", "won"),
    lead("c", "2026-11-06T12:00:00Z", "novo"),
    lead("d", "2026-11-07T12:00:00Z", "perdido"),
    lead("velho", "2026-10-02T12:00:00Z", "won"),
  ];
  const entradas: EntradaEmEtapa[] = [
    { leadId: "d", paraEtapaId: "reu", em: "2026-11-08T12:00:00Z" },
    { leadId: "velho", paraEtapaId: "won", em: "2026-11-10T12:00:00Z" },
  ];
  const primeiraResposta = new Map([
    ["c-a", "2026-11-02T13:00:00Z"],
    ["c-b", "2026-11-05T13:00:00Z"],
    ["c-velho", "2026-10-02T13:00:00Z"],
  ]);

  it("conta só os criados no período, onde estão hoje", () => {
    expect(
      contarFunil({ modo: "coorte", janela: nov, etapas, leads, entradas, primeiraResposta }),
    ).toEqual({ novos: 4, responderam: 2, reuniao: 3, compareceram: 1, fecharam: 1 });
  });

  it("aplica o filtro de origem", () => {
    const comMeta = leads.map((l) => ({ ...l, doMeta: l.id === "b" }));
    expect(
      contarFunil({
        modo: "coorte",
        janela: nov,
        etapas,
        leads: comMeta,
        entradas,
        primeiraResposta,
        filtro: (l) => l.doMeta,
      }),
    ).toEqual({ novos: 1, responderam: 1, reuniao: 1, compareceram: 1, fecharam: 1 });
  });

  it("lead sem contato não conta como respondeu", () => {
    const r = contarFunil({
      modo: "coorte",
      janela: nov,
      etapas,
      leads: [lead("x", "2026-11-02T12:00:00Z", "novo", { contatoId: null })],
      entradas: [],
      primeiraResposta,
    });
    expect(r.responderam).toBe(0);
  });
});

describe("contarFunil — movimento", () => {
  it("conta quem entrou em cada degrau no período, mesmo criado antes", () => {
    const leads = [
      lead("velho", "2026-10-02T12:00:00Z", "won"),
      lead("novo", "2026-11-03T12:00:00Z", "reu"),
      lead("mexeu-fora", "2026-10-01T12:00:00Z", "reu"),
    ];
    const entradas: EntradaEmEtapa[] = [
      { leadId: "velho", paraEtapaId: "reu", em: "2026-11-04T12:00:00Z" },
      { leadId: "velho", paraEtapaId: "won", em: "2026-11-10T12:00:00Z" },
      { leadId: "novo", paraEtapaId: "reu", em: "2026-11-03T13:00:00Z" },
      { leadId: "novo", paraEtapaId: "reu", em: "2026-11-05T13:00:00Z" },
      { leadId: "mexeu-fora", paraEtapaId: "reu", em: "2026-10-05T12:00:00Z" },
    ];
    const primeiraResposta = new Map([
      ["c-velho", "2026-10-02T13:00:00Z"],
      ["c-novo", "2026-11-03T12:30:00Z"],
    ]);
    expect(
      contarFunil({ modo: "movimento", janela: nov, etapas, leads, entradas, primeiraResposta }),
    ).toEqual({ novos: 1, responderam: 1, reuniao: 2, compareceram: 1, fecharam: 1 });
  });
});

describe("números do painel", () => {
  it("variação e taxa sem base viram null", () => {
    expect(variacao(400, 472.8)).toBeCloseTo(-15.4, 1);
    expect(variacao(5, 0)).toBeNull();
    expect(taxa(146, 236)).toBeCloseTo(61.9, 1);
    expect(taxa(1, 0)).toBeNull();
  });

  it("soma o gasto e divide pelo número da etapa", () => {
    const gasto = somarGasto([{ spend: "6232.85" }, { spend: "1148.63" }, { spend: "677.92" }, {}]);
    expect(gasto).toBeCloseTo(8059.4, 2);
    expect(custoPor(gasto, 52)).toBeCloseTo(154.99, 2);
    expect(custoPor(gasto, 0)).toBeNull();
    expect(custoPor(null, 10)).toBeNull();
  });

  it("cada reunião conta a etapa e as que vêm depois, fora a perdida", () => {
    const k = acharEtapasChave([
      { id: "0", name: "Em atendimento", is_won: false, position: 2000 },
      { id: "1", name: "Reunião marcada", is_won: false, position: 3000 },
      { id: "2", name: "REUNIAO FEITA", is_won: false, position: 4000 },
      { id: "4", name: "Negociação", is_won: false, position: 5000 },
      { id: "3", name: "Fechou", is_won: true, position: 6000 },
      { id: "5", name: "Não fechou", is_won: false, is_lost: true, position: 7000 },
    ]);
    expect([...k.reuniao].sort()).toEqual(["1", "2", "3", "4"]);
    expect([...k.compareceu].sort()).toEqual(["2", "3", "4"]);
    expect([...k.ganha]).toEqual(["3"]);
  });

  it("sem a etapa pelo nome, o degrau fica vazio", () => {
    const k = acharEtapasChave([{ id: "3", name: "Fechou", is_won: true, position: 6000 }]);
    expect(k.reuniao.size).toBe(0);
    expect(k.compareceu.size).toBe(0);
  });

  it("referências do comercial", () => {
    expect(IDEAL).toEqual({ agendamento: 20, comparecimento: 75, venda: 30 });
  });

  it("lê o destino nas duas grafias do payload", () => {
    expect(destinoDaMudanca({ to_stage_id: "x" })).toBe("x");
    expect(destinoDaMudanca({ para: "y" })).toBe("y");
    expect(destinoDaMudanca(null)).toBeNull();
  });
});

describe("somarLeadsDoMeta", () => {
  it("usa um tipo por campanha, sem somar duas vezes", () => {
    expect(
      somarLeadsDoMeta([
        { actions: [{ action_type: "lead", value: "100" }, { action_type: "onsite_conversion.lead_grouped", value: "100" }] },
        { actions: [{ action_type: "onsite_conversion.lead_grouped", value: "28" }] },
        { actions: [{ action_type: "link_click", value: "9" }] },
        {},
      ]),
    ).toBe(128);
  });
});

describe("eventos que o Meta recebeu", () => {
  const etapasDoFunil = [
    { id: "novo", name: "Pedido novo", is_won: false, position: 1000 },
    { id: "debug", name: "lead meta (debug)", is_won: false, position: 1500 },
    { id: "atend", name: "Em atendimento", is_won: false, position: 2000 },
    { id: "reu", name: "Reunião marcada", is_won: false, position: 3000 },
    { id: "feita", name: "Reunião feita", is_won: false, position: 4000 },
    { id: "won", name: "Fechou", is_won: true, position: 6000 },
    { id: "lost", name: "Não fechou", is_won: false, is_lost: true, position: 7000 },
  ];
  const porDegrau = etapasDosEventos(etapasDoFunil);
  const env = (leadId: string, eventName: string, status: string, em = "2026-11-10T12:00:00Z") => ({
    leadId,
    eventName,
    status,
    em,
  });

  it("liga cada degrau à etapa que dispara o evento", () => {
    expect([...porDegrau.novos]).toEqual(["novo"]);
    expect([...porDegrau.responderam]).toEqual(["atend"]);
    expect([...porDegrau.reuniao]).toEqual(["reu"]);
    expect([...porDegrau.compareceram]).toEqual(["feita"]);
    expect([...porDegrau.fecharam]).toEqual(["won"]);
  });

  it("conta leads aceitos e falhos, sem repetir, e só dentro do período", () => {
    const r = contarEventosDoMeta({
      etapasPorDegrau: porDegrau,
      janela: nov,
      envios: [
        env("a", "MetaEtapa:reu", "sent"),
        env("a", "MetaEtapa:reu", "sent"),
        env("b", "MetaEtapa:reu", "failed"),
        env("c", "MetaEtapa:reu", "failed"),
        env("c", "MetaEtapa:reu", "sent"),
        env("d", "MetaEtapa:reu", "sent", "2026-10-20T12:00:00Z"),
        env("e", "Purchase", "sent"),
        env("f", "Purchase", "skipped"),
        env("g", "MetaEtapa:outra", "sent"),
      ],
    });
    expect(r.reuniao).toEqual({ recebidos: 2, falharam: 1, pulados: 0 });
    expect(r.fecharam).toEqual({ recebidos: 1, falharam: 0, pulados: 1 });
    expect(r.novos).toEqual({ recebidos: 0, falharam: 0, pulados: 0 });
  });

  it("aponta quem entrou na etapa e ficou sem evento", () => {
    const r = contarSemEnvio({
      etapasPorDegrau: porDegrau,
      janela: nov,
      entradas: [
        { leadId: "a", paraEtapaId: "reu", em: "2026-11-05T12:00:00Z" },
        { leadId: "b", paraEtapaId: "reu", em: "2026-11-06T12:00:00Z" },
        { leadId: "c", paraEtapaId: "reu", em: "2026-10-06T12:00:00Z" },
        { leadId: "w", paraEtapaId: "won", em: "2026-11-07T12:00:00Z" },
      ],
      envios: [env("a", "MetaEtapa:reu", "sent"), env("w", "Purchase", "skipped")],
    });
    expect(r.reuniao).toBe(1);
    expect(r.fecharam).toBe(0);
    expect(r.novos).toBeUndefined();
  });
});
