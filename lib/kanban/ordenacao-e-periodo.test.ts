import { describe, expect, it } from "vitest";

import { applyFilters, filtersFromParams, filtersToParams } from "./filters";
import { filtrosForaDaLista } from "./filtros-da-lista";
import { comparadorDaOrdem, ehOrdemDoQuadro } from "./ordenacao";
import {
  ATALHOS_DE_PERIODO,
  atalhoAtivoDoPeriodo,
  diaLocalDe,
  ehDiaValido,
  ehModoDoPeriodo,
  negocioNoPeriodo,
  periodoDoAtalho,
  ultimosDias,
} from "./periodo";
import type { Lead } from "@/lib/types/leads";

const lead = (id: string, resto: Partial<Lead> = {}): Lead =>
  ({
    id,
    title: id,
    position_in_stage: 1,
    created_at: "2026-11-10T12:00:00",
    updated_at: "2026-11-10T12:00:00",
    stage_changed_at: null,
    status: "open",
    ...resto,
  }) as Lead;

const ids = (ls: Lead[]) => ls.map((l) => l.id);
const ordenar = (ordem: Parameters<typeof comparadorDaOrdem>[0], ls: Lead[]) =>
  [...ls].sort(comparadorDaOrdem(ordem) ?? (() => 0));

describe("comparadorDaOrdem", () => {
  const a = lead("a", { created_at: "2026-11-01T12:00:00", updated_at: "2026-11-20T12:00:00" });
  const b = lead("b", { created_at: "2026-11-05T12:00:00", updated_at: "2026-11-10T12:00:00" });
  const c = lead("c", { created_at: "2026-11-03T12:00:00", updated_at: "2026-11-15T12:00:00" });

  it("sem ordem não faz nada (a ordem do quadro manda)", () => {
    expect(comparadorDaOrdem(undefined)).toBeNull();
  });
  it("criação nos dois sentidos", () => {
    expect(ids(ordenar("criacao_novos", [a, b, c]))).toEqual(["b", "c", "a"]);
    expect(ids(ordenar("criacao_antigos", [a, b, c]))).toEqual(["a", "c", "b"]);
  });
  it("última edição: mais recente primeiro", () => {
    expect(ids(ordenar("edicao", [a, b, c]))).toEqual(["a", "c", "b"]);
  });
  it("último contato: quem nunca falou vai SEMPRE para o fim, nos dois sentidos", () => {
    const x = lead("x", { conversa: { id: "1", preview: null, last_message_at: "2026-11-20T12:00:00", unread: 0 } });
    const y = lead("y", { conversa: { id: "2", preview: null, last_message_at: "2026-11-10T12:00:00", unread: 0 } });
    const sem = lead("sem", { conversa: null });
    expect(ids(ordenar("contato_recentes", [sem, y, x]))).toEqual(["x", "y", "sem"]);
    expect(ids(ordenar("contato_antigos", [sem, x, y]))).toEqual(["y", "x", "sem"]);
  });
  it("nome A–Z ignora maiúscula e acento, e Z–A inverte", () => {
    const ls = [lead("b", { title: "bruno" }), lead("a", { title: "Álvaro" }), lead("c", { title: "Carla" })];
    expect(ids(ordenar("nome_az", ls))).toEqual(["a", "b", "c"]);
    expect(ids(ordenar("nome_za", ls))).toEqual(["c", "b", "a"]);
  });
  it("empate cai na posição do quadro, e depois no id (nunca troca de lugar sozinho)", () => {
    const m = lead("m", { title: "Igual", position_in_stage: 2 });
    const n = lead("n", { title: "Igual", position_in_stage: 1 });
    expect(ids(ordenar("nome_az", [m, n]))).toEqual(["n", "m"]);
  });
  it("valida valor vindo da URL", () => {
    expect(ehOrdemDoQuadro("edicao")).toBe(true);
    expect(ehOrdemDoQuadro("qualquer")).toBe(false);
  });
});

