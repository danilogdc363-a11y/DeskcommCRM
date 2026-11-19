"use client";
/**
 * ACELERA (fork) — "Unificar fichas": junta 2+ negócios selecionados no quadro.
 *
 * Três passos na mesma janela: (1) quem fica como principal — escolha
 * EXPLÍCITA, com o mais antigo sugerido; (2) a prévia do servidor do que vai
 * ser juntado; (3) o Confirmar, que nomeia quem fica e quem é absorvido. Não
 * tem desfazer, por isso o botão só aparece depois da prévia.
 */
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { usePreviaDaUnificacao, useUnificarFichas } from "@/hooks/kanban/useUnificarFichas";
import { formatarReais, rotuloDoRepontado, sugerirPrincipal } from "@/lib/kanban/unificar-fichas";

interface LeadResumo {
  id: string;
  title: string | null;
  value_cents: number | null;
  status: string;
  created_at: string;
  contact_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onDone: () => void;
}

export function UnificarFichasDialog({ open, onOpenChange, leadIds, onDone }: Props) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const consultas = useQueries({
    queries: leadIds.map((id) => ({
      queryKey: ["lead", id, "resumo-unificar"],
      enabled: open,
      queryFn: async () => (await apiClient.get<{ data: LeadResumo }>(`/api/v1/leads/${id}`)).data,
    })),
  });
  const carregando = consultas.some((c) => c.isLoading);
  const leads = useMemo(
    () => consultas.map((c) => c.data).filter((l): l is LeadResumo => Boolean(l)),
    [consultas],
  );

  const [escolhido, setEscolhido] = useState<string | null>(null);
  const principalId = escolhido ?? sugerirPrincipal(leads);
  const secundarios = leadIds.filter((id) => id !== principalId);
  const previa = usePreviaDaUnificacao(open ? principalId : null, open ? secundarios : []);
  const unificar = useUnificarFichas();

  const nome = (id: string | null) => leads.find((l) => l.id === id)?.title || t("sem título");

  const confirmar = () => {
    if (!principalId) return;
    unificar.mutate(
      { primary_lead_id: principalId, secondary_lead_ids: secundarios },
      {
        onSuccess: () => {
          toast.success(`${t("Fichas unificadas em")} "${nome(principalId)}".`);
          onOpenChange(false);
          onDone();
        },
      },
    );
  };

  const contatosDiferentes = new Set(leads.map((l) => l.contact_id).filter(Boolean)).size > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Unificar fichas")}</DialogTitle>
          <DialogDescription>
            {t(
              "Escolha qual negócio fica como principal. Os outros passam tudo para ele (atividades, histórico de etapas, tags, campos) e saem do funil marcados como unificados. Nada é apagado, mas não dá para desfazer.",
            )}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="space-y-2">
            {leadIds.map((id) => (
              <Skeleton key={id} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <fieldset className="space-y-2" aria-label={t("Negócio principal")}>
            {leads.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 text-sm has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name="principal"
                  value={l.id}
                  checked={principalId === l.id}
                  onChange={() => setEscolhido(l.id)}
                />
                <span className="flex-1">
                  <span className="font-medium">{l.title || t("sem título")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatarReais(l.value_cents)} · {t("criado em")}{" "}
                    {new Date(l.created_at).toLocaleDateString(idioma)} · {l.status}
                  </span>
                </span>
                {principalId === l.id && <span className="text-xs font-semibold">{t("Fica")}</span>}
              </label>
            ))}
          </fieldset>
        )}

        <div className="rounded-md bg-muted/40 p-3 text-sm" data-previa-unificacao>
          <p className="mb-1 font-medium">
            {t("O que vai para")} &quot;{nome(principalId)}&quot;
          </p>
          {previa.isLoading || carregando ? (
            <Skeleton className="h-10 w-full" />
          ) : previa.isError ? (
            <p className="text-destructive">{t("Não deu para montar a prévia.")}</p>
          ) : previa.data ? (
            <ul className="list-disc pl-5">
              {Object.entries(previa.data.repontado).map(([chave, n]) => (
                <li key={chave}>
                  {n} {t(rotuloDoRepontado(chave))}
                </li>
              ))}
              {(previa.data.tags_novas ?? []).length > 0 && (
                <li>{t("tags")}: {(previa.data.tags_novas ?? []).join(", ")}</li>
              )}
              {(previa.data.campos_novos ?? []).length > 0 && (
                <li>{t("campos")}: {(previa.data.campos_novos ?? []).join(", ")}</li>
              )}
              {contatosDiferentes && (
                <li>
                  {t(
                    "os contatos também são juntados (mensagens do WhatsApp, tarefas e conversas vão junto)",
                  )}
                </li>
              )}
              {Object.keys(previa.data.repontado).length === 0 && !contatosDiferentes && (
                <li>{t("nada além do próprio card")}</li>
              )}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button
            onClick={confirmar}
            disabled={!previa.data || unificar.isPending || carregando}
            data-confirmar-unificacao
          >
            {t("Manter")} &quot;{nome(principalId)}&quot; {t("e absorver")} {secundarios.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
