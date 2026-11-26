"use client";

/**
 * Acelera (fork): o painel "Funil do comercial" — trapézios empilhados com o
 * número de cada etapa, a conversão entre elas e, ao lado, o investimento no
 * Meta dividido pelo número da etapa. Filtro de origem: Meta Ads, Geral ou
 * Orgânico (geral menos Meta). Fundo cinza escuro (nunca preto), laranja
 * #FF7300 no destaque.
 */
import { useState, type CSSProperties, type ReactNode } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useFunilDeVendas, type Origem, type PeriodoDoFunil } from "@/hooks/reports/useFunilDeVendas";
import {
  IDEAL,
  custoPor,
  taxa,
  variacao,
  type ContagemDoFunil,
  type Modo,
  type Preset,
} from "@/lib/reports/funil-de-vendas";

const LARANJA = "#FF7300";
const DISPLAY: CSSProperties = {
  fontFamily: 'var(--font-acelera-display), "Bebas Neue", Impact, sans-serif',
  letterSpacing: "0.02em",
};

const PRESETS: Array<{ valor: Preset; rotulo: string }> = [
  { valor: "este_mes", rotulo: "Este mês" },
  { valor: "mes_passado", rotulo: "Mês passado" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "14d", rotulo: "14 dias" },
  { valor: "28d", rotulo: "28 dias" },
];

const ORIGENS: Array<{ valor: Origem; rotulo: string }> = [
  { valor: "meta", rotulo: "Meta Ads" },
  { valor: "geral", rotulo: "Geral" },
  { valor: "organico", rotulo: "Orgânico" },
];

const MODOS: Array<{ valor: Modo; rotulo: string; ajuda: string }> = [
  {
    valor: "coorte",
    rotulo: "Leads criados nesse período",
    ajuda: "Só os leads que chegaram no período, e até onde eles foram até hoje.",
  },
  {
    valor: "movimento",
    rotulo: "Leads movidos nesse período",
    ajuda: "Quem entrou em cada etapa dentro do período, não importa quando chegou.",
  },
];

const ETAPAS: Array<{
  chave: keyof ContagemDoFunil;
  rotulo: string;
  custo: string;
  passagem: string;
  /** Conversão esperada da etapa anterior para esta, em %. */
  ideal?: number;
  fundo: string;
  texto: string;
}> = [
  { chave: "novos", rotulo: "Leads novos", custo: "por lead", passagem: "", fundo: "#3d3d3d", texto: "#f2f2f2" },
  {
    chave: "responderam",
    rotulo: "Leads qualificados",
    custo: "por lead qualificado",
    passagem: "viraram leads qualificados",
    fundo: "#8c8c8c",
    texto: "#222222",
  },
  {
    chave: "reuniao",
    rotulo: "Reunião agendada",
    custo: "por reunião agendada",
    passagem: "agendaram reunião",
    ideal: IDEAL.agendamento,
    fundo: "#a34c00",
    texto: "#ffffff",
  },
  {
    chave: "compareceram",
    rotulo: "Reunião realizada",
    custo: "por reunião realizada",
    passagem: "compareceram",
    ideal: IDEAL.comparecimento,
    fundo: "#d45f00",
    texto: "#ffffff",
  },
  {
    chave: "fecharam",
    rotulo: "Fecharam",
    custo: "por venda",
    passagem: "fecharam",
    ideal: IDEAL.venda,
    fundo: LARANJA,
    texto: "#ffffff",
  },
];

const EXPLICACAO: Record<Origem, string> = {
  meta: "Só os leads que vieram de anúncio do Meta. Ao lado de cada etapa: o investimento no Meta dividido pelo número da etapa. Lead qualificado é quem respondeu a conversa no WhatsApp.",
  geral: "Ao lado de cada etapa: todo o investimento no Meta dividido pelo número da etapa, somando leads de todas as origens. Lead qualificado é quem respondeu a conversa no WhatsApp.",
  organico: "Leads que não vieram de anúncio do Meta (geral menos Meta). Sem custo de anúncio ao lado. Lead qualificado é quem respondeu a conversa no WhatsApp.",
};

