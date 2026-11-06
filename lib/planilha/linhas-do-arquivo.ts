/**
 * As LINHAS de um arquivo de importação (cabeçalho + dados), venha ele como CSV
 * ou como XLSX — uma porta só para as rotas de leads e de contatos.
 *
 * O XLSX é lido por `parseImportFile` (fflate, já instalado): nenhuma lib de
 * planilha nova entrou. O CSV segue por `decodificarCsv` + `parseCsv`, a mesma
 * regra de charset de sempre (#483). Quem chama recebe a mesma matriz nos dois
 * casos e não precisa saber o formato.
 */
import { decodificarCsv, parseCsv } from "@/lib/contacts/csv";
import { isXlsxFilename, parseImportFile } from "@/lib/planilha/ler-arquivo";

export type LinhasDoArquivo = { linhas: string[][] } | { erro: string };

export async function lerLinhasDoArquivo(bytes: ArrayBuffer, nomeDoArquivo: string): Promise<LinhasDoArquivo> {
  if (isXlsxFilename(nomeDoArquivo)) {
    // O teto de linhas é da ROTA (500); aqui só se evita recusar antes dela.
    const lido = await parseImportFile(bytes, nomeDoArquivo, { maxLinhas: 10_000 });
    if (!lido.ok) return { erro: lido.error };
    return { linhas: [lido.sheet.headers, ...lido.sheet.rows] };
  }
  const decodificado = decodificarCsv(bytes);
  if ("erro" in decodificado) return { erro: decodificado.erro };
  return { linhas: parseCsv(decodificado.texto) };
}
