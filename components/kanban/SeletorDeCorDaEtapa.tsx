"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/hooks/i18n/useT";
import { PALETA_DE_ETAPA, normalizarHex } from "@/lib/kanban/cores-de-etapa";
import { cn } from "@/lib/utils";

interface Props {
  /** A cor que a etapa mostra agora (já com o padrão da posição aplicado). */
  cor: string;
  /** `true` quando a cor veio do padrão, não de uma escolha. */
  ehPadrao: boolean;
  nomeDaEtapa: string;
  /** `null` = voltar à cor padrão da posição. */
  onEscolher: (cor: string | null) => void;
}

/**
 * A bolinha da etapa que, para quem pode editar, abre a paleta. Para quem não
 * pode, o chamador renderiza só a bolinha — não existe botão desabilitado aqui.
 */
export function SeletorDeCorDaEtapa({ cor, ehPadrao, nomeDaEtapa, onEscolher }: Props) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [livre, setLivre] = useState("");
  const livreNormalizado = normalizarHex(livre);
  const livreInvalido = livre.trim() !== "" && livreNormalizado === null;

  const escolher = (c: string | null) => {
    onEscolher(c);
    setAberto(false);
    setLivre("");
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t("Cor da etapa")} ${nomeDaEtapa}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full outline-offset-2 hover:bg-surface"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: cor }}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-3">
        <p className="mb-2 text-xs font-medium text-text">{t("Cor da etapa")}</p>
        <div className="grid grid-cols-5 gap-2">
          {PALETA_DE_ETAPA.map((c) => {
            const atual = !ehPadrao && c.hex.toUpperCase() === cor.toUpperCase();
            return (
              <button
                key={c.chave}
                type="button"
                title={rotuloDaCor(c.chave, t)}
                aria-label={rotuloDaCor(c.chave, t)}
                aria-pressed={atual}
                onClick={() => escolher(c.hex)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md border border-border",
                  atual && "ring-2 ring-accent ring-offset-1",
                )}
                style={{ backgroundColor: c.hex }}
              >
                {atual && <Check className="h-4 w-4 text-white mix-blend-difference" aria-hidden />}
              </button>
            );
          })}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (livreNormalizado) escolher(livreNormalizado);
          }}
        >
          <input
            value={livre}
            onChange={(e) => setLivre(e.target.value)}
            placeholder="#FF7300"
            aria-label={t("Outra cor (hex)")}
            aria-invalid={livreInvalido}
            maxLength={7}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs",
              livreInvalido ? "border-error" : "border-border",
            )}
          />
          <button
            type="submit"
            disabled={!livreNormalizado}
            className="h-8 rounded-md border border-border px-2 text-xs text-text hover:bg-surface disabled:opacity-50"
          >
            {t("Usar")}
          </button>
        </form>
        {livreInvalido && (
          <p className="mt-1 text-[11px] text-error">{t("Use o formato #RRGGBB.")}</p>
        )}
        {!ehPadrao && (
          <button
            type="button"
            onClick={() => escolher(null)}
            className="mt-3 text-[11px] text-text-muted underline hover:text-text"
          >
            {t("Voltar à cor padrão")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Um `t()` literal por cor: a cerca do espanhol lê as chaves no código. */
function rotuloDaCor(chave: string, t: (texto: string) => string): string {
  switch (chave) {
    case "laranja":
      return t("Laranja");
    case "ambar":
      return t("Âmbar");
    case "vermelho":
      return t("Vermelho");
    case "rosa":
      return t("Rosa");
    case "violeta":
      return t("Violeta");
    case "azul":
      return t("Azul");
    case "ciano":
      return t("Ciano");
    case "turquesa":
      return t("Turquesa");
    case "verde":
      return t("Verde");
    default:
      return t("Cinza");
  }
}
