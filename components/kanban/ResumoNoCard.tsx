"use client";

import { useT } from "@/hooks/i18n/useT";
import { diaEMes, diasDesde } from "@/lib/kanban/resumo-do-card";
import type { Lead } from "@/lib/types/leads";
import { CalendarBlank } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  lead: Pick<Lead, "created_at" | "conversa" | "tarefas" | "campos_no_card" | "qualificacao">;
  /** Relógio injetável — o teste fixa o "hoje"; o card usa o de agora. */
  agora?: Date;
}

/**
 * ACELERA (fork): o resumo de relance do card — há quantos dias o negócio chegou,
 * há quantos dias foi o último contato, a próxima tarefa com data e os campos do
 * funil que o operador marcou "mostrar no card".
 *
 * Cada linha some sozinha quando não há o que dizer: o card não reserva altura
 * para o que não existe (mesma regra de `ContatoNoCard` e `ArquivosNoCard`).
 *
 * "Último contato" é a última mensagem da conversa mais recente do contato, em
 * qualquer direção (`lead.conversa.last_message_at`). Sem conversa não há
 * "contato há 0 dias": a parte some em vez de inventar um número.
 */
export function ResumoNoCard({ lead, agora }: Props) {
  const t = useT();
  const relogio = agora ?? new Date();

  const diasDeCasa = diasDesde(lead.created_at, relogio);
  const diasSemContato = diasDesde(lead.conversa?.last_message_at, relogio);
  const proxima = lead.tarefas?.proxima;
  const diaDaTarefa = proxima?.due_date ? diaEMes(proxima.due_date) : null;
  const tarefaAtrasada =
    !!proxima?.due_date && new Date(proxima.due_date).getTime() < relogio.getTime();
  const campos = lead.campos_no_card ?? [];

  const partes: string[] = [];
  if (diasDeCasa != null) {
    partes.push(diasDeCasa === 0 ? t("Chegou hoje") : `${t("Chegou há")} ${diasDeCasa}d`);
  }
  if (diasSemContato != null) {
    partes.push(diasSemContato === 0 ? t("Contato hoje") : `${t("Contato há")} ${diasSemContato}d`);
  }

  const qualificacao = lead.qualificacao;

  if (partes.length === 0 && !proxima && campos.length === 0 && !qualificacao) return null;

  return (
    <div className="mt-1 space-y-0.5 text-[11px] text-text-muted" data-testid="resumo-no-card">
      {partes.length > 0 && (
        <p className="truncate tabular-nums" data-testid="resumo-dias">
          {partes.join(" · ")}
        </p>
      )}

      {qualificacao && (
        <p
          className={cn(
            "tabular-nums",
            qualificacao.marcados === qualificacao.total && "font-semibold text-success-fg",
          )}
          data-testid="resumo-qualificacao"
        >
          {t("Qualificação")} {qualificacao.marcados}/{qualificacao.total}
        </p>
      )}

      {proxima && (
        <p
          className={cn(
            "flex min-w-0 items-center gap-1",
            tarefaAtrasada && "font-semibold text-destructive",
          )}
          data-testid="resumo-proxima-tarefa"
          title={proxima.titulo}
        >
          <CalendarBlank size={12} aria-hidden className="shrink-0" />
          <span className="truncate">
            {proxima.titulo}
            {diaDaTarefa ? ` · ${diaDaTarefa}` : ""}
          </span>
        </p>
      )}

      {campos.map((campo) => {
        const valor =
          typeof campo.valor === "boolean"
            ? campo.valor
              ? t("Sim")
              : t("Não")
            : Array.isArray(campo.valor)
              ? campo.valor.join(", ")
              : campo.tipo === "date"
                ? formatarData(campo.valor)
                : campo.valor;
        return (
          <p
            key={campo.chave}
            className="flex min-w-0 gap-1"
            data-testid={`campo-no-card-${campo.chave}`}
            title={`${campo.rotulo}: ${valor}`}
          >
            <span className="shrink-0">{campo.rotulo}:</span>
            <span className="truncate text-text">{valor}</span>
          </p>
        );
      })}
    </div>
  );
}

/** `2026-11-25` → `25/11/2026`. Valor que não é data fica como veio. */
function formatarData(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}
