/**
 * Leitor de vCard (.vcf) para importar contatos — a agenda que o celular exporta.
 *
 * Só o que o CRM usa: nome, telefones e e-mail. Entende vCard 2.1, 3.0 e 4.0 no
 * que importa: linhas dobradas (continuação começa com espaço/tab), parâmetros
 * (`TEL;TYPE=CELL;waid=...:`), prefixo de grupo (`item1.TEL`), `FN` com
 * `N` de reserva, e valor `QUOTED-PRINTABLE` do 2.1. Foto, endereço e o resto
 * ficam de fora de propósito.
 *
 * Telefone sai normalizado pela MESMA regra da planilha (`normalizaTelefone`):
 * sem DDI ganha +55. Número que não dá para ler é descartado e CONTADO — o
 * relatório da rota diz quantos, sem inventar telefone.
 */
import { normalizaTelefone } from "@/lib/contacts/csv";

export interface ContatoDoVcard {
  /** Ordem do cartão no arquivo, a partir de 1 — para o relatório de linhas. */
  posicao: number;
  nome: string | null;
  /** Telefones válidos, normalizados, sem repetir, na ordem do arquivo. */
  telefones: string[];
  /** TEL do cartão que não pôde ser lido como telefone. */
  telefonesIlegiveis: string[];
  email: string | null;
}

/** Junta as linhas dobradas e separa em linhas lógicas. */
function linhasLogicas(texto: string): string[] {
  const cru = texto.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const saida: string[] = [];
  for (const linha of cru) {
    if ((linha.startsWith(" ") || linha.startsWith("\t")) && saida.length > 0) {
      saida[saida.length - 1] += linha.slice(1);
    } else {
      saida.push(linha);
    }
  }
  return saida;
}

/** `=C3=A7` → ç. Só para valores marcados QUOTED-PRINTABLE (vCard 2.1). */
function decodificarQuotedPrintable(valor: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < valor.length; i += 1) {
    const hex = valor.slice(i + 1, i + 3);
    if (valor[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(valor.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
}

function desescapar(valor: string): string {
  return valor.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? " " : c));
}

/** Nome a partir de `N:Sobrenome;Nome;Adicional;Prefixo;Sufixo`. */
function nomeDoCampoN(valor: string): string {
  const [sobrenome = "", nome = "", adicional = ""] = valor.split(";");
  return [nome, adicional, sobrenome].map((p) => p.trim()).filter(Boolean).join(" ");
}

export function lerVcard(texto: string): ContatoDoVcard[] {
  const contatos: ContatoDoVcard[] = [];
  let atual: { fn: string; n: string; tels: string[]; email: string } | null = null;

  for (const linha of linhasLogicas(texto)) {
    const maiuscula = linha.trim().toUpperCase();
    if (maiuscula === "BEGIN:VCARD") {
      atual = { fn: "", n: "", tels: [], email: "" };
      continue;
    }
    if (maiuscula === "END:VCARD") {
      if (atual) contatos.push(fecharCartao(atual, contatos.length + 1));
      atual = null;
      continue;
    }
    if (!atual) continue;

    const doisPontos = linha.indexOf(":");
    if (doisPontos < 1) continue;
    const [chaveCompleta = "", ...parametros] = linha.slice(0, doisPontos).split(";");
    const propriedade = (chaveCompleta.split(".").pop() ?? "").toUpperCase();
    let valor = linha.slice(doisPontos + 1);
    if (parametros.some((p) => /^ENCODING=QUOTED-PRINTABLE$/i.test(p) || /^QUOTED-PRINTABLE$/i.test(p))) {
      valor = decodificarQuotedPrintable(valor);
    }
    valor = valor.trim();
    if (propriedade === "FN" && !atual.fn) atual.fn = desescapar(valor).trim();
    else if (propriedade === "N" && !atual.n) atual.n = nomeDoCampoN(desescapar(valor));
    else if (propriedade === "TEL") atual.tels.push(valor.replace(/^tel:/i, ""));
    else if (propriedade === "EMAIL" && !atual.email && valor.includes("@")) atual.email = valor;
  }
  return contatos;
}

function fecharCartao(c: { fn: string; n: string; tels: string[]; email: string }, posicao: number): ContatoDoVcard {
  const telefones: string[] = [];
  const telefonesIlegiveis: string[] = [];
  for (const bruto of c.tels) {
    const normalizado = bruto.trim() === "" ? null : normalizaTelefone(bruto);
    if (!normalizado) {
      if (bruto.trim() !== "") telefonesIlegiveis.push(bruto.trim());
    } else if (!telefones.includes(normalizado)) {
      telefones.push(normalizado);
    }
  }
  return {
    posicao,
    nome: c.fn || c.n || null,
    telefones,
    telefonesIlegiveis,
    email: c.email || null,
  };
}

/**
 * O vCard na forma que o importador de contatos já entende: cabeçalho
 * `nome,telefone,email` + uma linha por cartão. Telefone principal = o primeiro
 * válido; os demais ficam em `extras` para o relatório (a ficha com vários
 * telefones é outra tela). Cartão sem telefone legível nem e-mail NÃO vira
 * linha: entra em `semDados` com o motivo.
 */
export function vcardParaLinhas(texto: string): {
  linhas: string[][];
  /** O número do cartão no arquivo para cada linha de dados (alinhado a `linhas.slice(1)`). */
  posicoes: number[];
  extras: { posicao: number; nome: string | null; telefones: string[] }[];
  semDados: { posicao: number; nome: string | null }[];
  total: number;
} {
  const cartoes = lerVcard(texto);
  const linhas: string[][] = [["nome", "telefone", "email"]];
  const posicoes: number[] = [];
  const extras: { posicao: number; nome: string | null; telefones: string[] }[] = [];
  const semDados: { posicao: number; nome: string | null }[] = [];
  for (const c of cartoes) {
    if (c.telefones.length === 0 && !c.email) {
      semDados.push({ posicao: c.posicao, nome: c.nome });
      continue;
    }
    linhas.push([c.nome ?? "", c.telefones[0] ?? "", c.email ?? ""]);
    posicoes.push(c.posicao);
    if (c.telefones.length > 1) extras.push({ posicao: c.posicao, nome: c.nome, telefones: c.telefones.slice(1) });
  }
  return { linhas, posicoes, extras, semDados, total: cartoes.length };
}