const MOTIVO_SEM_META: Record<string, string> = {
  sem_conexao: "O Meta Ads não está conectado nesta empresa (Análise › Meta Ads).",
  cifra_indisponivel: "O CRM não conseguiu abrir a conexão do Meta guardada.",
  sem_conta: "A conexão do Meta não tem uma conta de anúncio padrão escolhida.",
  falha_na_leitura: "O Meta não respondeu agora. Tente de novo em alguns minutos.",
};

const inteiro = new Intl.NumberFormat("pt-BR");
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const umaCasa = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function dataCurta(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a?.slice(2)}`;
}

function hojeEmBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function FunilDeVendasClient() {
  const t = useT();
  const [periodo, setPeriodo] = useState<PeriodoDoFunil>({ preset: "este_mes" });
  const [modo, setModo] = useState<Modo>("coorte");
  const [origem, setOrigem] = useState<Origem>("geral");
  const [livre, setLivre] = useState({ de: "", ate: hojeEmBrasilia() });
  const consulta = useFunilDeVendas(periodo, modo);
  const dados = consulta.data?.data;

  const recorte = dados?.origens[origem];
  const gasto = dados?.meta.ok && origem !== "organico" ? dados.meta.atual.gasto : null;
  const gastoAntes = dados?.meta.ok && origem !== "organico" ? dados.meta.antes.gasto : null;

  return (
    <div className="min-h-full bg-[#1f1f1f] px-4 py-8 text-[#f2f2f2] md:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl uppercase md:text-5xl" style={DISPLAY}>
            {t("Funil do")} <span style={{ color: LARANJA }}>{t("comercial")}</span>
          </h1>
          <p className="text-sm text-[#b5b5b5]">{t(EXPLICACAO[origem])}</p>
        </header>

        {/* Controles */}
        <section className="flex flex-col gap-3">
          <Grupo rotulo={t("Origem")}>
            {ORIGENS.map((o) => (
              <Pilula key={o.valor} ativa={origem === o.valor} onClick={() => setOrigem(o.valor)}>
                {t(o.rotulo)}
              </Pilula>
            ))}
          </Grupo>
          <Grupo rotulo={t("Período")}>
            {PRESETS.map((p) => (
              <Pilula
                key={p.valor}
                ativa={"preset" in periodo && periodo.preset === p.valor}
                onClick={() => setPeriodo({ preset: p.valor })}
              >
                {t(p.rotulo)}
              </Pilula>
            ))}
            <span className="flex items-center gap-1 rounded-full bg-[#2c2c2c] px-3 py-1 text-sm">
              <input
                type="date"
                aria-label={t("Início do período")}
                value={livre.de}
                onChange={(e) => setLivre((v) => ({ ...v, de: e.target.value }))}
                className="bg-transparent text-[#f2f2f2] [color-scheme:dark]"
              />
              <span className="text-[#8a8a8a]">{t("até")}</span>
              <input
                type="date"
                aria-label={t("Fim do período")}
                value={livre.ate}
                onChange={(e) => setLivre((v) => ({ ...v, ate: e.target.value }))}
                className="bg-transparent text-[#f2f2f2] [color-scheme:dark]"
              />
              <button
                type="button"
                disabled={!livre.de || !livre.ate || livre.de > livre.ate}
                onClick={() => setPeriodo({ de: livre.de, ate: livre.ate })}
                className="ml-1 rounded-full px-2 py-0.5 font-semibold disabled:opacity-40"
                style={{ backgroundColor: "preset" in periodo ? "#3d3d3d" : LARANJA }}
              >
                {t("Ver")}
              </button>
            </span>
          </Grupo>
          <Grupo rotulo={t("Contar")}>
            {MODOS.map((m) => (
              <Pilula key={m.valor} ativa={modo === m.valor} onClick={() => setModo(m.valor)} title={t(m.ajuda)}>
                {t(m.rotulo)}
              </Pilula>
            ))}
          </Grupo>
          <p className="text-xs text-[#8a8a8a]">
            {t(MODOS.find((m) => m.valor === modo)?.ajuda ?? "")}
            {dados &&
              ` ${t("Período: {de} a {ate}, comparado com {antesDe} a {antesAte}.")
                .replace("{de}", dataCurta(dados.janela.primeiroDia))
                .replace("{ate}", dataCurta(dados.janela.ultimoDia))
                .replace("{antesDe}", dataCurta(dados.anterior.primeiroDia))
                .replace("{antesAte}", dataCurta(dados.anterior.ultimoDia))}`}
          </p>
        </section>

        {consulta.isLoading && <p className="text-[#b5b5b5]">{t("Montando o funil…")}</p>}
        {consulta.isError && (
          <p className="text-[#ffb27a]">
            {t("Não deu para montar o funil agora. Atualize a página em alguns instantes.")}
          </p>
        )}

        {dados && recorte && (
          <>
            {dados.semEtapaDeReuniao && (
              <p className="text-sm text-[#ffb27a]">
                {t("O funil padrão não tem uma etapa chamada “Reunião marcada”, então a contagem de reuniões fica zerada.")}
              </p>
            )}

            {origem !== "organico" && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs uppercase tracking-[0.15em] text-[#b5b5b5]">{t("Investido no Meta")}</span>
                {dados.meta.ok ? (
                  <>
                    <span className="text-3xl" style={{ ...DISPLAY, color: LARANJA }}>
                      {reais.format(dados.meta.atual.gasto)}
                    </span>
                    <Selo agora={dados.meta.atual.gasto} antes={dados.meta.antes.gasto} />
                  </>
                ) : (
                  <span className="text-sm text-[#b5b5b5]">
                    {t(MOTIVO_SEM_META[dados.meta.motivo] ?? "Sem os números do Meta neste período.")}
                  </span>
                )}
              </div>
            )}

            <section aria-label={t("Funil")} className="flex flex-col">
              {ETAPAS.map((e, i) => {
                const anterior = i > 0 ? ETAPAS[i - 1] : undefined;
                const conv = anterior ? taxa(recorte.atual[e.chave], recorte.atual[anterior.chave]) : null;
                return (
                  <div key={e.chave} className="flex flex-col">
                    {anterior && (
                      <div className="flex w-full justify-center py-1.5 md:w-[66%]">
                        <span className="rounded-full border border-[#3d3d3d] bg-[#262626] px-3 py-0.5 text-xs text-[#b5b5b5]">
                          <strong className="text-[#f2f2f2]">{conv === null ? "—" : `${umaCasa.format(conv)}%`}</strong>{" "}
                          {t(e.passagem)}
                          {e.ideal !== undefined && <Ideal real={conv} ideal={e.ideal} />}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col items-center gap-2 md:flex-row md:gap-4">
                      <div className="flex w-full justify-center md:w-[66%]">
                        <Trapezio
                          largura={100 - i * 13}
                          fundo={e.fundo}
                          texto={e.texto}
                          numero={recorte.atual[e.chave]}
                          rotulo={t(e.rotulo)}
                          antes={recorte.antes[e.chave]}
                        />
                      </div>
                      {origem !== "organico" && (
                        <CartaoDeCusto
                          valor={custoPor(gasto, recorte.atual[e.chave])}
                          antes={custoPor(gastoAntes, recorte.antes[e.chave])}
                          legenda={t(e.custo)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            {origem === "meta" && dados.meta.ok && (
              <DiferencaDoMeta noMeta={dados.meta.atual.leadsNoMeta} noCrm={recorte.atual.novos} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Trapezio(props: {
  largura: number;
  fundo: string;
  texto: string;
  numero: number;
  rotulo: string;
  antes: number;
}) {
  const t = useT();
  return (
    <div
      className="flex h-28 flex-col items-center justify-center"
      title={t("Antes: {n}").replace("{n}", inteiro.format(props.antes))}
      style={{
        width: `${props.largura}%`,
        backgroundColor: props.fundo,
        color: props.texto,
        clipPath: "polygon(0 0, 100% 0, 88% 100%, 12% 100%)",
      }}
    >
      <span className="text-5xl leading-none md:text-6xl" style={DISPLAY}>
        {inteiro.format(props.numero)}
      </span>
      <span className="mt-1 text-sm uppercase" style={DISPLAY}>
        {props.rotulo}
      </span>
      <span className="mt-0.5 text-[11px] opacity-80">
        <Variacao agora={props.numero} antes={props.antes} />
      </span>
    </div>
  );
}

/** "ideal 20%": verde quando a conversão chegou lá, laranja quando ficou abaixo. */
function Ideal({ real, ideal }: { real: number | null; ideal: number }) {
  const t = useT();
  const bateu = real !== null && real >= ideal;
  return (
    <span
      className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={bateu ? { backgroundColor: "#1f3a2a", color: "#7ddc9f" } : { backgroundColor: "#3a2616", color: "#ffb27a" }}
      title={t(bateu ? "Acima do ideal" : "Abaixo do ideal")}
    >
      {t("ideal {n}%").replace("{n}", String(ideal))}
    </span>
  );
}

function CartaoDeCusto({ valor, antes, legenda }: { valor: number | null; antes: number | null; legenda: string }) {
  const t = useT();
  return (
    <div
      className="w-full rounded-xl border border-[#3d3d3d] bg-[#2a2a2a] px-4 py-3 md:w-[34%]"
      style={{ borderLeft: `4px solid ${LARANJA}` }}
      title={antes === null ? undefined : t("Antes: {n}").replace("{n}", reais.format(antes))}
    >
      <div className="text-2xl leading-none" style={{ ...DISPLAY, color: LARANJA }}>
        {valor === null ? "—" : reais.format(valor)}
      </div>
      <div className="mt-1 text-xs text-[#b5b5b5]">{legenda}</div>
    </div>
  );
}

function Variacao({ agora, antes }: { agora: number; antes: number }) {
  const t = useT();
  const v = variacao(agora, antes);
  if (v === null) return <>{t("sem base no período anterior")}</>;
  return <>{t("{seta} {n}% vs. período anterior").replace("{seta}", v < 0 ? "▼" : "▲").replace("{n}", umaCasa.format(Math.abs(v)))}</>;
}

function Selo({ agora, antes }: { agora: number; antes: number }) {
  return (
    <span className="rounded-full bg-[#2e2e2e] px-3 py-0.5 text-xs font-semibold text-[#e6e6e6]">
      <Variacao agora={agora} antes={antes} />
    </span>
  );
}

function DiferencaDoMeta({ noMeta, noCrm }: { noMeta: number; noCrm: number }) {
  const t = useT();
  if (noMeta === 0 && noCrm === 0) return null;
  const faltam = noMeta - noCrm;
  return (
    <div className="rounded-xl border border-[#4a3020] bg-[#2a2420] p-4 text-sm text-[#e6e6e6]">
      {t("O Meta contou {meta} leads de formulário e anúncio no período; chegaram ao CRM marcados como Meta {crm}.")
        .replace("{meta}", inteiro.format(noMeta))
        .replace("{crm}", inteiro.format(noCrm))}
      {faltam > 0 &&
        ` ${t("Faltam {n}: vale conferir se o formulário está entregando todos os contatos ao CRM e se a origem está sendo marcada.").replace("{n}", inteiro.format(faltam))}`}
    </div>
  );
}

function Grupo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-xs uppercase tracking-[0.12em] text-[#8a8a8a]">{rotulo}</span>
      {children}
    </div>
  );
}

function Pilula(props: { ativa: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-pressed={props.ativa}
      className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
      style={props.ativa ? { backgroundColor: LARANJA, color: "#ffffff" } : { backgroundColor: "#2c2c2c", color: "#d6d6d6" }}
    >
      {props.children}
    </button>
  );
}
