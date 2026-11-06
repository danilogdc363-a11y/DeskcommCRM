import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { lerPlanilhaDeLeads } from "@/lib/leads/planilha";
import { lerLinhasDoArquivo } from "./linhas-do-arquivo";

function bytes(texto: string): ArrayBuffer {
  const b = new TextEncoder().encode(texto);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Um .xlsx mínimo: a primeira aba, textos inline. */
function xlsx(linhas: string[][]): ArrayBuffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = `<worksheet><sheetData>${linhas
    .map(
      (l, r) =>
        `<row r="${r + 1}">${l
          .map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`)
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;
  const zip = zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

describe("lerLinhasDoArquivo", () => {
  it("CSV com BOM, delimitador ; e aspas", async () => {
    const r = await lerLinhasDoArquivo(bytes('﻿nome;valor\n"Silva; Maria";"1.200,00"\n'), "leads.csv");
    expect(r).toEqual({
      linhas: [
        ["nome", "valor"],
        ["Silva; Maria", "1.200,00"],
      ],
    });
  });

  it("XLSX com cabeçalho acentuado vira a mesma matriz do CSV", async () => {
    const r = await lerLinhasDoArquivo(
      xlsx([
        ["Nome", "Estágio", "Telefone"],
        ["Ana", "Proposta", "11988887777"],
      ]),
      "leads.xlsx",
    );
    expect(r).toEqual({
      linhas: [
        ["Nome", "Estágio", "Telefone"],
        ["Ana", "Proposta", "11988887777"],
      ],
    });
  });

  it("XLSX corrompido volta como erro, não como exceção", async () => {
    const r = await lerLinhasDoArquivo(bytes("isto não é um zip"), "leads.xlsx");
    expect("erro" in r).toBe(true);
  });

  it("a matriz do XLSX alimenta o leitor de leads, inclusive a coluna 'Estágio'", async () => {
    const r = await lerLinhasDoArquivo(
      xlsx([
        ["Nome", "Estágio"],
        ["Reforma", "Proposta"],
      ]),
      "leads.xlsx",
    );
    if ("erro" in r) throw new Error(r.erro);
    const leads = lerPlanilhaDeLeads(r.linhas);
    if ("erro" in leads) throw new Error(leads.erro);
    expect(leads.leads[0]).toMatchObject({ title: "Reforma", etapa: "Proposta" });
  });
});
