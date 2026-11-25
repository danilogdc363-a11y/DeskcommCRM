"use client";

import { useT } from "@/hooks/i18n/useT";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bandLabel, type ScoreBand } from "@/lib/kanban/score-band";
import { TEMPERATURAS, ehTemperatura } from "@/lib/kanban/temperatura";
import { cn } from "@/lib/utils";

/** `automatico` não é valor do banco: é o `null` (volta a valer a faixa da IA). */
const AUTOMATICO = "automatico";

interface Props {
  /** O que o operador marcou (`crm_leads.temperatura_manual`); `null`/ausente = automático. */
  valor: ScoreBand | null | undefined;
  /** Sem permissão de editar (ou sem como gravar), vira só um selo de leitura. */
  onMudar?: (temperatura: ScoreBand | null) => void;
}

/** O rótulo colorido, o mesmo no seletor, no selo e no card. */
export function classeDaTemperatura(band: ScoreBand): string {
  return cn(
    band === "quente" && "text-accent",
    band === "morno" && "text-warning-fg",
    band === "frio" && "text-text-muted",
  );
}

/**
 * ACELERA (fork): "quão quente está este lead", marcado pelo operador no dossiê.
 *
 * "Automático" grava `null`: a marcação à mão some e volta a valer a faixa da IA
 * (se houver). A marcação vence a da IA, e a IA nunca a escreve.
 */
export function TemperaturaNoDossie({ valor, onMudar }: Props) {
  const t = useT();
  const atual = ehTemperatura(valor) ? valor : null;

  if (!onMudar) {
    if (!atual) return null;
    return (
      <span className={cn("font-medium", classeDaTemperatura(atual))} data-testid="dossie-temperatura">
        {bandLabel(atual, t)}
      </span>
    );
  }

  return (
    <span data-testid="dossie-temperatura">
      <Select
        value={atual ?? AUTOMATICO}
        onValueChange={(novo) => {
          const proxima = novo === AUTOMATICO ? null : ehTemperatura(novo) ? novo : null;
          if (proxima === atual) return;
          onMudar(proxima);
        }}
      >
        <SelectTrigger
          aria-label={t("Temperatura do lead")}
          className={cn("h-7 w-auto gap-1 px-2 text-xs", atual && classeDaTemperatura(atual))}
          data-testid="dossie-temperatura-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTOMATICO} className="text-xs">
            {t("Temperatura: automática")}
          </SelectItem>
          {TEMPERATURAS.map((band) => (
            <SelectItem key={band} value={band} className="text-xs">
              {bandLabel(band, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}
