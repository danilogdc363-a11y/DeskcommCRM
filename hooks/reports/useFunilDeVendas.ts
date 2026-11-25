"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ContagemDoFunil, Modo, Preset } from "@/lib/reports/funil-de-vendas";

export type PeriodoDoFunil = { preset: Preset } | { de: string; ate: string };

export interface NumerosDoMeta {
  gasto: number;
  leadsNoMeta: number;
}

export type Origem = "meta" | "geral" | "organico";
type Comparado = { atual: ContagemDoFunil; antes: ContagemDoFunil };

export interface FunilDeVendas {
  modo: Modo;
  funil: { id: string; nome: string };
  semEtapaDeReuniao: boolean;
  janela: { primeiroDia: string; ultimoDia: string };
  anterior: { primeiroDia: string; ultimoDia: string };
  origens: Record<Origem, Comparado>;
  meta:
    | { ok: true; contaId: string; atual: NumerosDoMeta; antes: NumerosDoMeta }
    | { ok: false; motivo: string };
}

export function useFunilDeVendas(periodo: PeriodoDoFunil, modo: Modo) {
  const base = "preset" in periodo ? `preset=${periodo.preset}` : `de=${periodo.de}&ate=${periodo.ate}`;
  const qs = `${base}&modo=${modo}`;
  return useQuery({
    queryKey: ["reports", "funil-de-vendas", qs],
    queryFn: async () => apiClient.get<{ data: FunilDeVendas }>(`/api/v1/reports/funil-de-vendas?${qs}`),
    staleTime: 60_000,
  });
}
