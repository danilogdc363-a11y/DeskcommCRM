import { describe, expect, it } from "vitest";

import { lerVcard, vcardParaLinhas } from "./vcard";

const cartao = (...linhas: string[]) => ["BEGIN:VCARD", "VERSION:3.0", ...linhas, "END:VCARD"].join("\r\n");

describe("lerVcard", () => {
  it("lê nome, e-mail e um telefone sem DDI (ganha +55)", () => {
    const [c] = lerVcard(cartao("FN:Ana Souza", "TEL;TYPE=CELL:(11) 98888-7777", "EMAIL:ana@exemplo.com"));
    expect(c).toMatchObject({ posicao: 1, nome: "Ana Souza", email: "ana@exemplo.com" });
    expect(c!.telefones).toEqual(["+5511988887777"]);
  });

  it("vários TEL: mantém todos os válidos, na ordem, sem repetir", () => {
    const [c] = lerVcard(
      cartao("FN:Bruno", "TEL;TYPE=CELL:11988887777", "TEL;TYPE=WORK:+55 21 3333-4444", "TEL;TYPE=HOME:(11) 98888-7777"),
    );
    expect(c!.telefones).toEqual(["+5511988887777", "+552133334444"]);
  });

  it("TEL ilegível é contado à parte e não vira telefone", () => {
    const [c] = lerVcard(cartao("FN:Carla", "TEL:abc", "TEL:11988887777"));
    expect(c!.telefones).toEqual(["+5511988887777"]);
    expect(c!.telefonesIlegiveis).toEqual(["abc"]);
  });

  it("sem FN usa o N (Sobrenome;Nome)", () => {
    const [c] = lerVcard(cartao("N:Lima;Dora;;;", "TEL:11988887777"));
    expect(c!.nome).toBe("Dora Lima");
  });

  it("junta linha dobrada e aceita prefixo de grupo e parâmetro waid", () => {
    const texto = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Eduardo da",
      " Silva",
      "item1.TEL;type=pref;waid=5511988887777:+55 11 98888-7777",
      "END:VCARD",
    ].join("\n");
    const [c] = lerVcard(texto);
    expect(c!.nome).toBe("Eduardo daSilva");
    expect(c!.telefones).toEqual(["+5511988887777"]);
  });

  it("decodifica QUOTED-PRINTABLE do vCard 2.1 (acento)", () => {
    const texto = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9",
      "TEL:11988887777",
      "END:VCARD",
    ].join("\n");
    expect(lerVcard(texto)[0]!.nome).toBe("José");
  });

  it("lê vários cartões e tolera BOM", () => {
    const texto = "﻿" + cartao("FN:A", "TEL:11911112222") + "\r\n" + cartao("FN:B", "EMAIL:b@x.com");
    const r = lerVcard(texto);
    expect(r.map((c) => c.nome)).toEqual(["A", "B"]);
    expect(r[1]!.posicao).toBe(2);
  });

  it("arquivo sem cartão devolve lista vazia", () => {
    expect(lerVcard("qualquer coisa")).toEqual([]);
  });
});

describe("vcardParaLinhas", () => {
  it("primeiro telefone vira o principal; os extras vão para o relatório", () => {
    const r = vcardParaLinhas(cartao("FN:Bruno", "TEL:11988887777", "TEL:2133334444", "EMAIL:b@x.com"));
    expect(r.linhas).toEqual([
      ["nome", "telefone", "email"],
      ["Bruno", "+5511988887777", "b@x.com"],
    ]);
    expect(r.extras).toEqual([{ posicao: 1, nome: "Bruno", telefones: ["+552133334444"] }]);
  });

  it("cartão sem telefone legível nem e-mail fica de fora, com a posição", () => {
    const r = vcardParaLinhas(cartao("FN:Vazio") + "\n" + cartao("FN:Ok", "TEL:11988887777"));
    expect(r.semDados).toEqual([{ posicao: 1, nome: "Vazio" }]);
    expect(r.posicoes).toEqual([2]);
    expect(r.total).toBe(2);
  });
});
