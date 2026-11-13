"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/hooks/i18n/useT";
import { useFunilMeta, type Periodo } from "@/hooks/reports/useFunilMeta";
import type { LinhaDoFunil, Preset, Situacao } from "@/lib/reports/funil-meta";

/** Por que o Meta não foi lido, em palavras de quem opera. */
const MOTIVO_SEM_META: Record<string, string> = {
  sem_conexao: "A API de Conversões do Meta não está conectada nesta empresa.",
  conexao_desabilitada: "A conexão com o Meta está pausada.",
  credencial_incompleta: "A conexão com o Meta está sem conjunto de dados ou token.",
  cifra_indisponivel: "A instalação não consegue abrir o token guardado.",
  leitura_indisponivel: "A leitura do Meta está indisponível nesta instalação.",
  recusado_pelo_meta: "O Meta recusou a leitura das estatísticas.",
  falha_de_rede: "Não foi possível falar com o Meta agora.",
  fora_dos_28_dias: "O Meta só guarda os últimos 28 dias; este período é mais antigo.",
};

const PRESETS: Array<{ valor: Preset; rotulo: string }> = [
  { valor: "7d", rotulo: "Últimos 7 dias" },
  { valor: "14d", rotulo: "Últimos 14 dias" },
  { valor: "28d", rotulo: "Últimos 28 dias" },
  { valor: "semana", rotulo: "Esta semana" },
  { valor: "semana_passada", rotulo: "Semana passada" },
];

const SITUACAO: Record<
  Situacao,
  { rotulo: string; variant: "success" | "warning" | "error" | "info" | "neutral" }
> = {
  bate: { rotulo: "Bate", variant: "success" },
  diferenca: { rotulo: "Diferença", variant: "warning" },
  nao_chegou: { rotulo: "Não chegou", variant: "error" },
  so_no_meta: { rotulo: "Só no Meta", variant: "info" },
  sem_dados_meta: { rotulo: "Sem dados do Meta", variant: "neutral" },
};

