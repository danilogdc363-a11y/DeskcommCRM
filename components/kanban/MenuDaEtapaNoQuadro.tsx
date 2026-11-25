"use client";

/**
 * (Acelera) O menu "⋯" no cabeçalho da coluna: mover a etapa de lugar e
 * arquivá-la sem sair do quadro. Renomear e trocar a cor já são feitos no
 * próprio cabeçalho; o resto da configuração (papel de fechamento/perda,
 * probabilidade, aviso na Central) continua em Configurações › Funis, e o menu
 * leva até lá.
 *
 * Mesmas rotas e hooks da tela de Configurações (`hooks/pipelines/useStages.ts`):
 * as regras vivem no servidor (`lib/leads/stage-operations.ts`), e a recusa dele
 * (ex.: "cada funil precisa de uma etapa de fechamento") aparece como veio.
 */
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useArquivarEtapa, useEditarEtapa } from "@/hooks/pipelines/useStages";
import { ApiError } from "@/lib/api/types";
import {
  depoisDeParaMover,
  destinosAoArquivar,
  type Direcao,
} from "@/lib/kanban/edicao-de-etapas";
import type { Stage } from "@/lib/kanban/types";
import { Archive, CaretLeft, CaretRight, DotsThree, Gear } from "@/lib/ui/icons";

interface Props {
  pipelineId: string;
  etapa: Stage;
  /** As etapas vivas do quadro, na ordem das colunas. */
  etapas: Stage[];
}

export function MenuDaEtapaNoQuadro({ pipelineId, etapa, etapas }: Props) {
  const t = useT();
  const editar = useEditarEtapa(pipelineId);
  const [arquivando, setArquivando] = useState(false);

  const mover = (direcao: Direcao) => {
    const depoisDe = depoisDeParaMover(etapas, etapa.id, direcao);
    if (depoisDe === undefined) return;
    editar.mutate({ stageId: etapa.id, patch: { depois_de: depoisDe } }, { onError: showApiError });
  };

  const podeEsquerda = depoisDeParaMover(etapas, etapa.id, "esquerda") !== undefined;
  const podeDireita = depoisDeParaMover(etapas, etapa.id, "direita") !== undefined;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-elevated hover:text-text disabled:opacity-50"
            aria-label={`${t("Opções da etapa")} «${etapa.name}»`}
            data-testid={`menu-da-etapa-${etapa.id}`}
            disabled={editar.isPending}
          >
            <DotsThree size={18} weight="bold" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!podeEsquerda} onClick={() => mover("esquerda")}>
            <CaretLeft size={14} aria-hidden className="mr-2" />
            {t("Mover para a esquerda")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!podeDireita} onClick={() => mover("direita")}>
            <CaretRight size={14} aria-hidden className="mr-2" />
            {t("Mover para a direita")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setArquivando(true)}>
            <Archive size={14} aria-hidden className="mr-2" />
            {t("Arquivar etapa…")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/settings/tenant/pipelines">
              <Gear size={14} aria-hidden className="mr-2" />
              {t("Mais ajustes do funil")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {arquivando && (
        <ArquivarEtapaDialog
          pipelineId={pipelineId}
          etapa={etapa}
          etapas={etapas}
          onFechar={() => setArquivando(false)}
        />
      )}
    </>
  );
}

function ArquivarEtapaDialog({
  pipelineId,
  etapa,
  etapas,
  onFechar,
}: {
  pipelineId: string;
  etapa: Stage;
  etapas: Stage[];
  onFechar: () => void;
}) {
  const t = useT();
  const arquivar = useArquivarEtapa(pipelineId);
  // `null` até o servidor dizer que há negócios na etapa: quem conta é ele, não
  // a coluna, que pode estar filtrada.
  const [negocios, setNegocios] = useState<number | null>(null);
  const [destino, setDestino] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const destinos = destinosAoArquivar(etapas, etapa.id);
  const precisaDestino = negocios !== null && negocios > 0;

  const confirmar = () => {
    setErro(null);
    arquivar.mutate(
      { stageId: etapa.id, destinoId: precisaDestino ? destino : null },
      {
        onSuccess: () => {
          toast.success(`«${etapa.name}» ${t("saiu do quadro.")}`);
          onFechar();
        },
        onError: (e) => {
          const detalhes = e instanceof ApiError ? e.details : undefined;
          // Negócios na etapa não é recusa final, é a pergunta "para onde vão?".
          // Quem diz que é esse o caso é o servidor (`precisa_destino`).
          if (detalhes?.precisa_destino === true) {
            setNegocios(typeof detalhes.negocios === "number" ? detalhes.negocios : 1);
            return;
          }
          setErro(mensagemDaRecusa(e, t));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("Arquivar")} «{etapa.name}»?
          </DialogTitle>
          <DialogDescription>
            {t(
              "A coluna sai do quadro. O histórico dos negócios que passaram por ela continua guardado.",
            )}
          </DialogDescription>
        </DialogHeader>

        {precisaDestino && (
          <div className="grid gap-2" data-testid="arquivar-etapa-destino">
            <p className="text-sm">
              {negocios === 1
                ? t("1 negócio está nesta etapa. Para onde ele vai?")
                : `${negocios} ${t("negócios estão nesta etapa. Para onde eles vão?")}`}
            </p>
            <Select value={destino ?? undefined} onValueChange={setDestino}>
              <SelectTrigger aria-label={t("Etapa de destino")} className="h-9">
                <SelectValue placeholder={t("Escolha a etapa")} />
              </SelectTrigger>
              <SelectContent>
                {destinos.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {erro && (
          <p role="alert" className="text-sm text-error">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={arquivar.isPending}>
            {t("Cancelar")}
          </Button>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={arquivar.isPending || (precisaDestino && !destino)}
            data-testid="arquivar-etapa-confirmar"
          >
            {precisaDestino ? t("Mover e arquivar") : t("Arquivar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A frase da recusa: a do servidor quando é regra (409/422), senão uma genérica. */
function mensagemDaRecusa(e: unknown, t: (texto: string) => string): string {
  if (e instanceof ApiError) {
    if (e.status === 409 || e.status === 422) return t(e.message);
    if (e.status === 403) return t("Você não tem permissão para mudar as etapas deste funil.");
  }
  return t("Não deu para salvar agora. Tente de novo em instantes.");
}
