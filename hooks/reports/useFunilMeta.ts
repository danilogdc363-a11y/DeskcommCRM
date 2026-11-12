"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { LinhaDeComparacao, LinhaDoFunil, Preset } from "@/lib/reports/funil-meta";

export type Periodo = { preset: Preset } | { de: string; ate: string };

export interface ResultadoDoFunil {
  janela: { de: string; ate: string; primeiroDia: string; ultimoDia: string };
  funil: { id: string; nome: string; etapas: LinhaDoFunil[] };
  meta:
    | { ok: true; datasetId: string; diasSemDados: number; comparacao: LinhaDeComparacao[] }
    | { ok: false; motivo: string; comparacao: LinhaDeComparacao[] };
  /** null quando a instalação não tem a tabela de cliques (antes da 1.100). */
  cliques: {
    total: number;
    leadSubmitted: number;
    porDia: Array<{ dia: string; cliques: number; leadSubmitted: number }>;
  } | null;
}

export function useFunilMeta(periodo: Periodo) {
  const qs =
    "preset" in periodo ? `preset=${periodo.preset}` : `de=${periodo.de}&ate=${periodo.ate}`;
  return useQuery({
    queryKey: ["reports", "funil-meta", qs],
    queryFn: async () =>
      apiClient.get<{ data: ResultadoDoFunil }>(`/api/v1/reports/funil-meta?${qs}`),
    staleTime: 60_000,
  });
}