function diaCurto(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

function Funil({ etapas }: { etapas: LinhaDoFunil[] }) {
  const t = useT();
  const teto = Math.max(1, ...etapas.map((e) => e.entradas));
  return (
    <div className="flex flex-col gap-2" data-testid="funil">
      {etapas.map((e) => (
        <div
          key={e.etapaId}
          className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto]"
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{e.nome}</span>
              {e.eventoMeta ? (
                <span className="text-xs text-muted-foreground">
                  {t("Evento no Meta")}: <code>{e.eventoMeta}</code>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{t("Sem evento no Meta")}</span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(e.entradas / teto) * 100}%` }}
              />
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums">
            <div>
              <dt className="text-xs text-muted-foreground">{t("Abertos agora")}</dt>
              <dd className="font-semibold">{e.abertosAgora}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("Entradas")}</dt>
              <dd className="font-semibold">{e.entradas}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("Enviadas ao Meta")}</dt>
              <dd className="font-semibold">
                {e.enviadosAoMeta}
                {e.naoEnviados > 0 && (
                  <span className="ml-1 text-xs font-normal text-destructive">
                    +{e.naoEnviados} {t("com falha")}
                  </span>
                )}
                {e.pulados > 0 && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    +{e.pulados} {t("pulados")}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function ResultadosDoFunilClient() {
  const t = useT();
  const [modo, setModo] = useState<Preset | "livre">("7d");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const livreValido = modo === "livre" && de && ate && de <= ate;
  const periodo: Periodo =
    modo === "livre" ? (livreValido ? { de, ate } : { preset: "7d" }) : { preset: modo };
  const { data, isLoading, isError, error } = useFunilMeta(periodo);
  const r = data?.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={modo} onValueChange={(v) => setModo(v as Preset | "livre")}>
          <SelectTrigger className="w-48" aria-label={t("Período")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.valor} value={p.valor}>
                {t(p.rotulo)}
              </SelectItem>
            ))}
            <SelectItem value="livre">{t("Intervalo livre")}</SelectItem>
          </SelectContent>
        </Select>
        {modo === "livre" && (
          <>
            <Input
              type="date"
              className="w-40"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              aria-label={t("De")}
            />
            <Input
              type="date"
              className="w-40"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              aria-label={t("Até")}
            />
          </>
        )}
        {r && (
          <p className="text-sm text-muted-foreground">
            {diaCurto(r.janela.primeiroDia)} – {diaCurto(r.janela.ultimoDia)} · {r.funil.nome}
          </p>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>}
      {isError && (
        <p className="text-sm text-destructive">
          {t("Erro ao carregar o relatório.")} {error instanceof Error ? error.message : ""}
        </p>
      )}

      {r && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("Funil no período")}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("Entradas na etapa e envios ao Meta contados no horário de Brasília.")}
              </p>
            </CardHeader>
            <CardContent>
              <Funil etapas={r.funil.etapas} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("O que o Meta registrou")}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("Por dia no fuso da conta do Meta (Los Angeles), só eventos do servidor.")}
                {r.meta.ok && (
                  <>
                    {" "}
                    {t("Conjunto de dados")} <code>{r.meta.datasetId}</code>.
                  </>
                )}
              </p>
            </CardHeader>
            <CardContent>
              {!r.meta.ok && (
                <p className="mb-3 text-sm text-destructive">
                  {t(MOTIVO_SEM_META[r.meta.motivo] ?? "Não foi possível ler o Meta.")}
                </p>
              )}
              {r.meta.ok && r.meta.diasSemDados > 0 && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {t("Dias mais antigos que 28 dias aparecem como sem dados do Meta.")}
                </p>
              )}
              {r.meta.comparacao.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("Nenhum evento enviado ou registrado no período.")}
                </p>
              ) : (
                <Table data-testid="comparacao">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Dia")}</TableHead>
                      <TableHead>{t("Etapa")}</TableHead>
                      <TableHead>{t("CRM enviou → Meta recebeu")}</TableHead>
                      <TableHead>{t("Situação")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.meta.comparacao.map((l) => (
                      <TableRow key={`${l.dia}-${l.evento}`}>
                        <TableCell className="tabular-nums">{diaCurto(l.dia)}</TableCell>
                        <TableCell>{l.etapa ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">
                          {l.crmEnviou} → {l.metaRecebeu ?? "—"}{" "}
                          <code className="text-xs">{l.evento}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant={SITUACAO[l.situacao].variant}>
                            {t(SITUACAO[l.situacao].rotulo)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {r.cliques && (
            <Card>
              <CardHeader>
                <CardTitle>{t("Cliques de anúncio no WhatsApp")}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Conversas abertas por anúncio Click-to-WhatsApp e quantas viraram LeadSubmitted no Meta.",
                  )}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="flex gap-8 tabular-nums">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("Cliques")}</dt>
                    <dd className="text-2xl font-semibold">{r.cliques.total}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">LeadSubmitted</dt>
                    <dd className="text-2xl font-semibold">{r.cliques.leadSubmitted}</dd>
                  </div>
                </dl>
                <div className="flex items-end gap-1 overflow-x-auto pb-1">
                  {r.cliques.porDia.map((d, _i, todos) => {
                    const teto = Math.max(1, ...todos.map((x) => x.cliques));
                    return (
                      <div
                        key={d.dia}
                        className="flex min-w-[18px] flex-1 flex-col items-center gap-1"
                      >
                        <div
                          className="w-full rounded-sm bg-accent/70"
                          style={{ height: `${Math.max(2, (d.cliques / teto) * 56)}px` }}
                          title={`${diaCurto(d.dia)}: ${d.cliques} ${t("cliques")}, ${d.leadSubmitted} LeadSubmitted`}
                        />
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {diaCurto(d.dia)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
