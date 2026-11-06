"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { chaveDoQuadro } from "./useBoard";
import type { BoardData } from "@/lib/kanban/types";

interface ColorArgs {
  stageId: string;
  /** `#RRGGBB`, ou `null` para voltar à cor padrão da posição. */
  color: string | null;
}

/**
 * Trocar a cor da etapa direto no cabeçalho da coluna. Mesma rota do renomear
 * (`PATCH /api/v1/pipelines/:id/stages/:stageId`, papel manager+); otimista,
 * com a invalidação reconciliando com o servidor.
 */
export function useStageColor(pipelineId: string) {
  const qc = useQueryClient();
  const queryKey = chaveDoQuadro(pipelineId);

  return useMutation({
    mutationFn: ({ stageId, color }: ColorArgs) =>
      apiClient.patch(`/api/v1/pipelines/${pipelineId}/stages/${stageId}`, { color }),
    onMutate: async ({ stageId, color }) => {
      await qc.cancelQueries({ queryKey });
      const snapshot = qc.getQueryData<BoardData>(queryKey);
      if (snapshot) {
        qc.setQueryData<BoardData>(queryKey, {
          ...snapshot,
          stages: snapshot.stages.map((s) => (s.id === stageId ? { ...s, color } : s)),
        });
      }
      return { snapshot };
    },
    onError: (err, _args, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(queryKey, ctx.snapshot);
      showApiError(err);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });
}