describe("negocioNoPeriodo", () => {
  const criadoEm = (d: string) => ({ created_at: `${d}T12:00:00`, stage_changed_at: null });

  it("sem período, todos passam", () => {
    expect(negocioNoPeriodo(criadoEm("2020-01-01"), undefined, undefined)).toBe(true);
  });
  it("pega o criado no período (extremos inclusivos)", () => {
    expect(negocioNoPeriodo(criadoEm("2026-11-20"), "2026-11-20", "2026-11-24")).toBe(true);
    expect(negocioNoPeriodo(criadoEm("2026-11-24"), "2026-11-20", "2026-11-24")).toBe(true);
    expect(negocioNoPeriodo(criadoEm("2026-11-19"), "2026-11-20", "2026-11-24")).toBe(false);
  });
  it("pega o que foi MOVIDO no período mesmo tendo sido criado antes", () => {
    const velho = { created_at: "2026-09-01T12:00:00", stage_changed_at: "2026-11-22T12:00:00" };
    expect(negocioNoPeriodo(velho, "2026-11-20", "2026-11-24")).toBe(true);
  });
  it("extremo aberto: só 'de' e só 'até'", () => {
    expect(negocioNoPeriodo(criadoEm("2026-11-25"), "2026-11-20", undefined)).toBe(true);
    expect(negocioNoPeriodo(criadoEm("2026-11-25"), undefined, "2026-11-24")).toBe(false);
  });
  it("sem nenhuma data o negócio fica de fora do recorte", () => {
    expect(negocioNoPeriodo({ created_at: "", stage_changed_at: null }, "2026-11-20", undefined)).toBe(false);
  });
  it("dia é o do relógio local, e só dia real é aceito", () => {
    expect(diaLocalDe("2026-11-24T12:00:00")).toBe("2026-11-24");
    expect(ehDiaValido("2026-02-30")).toBe(false);
    expect(ehDiaValido("2026-11-24")).toBe(true);
    expect(ehDiaValido("24/11/2026")).toBe(false);
  });
});

describe("filtros: URL e aplicação", () => {
  it("ordem e período vão e voltam pela URL", () => {
    const qs = filtersToParams({ ordem: "edicao", de: "2026-11-01", ate: "2026-11-24" });
    const volta = filtersFromParams(new URLSearchParams(qs));
    expect(volta).toMatchObject({ ordem: "edicao", de: "2026-11-01", ate: "2026-11-24" });
  });
  it("valores inválidos na URL somem em vez de quebrar a tela", () => {
    const volta = filtersFromParams(new URLSearchParams("ordem=xx&de=ontem&ate=2026-13-45"));
    expect(volta.ordem).toBeUndefined();
    expect(volta.de).toBeUndefined();
    expect(volta.ate).toBeUndefined();
  });
  it("applyFilters aplica o período", () => {
    const dentro = lead("dentro", { created_at: "2026-11-22T12:00:00" });
    const fora = lead("fora", { created_at: "2026-10-01T12:00:00" });
    expect(ids(applyFilters([dentro, fora], { de: "2026-11-20", ate: "2026-11-24" }))).toEqual(["dentro"]);
  });
  it("ordem sozinha NÃO esconde card nenhum", () => {
    const ls = [lead("a"), lead("b")];
    expect(applyFilters(ls, { ordem: "nome_az" })).toHaveLength(2);
  });
  it("a aba Lista avisa que período e ordem só valem no quadro", () => {
    expect(filtrosForaDaLista({ de: "2026-11-01", ordem: "edicao" })).toEqual(["periodo", "ordem"]);
  });
});

describe("ultimosDias", () => {
  const HOJE = new Date(2026, 10, 25, 15, 30); // 25/11/2026, 15h30 locais
  it("7 dias = hoje e os 6 anteriores (7 dias do calendário)", () => {
    expect(ultimosDias(7, HOJE)).toEqual({ de: "2026-11-19", ate: "2026-11-25" });
  });
  it("30 dias atravessa o mês", () => {
    expect(ultimosDias(30, HOJE)).toEqual({ de: "2026-10-27", ate: "2026-11-25" });
  });
  it("atravessa o ano e o fevereiro bissexto", () => {
    expect(ultimosDias(7, new Date(2027, 0, 3))).toEqual({ de: "2026-12-28", ate: "2027-01-03" });
    expect(ultimosDias(3, new Date(2028, 2, 1))).toEqual({ de: "2028-02-28", ate: "2028-03-01" });
  });
  it("número inválido vira 1 dia (só hoje)", () => {
    expect(ultimosDias(0, HOJE)).toEqual({ de: "2026-11-25", ate: "2026-11-25" });
  });
  it("o resultado é sempre um dia válido para o filtro", () => {
    const r = ultimosDias(30, HOJE);
    expect(ehDiaValido(r.de) && ehDiaValido(r.ate)).toBe(true);
  });
});

