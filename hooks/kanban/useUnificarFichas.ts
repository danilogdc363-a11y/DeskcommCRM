"use client";
/**
 * ACELERA (fork) — "Unificar fichas" de negócio.
 *
 * `usePreviaDaUnificacao`: pergunta ao servidor o que SERIA juntado (nada é
 * escrito). `useUnificarFichas`: junta de verdade. Os dois batem na mesma rota,
 * `POST /api/v1/leads/merge`, só mudando `preview`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { LeadsMergeInput } from "@/lib/schemas/leads";
import type { ResultadoDaUnificacao } from "@/app/api/v1/leads/merge/route";

export function usePreviaDaUnificacao(primaryLeadId: string | null, secondaryLeadIds: string[]) {
  return useQuery({
    queryKey: ["leads-merge-preview", primaryLeadId, [...secondaryLeadIds].sort()],
    enabled: Boolean(primaryLeadId) && secondaryLeadIds.length > 0,
    staleTime: 0,
    queryFn: async () => {
      const res = await apiClient.post<{ data: ResultadoDaUnificacao }>("/api/v1/leads/merge", {
        primary_lead_id: primaryLeadId ?? "",
        secondary_lead_ids: secondaryLeadIds,
        preview: true,
      } satisfies LeadsMergeInput);
      return res.data;
    },
  });
}

export function useUnificarFichas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<LeadsMergeInput, "preview">) =>
      apiClient.post<{ data: ResultadoDaUnificacao }>("/api/v1/leads/merge", {
        ...input,
        preview: false,
      }),
    onError: showApiError,
    onSuccess: () => {
      // A unificação mexe em negócio, contato, conversa e linha do tempo.
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
