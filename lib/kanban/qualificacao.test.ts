import { describe, expect, it } from "vitest";

import { anexarQualificacao, camposDeQualificacao, qualificacaoDoNegocio, type CampoDeQualificacao } from "./qualificacao";

const campo = (key: string, resto: Partial<CampoDeQualificacao> = {}): CampoDeQualificacao => ({
  key,
  label: key,
  type: "boolean",
  qualificacao: true,
  ...resto,
});

const PERGUNTAS = [campo("decisor"), campo("orcamento"), campo("solucao"), campo("momento")];

describe("camposDeQualificacao", () => {
  it("só entra boolean, marcado e do negócio, na ordem do funil", () => {
    const r = camposDeQualificacao([
      campo("a"),
      campo("b", { qualificacao: false }),
      campo("c", { qualificacao: undefined }),
      campo("d", { type: "text" }),
      campo("e", { escopo: "contato" }),
      campo("f", { escopo: "negocio" }),
    ]);
    expect(r.map((c) => c.key)).toEqual(["a", "f"]);
  });
});

describe("qualificacaoDoNegocio", () => {
  it("conta só o que está true (false e sem resposta valem igual)", () => {
    const q = qualificacaoDoNegocio(PERGUNTAS, { decisor: true, orcamento: false, solucao: true });
    expect(q?.marcados).toBe(2);
    expect(q?.total).toBe(4);
    expect(q?.itens.map((i) => i.marcado)).toEqual([true, false, true, false]);
  });
  it("texto 'true' ou número 1 NÃO contam: só o booleano", () => {
    const q = qualificacaoDoNegocio(PERGUNTAS, { decisor: "true", orcamento: 1 });
    expect(q?.marcados).toBe(0);
  });
  it("funil sem pergunta marcada = null (a tela não desenha nada)", () => {
    expect(qualificacaoDoNegocio([campo("x", { qualificacao: false })], { x: true })).toBeNull();
    expect(qualificacaoDoNegocio([], {})).toBeNull();
  });
  it("custom_fields nulo não quebra", () => {
    expect(qualificacaoDoNegocio(PERGUNTAS, null)?.marcados).toBe(0);
    expect(qualificacaoDoNegocio(PERGUNTAS, undefined)?.total).toBe(4);
  });
  it("tudo marcado = total", () => {
    const q = qualificacaoDoNegocio(PERGUNTAS, { decisor: true, orcamento: true, solucao: true, momento: true });
    expect(q).toMatchObject({ marcados: 4, total: 4 });
  });
});

describe("anexarQualificacao", () => {
  it("funil sem pergunta devolve os MESMOS objetos", () => {
    const leads = [{ id: "1", custom_fields: { decisor: true } }];
    expect(anexarQualificacao(leads, [campo("decisor", { qualificacao: false })])).toBe(leads);
  });
  it("anexa só os números a cada negócio", () => {
    const [a, b] = anexarQualificacao(
      [
        { id: "1", custom_fields: { decisor: true, momento: true } },
        { id: "2", custom_fields: null },
      ],
      PERGUNTAS,
    );
    expect(a?.qualificacao).toEqual({ marcados: 2, total: 4 });
    expect(b?.qualificacao).toEqual({ marcados: 0, total: 4 });
    expect(a?.qualificacao).not.toHaveProperty("itens");
  });
});
