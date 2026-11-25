import { describe, expect, it } from "vitest";

import { anexarCamposNoCard } from "./campos-no-card";
import { diaEMes, diasDesde, escolherProximaTarefa } from "./resumo-do-card";
import { anexarTarefasAosNegocios } from "./tarefas-no-quadro";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import type { Lead } from "@/lib/types/leads";

const AGORA = new Date("2026-11-24T12:00:00-03:00");

describe("diasDesde", () => {
  it("conta dias inteiros", () => {
    expect(diasDesde("2026-11-21T12:00:00-03:00", AGORA)).toBe(3);
    expect(diasDesde("2026-11-23T18:00:00-03:00", AGORA)).toBe(0);
  });
  it("sem data ou data inválida não inventa número", () => {
    expect(diasDesde(null, AGORA)).toBeNull();
    expect(diasDesde(undefined, AGORA)).toBeNull();
    expect(diasDesde("lixo", AGORA)).toBeNull();
  });
  it("data no futuro vira 0, nunca negativo", () => {
    expect(diasDesde("2026-12-01T12:00:00-03:00", AGORA)).toBe(0);
  });
});

describe("escolherProximaTarefa", () => {
  it("pega o prazo mais cedo; atrasada ganha de futura", () => {
    const r = escolherProximaTarefa([
      { title: "Depois", due_date: "2026-11-30T12:00:00-03:00" },
      { title: "Atrasada", due_date: "2026-11-20T12:00:00-03:00" },
    ]);
    expect(r?.titulo).toBe("Atrasada");
  });
  it("tarefa sem prazo só entra quando nenhuma tem prazo", () => {
    expect(
      escolherProximaTarefa([
        { title: "Sem prazo", due_date: null },
        { title: "Com prazo", due_date: "2026-11-25T12:00:00-03:00" },
      ])?.titulo,
    ).toBe("Com prazo");
    expect(escolherProximaTarefa([{ title: "Sem prazo", due_date: null }])?.titulo).toBe("Sem prazo");
  });
  it("sem título não há o que citar", () => {
    expect(escolherProximaTarefa([{ title: "  ", due_date: null }, { due_date: null }])).toBeUndefined();
  });
  it("empate de prazo é estável pelo título", () => {
    const due = "2026-11-25T12:00:00-03:00";
    expect(
      escolherProximaTarefa([
        { title: "B", due_date: due },
        { title: "A", due_date: due },
      ])?.titulo,
    ).toBe("A");
  });
});

describe("diaEMes", () => {
  it("escreve dd/MM", () => {
    expect(diaEMes("2026-11-25T12:00:00")).toBe("25/11");
    expect(diaEMes("nada")).toBeNull();
  });
});

describe("anexarTarefasAosNegocios — próxima tarefa", () => {
  const lead = (id: string): Lead => ({ id }) as Lead;
  it("cita a próxima EM ABERTO e ignora a encerrada", () => {
    const [l] = anexarTarefasAosNegocios(
      [lead("l1")],
      [
        { lead_id: "l1", title: "Feita", due_date: "2026-11-20T12:00:00-03:00", status: "done" },
        { lead_id: "l1", title: "Fazer follow up", due_date: "2026-11-25T12:00:00-03:00", status: "pending" },
      ],
      AGORA,
    );
    expect(l?.tarefas?.abertas).toBe(1);
    expect(l?.tarefas?.proxima?.titulo).toBe("Fazer follow up");
  });
  it("linha sem título mantém o selo de antes, sem proxima", () => {
    const [l] = anexarTarefasAosNegocios(
      [lead("l1")],
      [{ lead_id: "l1", due_date: null, status: "pending" }],
      AGORA,
    );
    expect(l?.tarefas).toEqual({ abertas: 1, atrasadas: 0 });
  });
});

describe("anexarCamposNoCard", () => {
  const campo = (c: Partial<CustomFieldDef> & Pick<CustomFieldDef, "key" | "type">): CustomFieldDef =>
    ({ label: c.key, ...c }) as CustomFieldDef;
  const lead = (custom_fields: Record<string, unknown>) => ({ id: "l1", custom_fields });

  it("funil sem campo marcado devolve os MESMOS objetos", () => {
    const leads = [lead({ empresa: "X" })];
    expect(anexarCamposNoCard(leads, [campo({ key: "empresa", type: "text" })])).toBe(leads);
  });
  it("mostra só os marcados, na ordem do funil, sem os vazios", () => {
    const [l] = anexarCamposNoCard(
      [lead({ empresa: "Pizzaria", cidade: "", decisor: true, etapa: "b" })],
      [
        campo({ key: "empresa", label: "Empresa", type: "text", no_card: true }),
        campo({ key: "cidade", label: "Cidade", type: "text", no_card: true }),
        campo({ key: "decisor", label: "É o decisor?", type: "boolean", no_card: true }),
        campo({
          key: "etapa",
          label: "Plano",
          type: "select",
          no_card: true,
          options: [{ value: "b", label: "Plano B" }],
        }),
        campo({ key: "oculto", type: "text" }),
      ],
    );
    expect(l?.campos_no_card).toEqual([
      { chave: "empresa", rotulo: "Empresa", tipo: "text", valor: "Pizzaria" },
      { chave: "decisor", rotulo: "É o decisor?", tipo: "boolean", valor: true },
      { chave: "etapa", rotulo: "Plano", tipo: "select", valor: "Plano B" },
    ]);
  });
  it("campo do contato, arquivo e texto longo nunca vão ao card", () => {
    const leads = [lead({ a: "1", b: "2", c: "3" })];
    const r = anexarCamposNoCard(leads, [
      campo({ key: "a", type: "text", no_card: true, escopo: "contato" }),
      campo({ key: "b", type: "file", no_card: true }),
      campo({ key: "c", type: "textarea", no_card: true }),
    ]);
    expect(r).toBe(leads);
  });
  it("boolean falso aparece como Não (checklist desmarcado é informação)", () => {
    const [l] = anexarCamposNoCard(
      [lead({ orc: false })],
      [campo({ key: "orc", label: "Tem orçamento?", type: "boolean", no_card: true })],
    );
    expect(l?.campos_no_card?.[0]?.valor).toBe(false);
  });
});