describe("modo do período: criados × criados ou movidos", () => {
  const movido = { created_at: "2026-09-01T12:00:00", stage_changed_at: "2026-11-22T12:00:00" };
  const criado = { created_at: "2026-11-22T12:00:00", stage_changed_at: null };

  it("o padrão (criados ou movidos) pega o movido; 'criados' NÃO pega", () => {
    expect(negocioNoPeriodo(movido, "2026-11-20", "2026-11-24")).toBe(true);
    expect(negocioNoPeriodo(movido, "2026-11-20", "2026-11-24", "criados_ou_movidos")).toBe(true);
    expect(negocioNoPeriodo(movido, "2026-11-20", "2026-11-24", "criados")).toBe(false);
  });
  it("'criados' continua pegando o criado no período", () => {
    expect(negocioNoPeriodo(criado, "2026-11-20", "2026-11-24", "criados")).toBe(true);
  });
  it("valida o valor", () => {
    expect(ehModoDoPeriodo("criados")).toBe(true);
    expect(ehModoDoPeriodo("movidos")).toBe(false);
  });
  it("applyFilters respeita o modo", () => {
    const m = lead("m", { created_at: "2026-09-01T12:00:00", stage_changed_at: "2026-11-22T12:00:00" });
    expect(ids(applyFilters([m], { de: "2026-11-20", ate: "2026-11-24" }))).toEqual(["m"]);
    expect(ids(applyFilters([m], { de: "2026-11-20", ate: "2026-11-24", periodoModo: "criados" }))).toEqual([]);
  });
  it("o modo vai e volta pela URL; só 'criados' é escrito (o padrão fica limpo)", () => {
    expect(filtersToParams({ de: "2026-11-01", periodoModo: "criados" })).toContain("pmodo=criados");
    expect(filtersToParams({ de: "2026-11-01" })).not.toContain("pmodo");
    expect(filtersFromParams(new URLSearchParams("pmodo=criados")).periodoModo).toBe("criados");
    expect(filtersFromParams(new URLSearchParams("pmodo=xx")).periodoModo).toBeUndefined();
  });
});

describe("periodoDoAtalho (hoje é quarta, 25/11/2026)", () => {
  const QUARTA = new Date(2026, 10, 25, 15, 30);
  const casos: Array<[(typeof ATALHOS_DE_PERIODO)[number], string, string]> = [
    ["hoje", "2026-11-25", "2026-11-25"],
    ["ontem", "2026-11-24", "2026-11-24"],
    ["esta_semana", "2026-11-23", "2026-11-29"], // segunda a domingo
    ["semana_passada", "2026-11-16", "2026-11-22"],
    ["ultimos_7", "2026-11-19", "2026-11-25"],
    ["este_mes", "2026-11-01", "2026-11-30"],
    ["mes_passado", "2026-10-01", "2026-10-31"],
    ["ultimos_30", "2026-10-27", "2026-11-25"],
  ];
  it.each(casos)("%s", (atalho, de, ate) => {
    expect(periodoDoAtalho(atalho, QUARTA)).toEqual({ de, ate });
  });

  it("domingo ainda é da semana que começou na segunda anterior", () => {
    expect(periodoDoAtalho("esta_semana", new Date(2026, 10, 29))).toEqual({ de: "2026-11-23", ate: "2026-11-29" });
  });
  it("segunda abre uma semana nova", () => {
    expect(periodoDoAtalho("esta_semana", new Date(2026, 10, 30))).toEqual({ de: "2026-11-30", ate: "2026-12-06" });
    expect(periodoDoAtalho("semana_passada", new Date(2026, 10, 30))).toEqual({ de: "2026-11-23", ate: "2026-11-29" });
  });
  it("janeiro: o mês passado é dezembro do ano anterior", () => {
    expect(periodoDoAtalho("mes_passado", new Date(2027, 0, 10))).toEqual({ de: "2026-12-01", ate: "2026-12-31" });
  });
  it("fevereiro bissexto fecha no dia 29", () => {
    expect(periodoDoAtalho("este_mes", new Date(2028, 1, 10))).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });
  it("todo atalho devolve dias válidos, de ≤ até", () => {
    for (const a of ATALHOS_DE_PERIODO) {
      const p = periodoDoAtalho(a, QUARTA);
      expect(ehDiaValido(p.de) && ehDiaValido(p.ate) && p.de <= p.ate).toBe(true);
    }
  });
  it("reconhece o atalho ativo pelas datas; personalizado devolve null", () => {
    expect(atalhoAtivoDoPeriodo("2026-11-24", "2026-11-24", QUARTA)).toBe("ontem");
    expect(atalhoAtivoDoPeriodo("2026-11-19", "2026-11-25", QUARTA)).toBe("ultimos_7");
    expect(atalhoAtivoDoPeriodo("2026-11-01", "2026-11-10", QUARTA)).toBeNull();
    expect(atalhoAtivoDoPeriodo(undefined, undefined, QUARTA)).toBeNull();
  });
});
