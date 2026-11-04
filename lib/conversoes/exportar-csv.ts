/**
 * CSV do histórico de envios de conversão (o "relatório para baixar" do Tintim).
 *
 * Formatação pura: a rota lê as linhas e entrega aqui. O nome do negócio é dado
 * pessoal e texto livre, então toda célula passa por `neutralizarFormula`.
 */
import { neutralizarFormula } from "@/lib/csv/neutralizar-formula";

import { situacaoDaLinha, type LinhaDoHistorico } from "./historico";

export const CABECALHO_DO_CSV_DE_CONVERSOES = [
  "tentado_em",
  "ocorrido_em",
  "negocio",
  "plataforma",
  "evento",
  "situacao",
  "motivo",
  "valor",
  "moeda",
  "protocolo",
  "detalhe",
  "lead_id",
] as const;

export function celulaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = neutralizarFormula(String(valor));
  return /[",;\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function valorEmReais(centavos: number | null): string {
  return centavos === null ? "" : (centavos / 100).toFixed(2);
}

export function csvDeConversoes(linhas: LinhaDoHistorico[]): string {
  const corpo = linhas.map((l) =>
    [
      l.tentadoEm,
      l.ocorridoEm,
      l.tituloDoLead,
      l.plataforma,
      l.evento,
      situacaoDaLinha(l.status, l.motivo),
      l.motivo,
      valorEmReais(l.valorCentavos),
      l.moeda,
      l.protocolo,
      l.detalhe,
      l.leadId,
    ]
      .map(celulaCsv)
      .join(","),
  );
  // BOM: o Excel em pt-BR só lê acento de CSV UTF-8 quando ele existe.
  return "﻿" + [CABECALHO_DO_CSV_DE_CONVERSOES.join(","), ...corpo].join("\n") + "\n";
}
