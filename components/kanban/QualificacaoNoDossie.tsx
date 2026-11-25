"use client";

import { useT } from "@/hooks/i18n/useT";
import { qualificacaoDoNegocio, type CampoDeQualificacao } from "@/lib/kanban/qualificacao";
import { CheckCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  /** As definições do funil (as do dossiê: já só do negócio). */
  campos: readonly CampoDeQualificacao[];
  /** `crm_leads.custom_fields` do negócio. */
  valores: Record<string, unknown> | null | undefined;
}

/**
 * ACELERA (fork): "Qualificação 3/4" no topo do dossiê — as perguntas do funil que
 * o operador marcou "Conta na qualificação", com a resposta de cada uma.
 *
 * É só LEITURA: as respostas se editam em "Dados do negócio" (os mesmos checkboxes
 * de sempre), e o bloco mostra o resultado sem abrir um segundo lugar para
 * gravar a mesma coisa. Funil sem pergunta marcada: nada é desenhado.
 */
export function QualificacaoNoDossie({ campos, valores }: Props) {
  const t = useT();
  const q = qualificacaoDoNegocio(campos, valores);
  if (!q) return null;
  const completa = q.marcados === q.total;

  return (
    <div className="border-b border-border py-3" data-testid="qualificacao-no-dossie">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-text">{t("Qualificação")}</span>
        <span
          className={cn("tabular-nums font-semibold", completa ? "text-success-fg" : "text-text")}
          title={t("Perguntas respondidas \"sim\" neste negócio")}
        >
          {q.marcados}/{q.total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={q.total}
        aria-valuenow={q.marcados}
        aria-label={t("Qualificação")}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn("h-full rounded-full", completa ? "bg-success" : "bg-primary")}
          style={{ width: `${(q.marcados / q.total) * 100}%` }}
        />
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {q.itens.map((item) => (
          <li
            key={item.chave}
            className={cn("flex items-center gap-1.5", item.marcado ? "text-text" : "text-text-muted")}
            data-testid={`qualificacao-item-${item.chave}`}
            data-marcado={item.marcado}
          >
            <CheckCircle
              size={14}
              weight={item.marcado ? "fill" : "regular"}
              aria-hidden
              className={cn("shrink-0", item.marcado ? "text-success" : "opacity-40")}
            />
            <span>{item.rotulo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
