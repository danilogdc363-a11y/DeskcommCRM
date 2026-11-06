"use client";
/**
 * ACELERA (só do fork): os três gestos do comercial no topo da conversa: criar
 * lead, disparar evento à Meta e agendar mensagem. O cabeçalho só decide onde o
 * botão mora (barra ou menu); os diálogos e a lista de agendados moram aqui.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBulkAction } from "@/hooks/kanban/useBulkAction";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useDefaultPipeline, type DefaultPipelineData } from "@/hooks/pipelines/useDefaultPipeline";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { estadoDaJanela } from "@/lib/channels/janela";

export type AcaoComercial = "lead" | "evento" | "agendar";

const FUSO = "America/Sao_Paulo";
/** O drain roda a cada minuto; passou disto, a resposta deixa de ser "aguarde". */
const ESPERA_DO_EVENTO_MS = 90_000;

const agoraEmMs = () => Date.now();

function mensagemDoErro(erro: unknown, padrao: string): string {
  return erro instanceof ApiError && erro.message ? erro.message : padrao;
}

function NovoLead({ contactId, onFechar }: { contactId: string; onFechar: () => void }) {
  const t = useT();
  const comercial = useQuery({
    queryKey: ["funil-do-comercial"],
    staleTime: 60_000,
    queryFn: async () =>
      (await apiClient.get<{ data: DefaultPipelineData | null }>("/api/v1/pipelines/funil-do-comercial"))
        .data,
  });
  const padrao = useDefaultPipeline(comercial.isSuccess && comercial.data === null);
  const funil = comercial.data ?? padrao.data;
  if (!funil) {
    if (comercial.isError || padrao.isError) {
      return (
        <Dialog open onOpenChange={onFechar}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Criar lead")}</DialogTitle>
              <DialogDescription>{t("Nenhum funil configurado nesta organização.")}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
    }
    return null;
  }
  return (
    <NewLeadDialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
      pipelineId={funil.pipeline.id}
      stages={funil.stages}
      contactId={contactId}
    />
  );
}

interface OpcaoDaTela {
  chave: string;
  rotulo: string;
  stageId: string | null;
  etapa: string | null;
  bloqueio: string | null;
  motivoLegivel: string | null;
  registro: { status: string; em: string | null } | null;
}

interface EventosDoLead {
  lead: { id: string; title: string; pipeline_id: string } | null;
  opcoes: OpcaoDaTela[];
}

function DispararEvento({ conversationId, onFechar }: { conversationId: string; onFechar: () => void }) {
  const t = useT();
  const [disparo, setDisparo] = useState<{ chave: string; inicio: number } | null>(null);
  const [esgotou, setEsgotou] = useState(false);
  useEffect(() => {
    if (!disparo) return;
    const relogio = setTimeout(() => setEsgotou(true), ESPERA_DO_EVENTO_MS);
    return () => clearTimeout(relogio);
  }, [disparo]);
  const eventos = useQuery({
    queryKey: ["eventos-do-lead", conversationId],
    queryFn: async () =>
      (await apiClient.get<{ data: EventosDoLead }>(
        `/api/v1/conversations/${conversationId}/eventos-do-lead`,
      )).data,
    refetchInterval: disparo && !esgotou ? 4_000 : false,
  });
  const lead = eventos.data?.lead ?? null;
  const mover = useBulkAction(lead?.pipeline_id ?? "");

  async function disparar(opcao: OpcaoDaTela) {
    if (!lead || !opcao.stageId) return;
    try {
      await mover.mutateAsync({ action: "move", lead_ids: [lead.id], params: { stage_id: opcao.stageId } });
      setEsgotou(false);
      setDisparo({ chave: opcao.chave, inicio: agoraEmMs() });
      void eventos.refetch();
    } catch {
      // o hook já mostrou o motivo da recusa
    }
  }

  const disparada = eventos.data?.opcoes.find((o) => o.chave === disparo?.chave);
  const respostaNova =
    disparo && disparada?.registro?.em && Date.parse(disparada.registro.em) >= disparo.inicio - 5_000
      ? disparada
      : null;

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Disparar evento")}</DialogTitle>
          <DialogDescription>
            {t("Move o card para a etapa, e a regra da etapa envia o evento à Meta em até cerca de 1 minuto.")}
          </DialogDescription>
        </DialogHeader>
        {eventos.isLoading && <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>}
        {eventos.isError && (
          <p className="text-sm text-destructive">
            {mensagemDoErro(eventos.error, t("Não foi possível ler os eventos deste lead."))}
          </p>
        )}
        {eventos.isSuccess && !lead && (
          <p className="text-sm text-destructive" data-testid="evento-sem-lead">
            {t("Este contato não tem lead aberto. Crie o lead antes de disparar o evento.")}
          </p>
        )}
        <div className="space-y-2">
          {eventos.data?.opcoes.map((opcao) => (
            <div key={opcao.chave}>
              <Button
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                disabled={opcao.bloqueio !== null || mover.isPending}
                onClick={() => void disparar(opcao)}
                data-testid={`evento-${opcao.chave}`}
              >
                {t(opcao.rotulo)}
                {opcao.etapa ? ` (${t("mover para")} ${opcao.etapa})` : ""}
              </Button>
              {opcao.bloqueio && <p className="mt-1 text-xs text-muted-foreground">{opcao.bloqueio}</p>}
            </div>
          ))}
        </div>
        {disparo && (
          <p className="text-sm" role="status" data-testid="evento-resultado">
            {respostaNova?.registro?.status === "sent"
              ? t("Evento enviado à Meta.")
              : respostaNova
                ? `${t("A Meta não recebeu o evento:")} ${respostaNova.motivoLegivel ?? t("confira a tela de Conversões.")}`
                : !esgotou
                  ? t("Card movido. Aguardando o envio à Meta…")
                  : t("Card movido, mas o envio ainda não respondeu. Confira a tela de Conversões.")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function hojeEmSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
}

function chaveDosAgendados(conversationId: string) {
  return ["mensagens-agendadas", conversationId];
}

function AgendarMensagem({
  conversationId,
  provider,
  lastInboundAt,
  onFechar,
}: {
  conversationId: string;
  provider: string | null;
  lastInboundAt: string | null;
  onFechar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [corpo, setCorpo] = useState("");
  const [dia, setDia] = useState(hojeEmSaoPaulo);
  const [hora, setHora] = useState("");
  const agendar = useMutation({
    mutationFn: () =>
      apiClient.post(`/api/v1/conversations/${conversationId}/mensagens-agendadas`, { corpo, dia, hora }),
    onSuccess: () => {
      toast.success(t("Mensagem agendada."));
      void qc.invalidateQueries({ queryKey: chaveDosAgendados(conversationId) });
      onFechar();
    },
    onError: (erro) => toast.error(mensagemDoErro(erro, t("Não foi possível agendar a mensagem."))),
  });
  const temJanela = estadoDaJanela(provider, lastInboundAt, new Date()).tipo !== "sem_restricao";

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Agendar mensagem")}</DialogTitle>
          <DialogDescription>{t("Horário de Brasília. A mensagem sai sozinha nesta conversa, em seu nome.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="agendar-corpo">{t("Mensagem")}</Label>
            <Textarea
              id="agendar-corpo"
              rows={4}
              maxLength={4096}
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="agendar-dia">{t("Dia")}</Label>
              <Input id="agendar-dia" type="date" min={hojeEmSaoPaulo()} value={dia} onChange={(e) => setDia(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="agendar-hora">{t("Hora")}</Label>
              <Input id="agendar-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>
          {temJanela && (
            <p className="text-xs text-muted-foreground">
              {t("Neste canal, a mensagem só sai se o cliente tiver escrito nas 24 horas anteriores ao horário agendado.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button
            disabled={agendar.isPending || !corpo.trim() || !dia || !hora}
            onClick={() => agendar.mutate()}
          >
            {agendar.isPending ? t("Agendando...") : t("Agendar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogosComerciais(props: {
  acao: AcaoComercial | null;
  onFechar: () => void;
  conversationId: string;
  contactId: string | null;
  provider: string | null;
  lastInboundAt: string | null;
}) {
  const { acao, onFechar, conversationId, contactId, provider, lastInboundAt } = props;
  if (acao === "lead" && contactId) return <NovoLead contactId={contactId} onFechar={onFechar} />;
  if (acao === "evento") return <DispararEvento conversationId={conversationId} onFechar={onFechar} />;
  if (acao === "agendar") {
    return (
      <AgendarMensagem
        conversationId={conversationId}
        provider={provider}
        lastInboundAt={lastInboundAt}
        onFechar={onFechar}
      />
    );
  }
  return null;
}

interface Agendamento {
  id: string;
  corpo: string;
  enviar_em: string;
  status: "pendente" | "enviando" | "falhou";
  motivo_falha: string | null;
}

export function MensagensAgendadasDaConversa({ conversationId }: { conversationId: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const formatoDoHorario = new Intl.DateTimeFormat(tag, {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const qc = useQueryClient();
  const agendados = useQuery({
    queryKey: chaveDosAgendados(conversationId),
    refetchInterval: 30_000,
    queryFn: async () =>
      (await apiClient.get<{ data: Agendamento[] }>(
        `/api/v1/conversations/${conversationId}/mensagens-agendadas`,
      )).data,
  });
  const cancelar = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/api/v1/conversations/${conversationId}/mensagens-agendadas/${id}`),
    onError: (erro) => toast.error(mensagemDoErro(erro, t("Não foi possível cancelar."))),
    onSettled: () => qc.invalidateQueries({ queryKey: chaveDosAgendados(conversationId) }),
  });
  const itens = agendados.data ?? [];
  if (itens.length === 0) return null;

  return (
    <ul className="w-full space-y-1 text-xs" data-testid="mensagens-agendadas">
      {itens.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-2 rounded border border-border px-2 py-1">
          <span className="shrink-0 font-medium">{formatoDoHorario.format(new Date(item.enviar_em))}</span>
          <span className="min-w-0 flex-1 truncate" title={item.corpo}>
            {item.status === "falhou"
              ? `${t("Não enviada:")} ${t(item.motivo_falha ?? "motivo não registrado")}`
              : item.corpo}
          </span>
          {item.status === "pendente" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-xs"
              disabled={cancelar.isPending}
              onClick={() => cancelar.mutate(item.id)}
            >
              {t("Cancelar")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
