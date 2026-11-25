"use client";

/**
 * (Acelera) "+ Nova etapa" no fim do quadro: cria a coluna sem sair do funil.
 *
 * A rota cria a etapa no FIM do funil, e o fim costuma ser "Ganho"/"Perdido".
 * Por isso, logo depois de criar, a etapa é levada para antes das colunas de
 * fechamento e perda (`depoisDeParaEtapaNova`). Se esse segundo passo falhar, a
 * etapa já existe: avisamos, e ela pode ser movida pelo menu da coluna.
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useCriarEtapa, useEditarEtapa } from "@/hooks/pipelines/useStages";
import {
  depoisDeParaEtapaNova,
  etapaQueNasceu,
  etapasDaResposta,
} from "@/lib/kanban/edicao-de-etapas";
import type { Stage } from "@/lib/kanban/types";
import { Plus } from "@/lib/ui/icons";

interface Props {
  pipelineId: string;
  /** As etapas vivas do quadro, na ordem das colunas. */
  etapas: Stage[];
}

export function NovaEtapaNoQuadro({ pipelineId, etapas }: Props) {
  const t = useT();
  const criar = useCriarEtapa(pipelineId);
  const editar = useEditarEtapa(pipelineId);
  const [nome, setNome] = useState<string | null>(null);
  const ocupado = criar.isPending || editar.isPending;

  const salvar = async (evento: FormEvent) => {
    evento.preventDefault();
    const limpo = (nome ?? "").trim();
    if (!limpo || ocupado) return;
    let resposta: unknown;
    try {
      resposta = await criar.mutateAsync(limpo);
    } catch (erro) {
      showApiError(erro);
      return;
    }
    setNome(null);

    const depoisDe = depoisDeParaEtapaNova(etapas);
    const nova = etapaQueNasceu(etapas, etapasDaResposta(resposta));
    if (depoisDe === undefined || !nova) {
      toast.success(`«${limpo}» ${t("entrou no funil.")}`);
      return;
    }
    try {
      await editar.mutateAsync({ stageId: nova.id, patch: { depois_de: depoisDe } });
      toast.success(`«${limpo}» ${t("entrou antes das etapas de fechamento.")}`);
    } catch {
      toast.warning(
        `«${limpo}» ${t("foi criada no fim do funil. Use o menu da coluna para mudá-la de lugar.")}`,
      );
    }
  };

  if (nome === null) {
    return (
      <button
        type="button"
        onClick={() => setNome("")}
        className="flex h-11 w-72 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-dashed border-border text-sm text-text-muted hover:border-border-strong hover:text-text"
        data-testid="nova-etapa-no-quadro"
      >
        <Plus size={16} aria-hidden />
        {t("Nova etapa")}
      </button>
    );
  }

  return (
    <form
      onSubmit={salvar}
      className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-lg border border-border bg-surface-elevated/40 p-3"
      data-testid="nova-etapa-formulario"
    >
      <Input
        autoFocus
        value={nome}
        maxLength={80}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setNome(null);
        }}
        placeholder={t("Nome da nova etapa")}
        aria-label={t("Nome da nova etapa")}
        disabled={ocupado}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setNome(null)} disabled={ocupado}>
          {t("Cancelar")}
        </Button>
        <Button type="submit" size="sm" disabled={ocupado || !nome.trim()}>
          {t("Criar etapa")}
        </Button>
      </div>
    </form>
  );
}
