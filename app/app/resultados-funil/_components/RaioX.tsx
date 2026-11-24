"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { ResultadoDoFunil } from "@/hooks/reports/useFunilMeta";

type Dados = ResultadoDoFunil["raioX"];

const MOTIVO_SEM_INVESTIMENTO: Record<string, string> = {
  sem_conexao: "A conta de anúncios não está conectada em Meta Ads.",
  cifra_indisponivel: "A instalação não consegue abrir o token de Meta Ads.",
  sem_conta_padrao: "Escolha a conta de anúncios padrão em Meta Ads.",
  recusado_pelo_meta: "O Meta recusou a leitura do investimento.",
};

function reais(cents: number | null, casas = 0): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Numero({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {rotulo}
      </span>
      <span
        className={
          destaque
            ? "text-3xl font-semibold text-accent tabular-nums"
            : "text-2xl font-semibold tabular-nums"
        }
      >
        {valor}
      </span>
      {detalhe && <span className="text-xs text-muted-foreground">{detalhe}</span>}
    </div>
  );
}

export function RaioX({ dados }: { dados: Dados }) {
  const t = useT();
  const semInvestimento = !dados.investimento.ok;
  const tetoFechado = Math.max(1, ...dados.fechados.map((f) => f.valorCents));
  const tetoCpl = Math.max(1, ...dados.semanas.map((s) => s.custoPorLeadCents ?? 0));
  const topo = dados.funil[0]?.quantidade ?? 0;

  return (
    <Card data-testid="raio-x">
      <CardHeader>
        <CardTitle>{t("Raio-X do período")}</CardTitle>
        {!dados.investimento.ok && (
          <p className="text-sm text-muted-foreground">
            {t(MOTIVO_SEM_INVESTIMENTO[dados.investimento.motivo] ?? "Investimento indisponível.")}{" "}
            {t("Sem investimento, retorno, custo por lead, CAC e payback ficam em branco.")}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Numero
            destaque
            rotulo={t("Receita fechada")}
            valor={reais(dados.receitaCents)}
            detalhe={`${dados.clientes} ${t("novos clientes")} · ${t("ticket médio de")} ${reais(dados.ticketMedioCents)}`}
          />
          <Numero
            rotulo={t("Retorno sobre o investido")}
            valor={dados.retorno === null ? "—" : `${dados.retorno.toFixed(2).replace(".", ",")}x`}
            detalhe={t("Receita fechada ÷ investido em anúncios")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero
            rotulo={t("Investido")}
            valor={reais(dados.investidoCents)}
            detalhe={t("Meta Ads, sem imposto")}
          />
          <Numero
            rotulo={t("Leads gerados")}
            valor={String(dados.leads)}
            detalhe={
              semInvestimento ? undefined : `${reais(dados.custoPorLeadCents, 2)} ${t("por lead")}`
            }
          />
          <Numero
            rotulo="CAC"
            valor={reais(dados.cacCents)}
            detalhe={t("Custo por cliente fechado")}
          />
          <Numero
            rotulo="Payback"
            valor={dados.paybackDias === null ? "—" : `${dados.paybackDias} ${t("dias")}`}
            detalhe={t("Considerando o valor como mensalidade")}
          />
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("O funil")}</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {dados.funil.map((e) => (
              <div
                key={e.rotulo}
                className="flex flex-col gap-1 rounded-lg border border-border p-4"
              >
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t(e.rotulo)}
                </span>
                <span className="text-2xl font-semibold tabular-nums">{e.quantidade}</span>
                <span className="text-xs text-muted-foreground">
                  {e.conversaoDaAnterior !== null && (
                    <span className="mr-2 font-medium text-accent">
                      {pct(e.conversaoDaAnterior)}
                    </span>
                  )}
                  {e.custoCents !== null && `${reais(e.custoCents, 2)} ${t("cada")}`}
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${topo ? (e.quantidade / topo) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "Leads criados no período e até onde chegaram. A receita conta quem fechou no período, mesmo tendo chegado antes.",
            )}
          </p>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {t("Fechados")}{" "}
              <span className="font-normal text-muted-foreground">({dados.fechados.length})</span>
            </h3>
            {dados.fechados.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("Nenhum negócio fechado no período.")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5" data-testid="fechados">
                {dados.fechados.map((f) => (
                  <li
                    key={f.id}
                    className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm"
                  >
                    <span className="truncate">{f.titulo}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(f.valorCents / tetoFechado) * 100}%` }}
                      />
                    </div>
                    <span className="font-medium tabular-nums">{reais(f.valorCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t("Custo por lead, semana a semana")}</h3>
            <div className="flex items-end gap-2" data-testid="cpl-semanal">
              {dados.semanas.map((s) => (
                <div key={s.de} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-medium tabular-nums">
                    {reais(s.custoPorLeadCents)}
                  </span>
                  <div
                    className="w-full rounded-sm bg-accent/70"
                    style={{
                      height: `${Math.max(2, ((s.custoPorLeadCents ?? 0) / tetoCpl) * 96)}px`,
                    }}
                    title={`${diaCurto(s.de)}–${diaCurto(s.ate)}: ${reais(s.investidoCents, 2)} · ${s.leads} leads`}
                  />
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {diaCurto(s.de)}–{diaCurto(s.ate)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
