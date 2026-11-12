/**
 * Resultados do funil: o que o CRM viu, o que mandou ao Meta e o que o Meta
 * registrou. Funções PURAS — a rota busca, aqui só se conta e compara.
 *
 * ## Dois fusos, de propósito
 *
 * O funil conta em Brasília (é o dia de quem opera). A comparação com o Meta
 * conta no fuso da CONTA do Meta (America/Los_Angeles): é nele que o
 * `/{dataset}/stats` corta o dia. Comparar em fusos diferentes inventa
 * "diferença" que não existe — foi o que aconteceu antes de se descobrir isso.
 */

export const FUSO_DO_FUNIL = "America/Sao_Paulo";
export const FUSO_DO_META = "America/Los_Angeles";

/** Teto do intervalo livre: a rota varre atividades da janela inteira. */
export const DIAS_MAXIMOS = 90;

export type Preset = "7d" | "14d" | "28d" | "semana" | "semana_passada";

export interface Janela {
  /** Início inclusivo, em UTC. */
  de: Date;
  /** Fim exclusivo, em UTC. */
  ate: Date;
  /** Primeiro e último dia (YYYY-MM-DD) no fuso do funil, inclusivos. */
  primeiroDia: string;
  ultimoDia: string;
}

// ─── Datas por fuso ─────────────────────────────────────────────────────────

/** YYYY-MM-DD do instante no fuso dado. */
export function diaNoFuso(instante: Date | string, fuso: string): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return partes; // en-CA já sai como YYYY-MM-DD
}

function partesDoDia(dia: string): [number, number, number] {
  const [a = 0, m = 1, d = 1] = dia.split("-").map(Number);
  return [a, m, d];
}

/** Deslocamento do fuso em minutos no instante (ex.: Brasília = -180). */
function deslocamentoMin(instante: Date, fuso: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((comoUtc - instante.getTime()) / 60_000);
}

/** Meia-noite do dia (YYYY-MM-DD) no fuso, como instante UTC. */
export function inicioDoDia(dia: string, fuso: string): Date {
  const [a, m, d] = partesDoDia(dia);
  const palpite = new Date(Date.UTC(a, m - 1, d));
  const off = deslocamentoMin(palpite, fuso);
  const corrigido = new Date(palpite.getTime() - off * 60_000);
  // Segunda passada cobre a virada de horário de verão entre palpite e real.
  const off2 = deslocamentoMin(corrigido, fuso);
  return off2 === off ? corrigido : new Date(palpite.getTime() - off2 * 60_000);
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = partesDoDia(dia);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Lista de dias de `de` a `ate`, inclusivos. */
export function diasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) out.push(d);
  return out;
}

function diaDaSemanaIso(dia: string): number {
  const [a, m, d] = partesDoDia(dia);
  const w = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w; // segunda = 1 … domingo = 7
}

function janelaDeDias(primeiroDia: string, ultimoDia: string, fuso: string): Janela {
  return {
    de: inicioDoDia(primeiroDia, fuso),
    ate: inicioDoDia(somarDias(ultimoDia, 1), fuso),
    primeiroDia,
    ultimoDia,
  };
}

/**
 * Janela de um preset. "Últimos N dias" inclui hoje. Semana começa na segunda
 * (a semana de quem trabalha), "esta semana" vai até hoje.
 */
export function janelaDoPreset(preset: Preset, agora: Date, fuso = FUSO_DO_FUNIL): Janela {
  const hoje = diaNoFuso(agora, fuso);
  switch (preset) {
    case "7d":
    case "14d":
    case "28d": {
      const n = Number(preset.replace("d", ""));
      return janelaDeDias(somarDias(hoje, -(n - 1)), hoje, fuso);
    }
    case "semana": {
      const segunda = somarDias(hoje, -(diaDaSemanaIso(hoje) - 1));
      return janelaDeDias(segunda, hoje, fuso);
    }
    case "semana_passada": {
      const segunda = somarDias(hoje, -(diaDaSemanaIso(hoje) - 1) - 7);
      return janelaDeDias(segunda, somarDias(segunda, 6), fuso);
    }
  }
}

/** Intervalo livre; `null` se inválido ou maior que o teto. */
export function janelaLivre(de: string, ate: string, fuso = FUSO_DO_FUNIL): Janela | null {
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  if (!formato.test(de) || !formato.test(ate) || de > ate) return null;
  if (diasEntre(de, ate).length > DIAS_MAXIMOS) return null;
  return janelaDeDias(de, ate, fuso);
}

// ─── Funil ──────────────────────────────────────────────────────────────────

export interface Etapa {
  id: string;
  nome: string;
  posicao: number;
  ganha: boolean;
  /** Evento do Meta configurado na regra; na etapa ganha, Purchase por padrão. */
  eventoMeta: string | null;
}

export interface AtividadeDeEtapa {
  tipo: "stage_changed" | "lead_created";
  performedAt: string;
  fromStageId?: string | null;
  toStageId?: string | null;
}

export interface EnvioAoMeta {
  eventName: string; // `MetaEtapa:<stage_id>` ou o evento de venda
  metaEventName: string | null;
  status: string;
  criadoEm: string;
}

export interface LinhaDoFunil {
  etapaId: string;
  nome: string;
  eventoMeta: string | null;
  abertosAgora: number;
  entradas: number;
  enviadosAoMeta: number;
  naoEnviados: number;
}

/** A etapa de um envio: `MetaEtapa:<id>` aponta a etapa; o resto é venda. */
export function etapaDoEnvio(eventName: string, etapas: Etapa[]): string | null {
  const prefixo = "MetaEtapa:";
  if (eventName.startsWith(prefixo)) return eventName.slice(prefixo.length);
  return etapas.find((e) => e.ganha)?.id ?? null;
}

export function montarFunil(input: {
  etapas: Etapa[];
  abertosPorEtapa: Record<string, number>;
  atividades: AtividadeDeEtapa[];
  envios: EnvioAoMeta[];
}): LinhaDoFunil[] {
  const ordenadas = [...input.etapas].sort((a, b) => a.posicao - b.posicao);
  const primeira = ordenadas[0]?.id;
  const entradas = new Map<string, number>();
  const somar = (m: Map<string, number>, k: string | null | undefined) => {
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  };

  for (const a of input.atividades) {
    if (a.tipo === "lead_created") somar(entradas, primeira);
    else if (a.toStageId && a.toStageId !== a.fromStageId) somar(entradas, a.toStageId);
  }

  const enviados = new Map<string, number>();
  const falhos = new Map<string, number>();
  for (const e of input.envios) {
    const etapa = etapaDoEnvio(e.eventName, ordenadas);
    somar(e.status === "sent" ? enviados : falhos, etapa);
  }

  return ordenadas.map((e) => ({
    etapaId: e.id,
    nome: e.nome,
    eventoMeta: e.eventoMeta,
    abertosAgora: input.abertosPorEtapa[e.id] ?? 0,
    entradas: entradas.get(e.id) ?? 0,
    enviadosAoMeta: enviados.get(e.id) ?? 0,
    naoEnviados: falhos.get(e.id) ?? 0,
  }));
}

// ─── Comparação CRM × Meta ──────────────────────────────────────────────────

export type Situacao = "bate" | "diferenca" | "nao_chegou" | "so_no_meta";

export interface ContagemDoMeta {
  dia: string; // fuso da conta do Meta
  evento: string;
  quantidade: number;
}

export interface LinhaDeComparacao {
  dia: string;
  evento: string;
  etapa: string | null;
  crmEnviou: number;
  metaRecebeu: number;
  situacao: Situacao;
}

export function situacaoDe(crmEnviou: number, metaRecebeu: number): Situacao {
  if (crmEnviou === metaRecebeu) return "bate";
  if (crmEnviou > 0 && metaRecebeu === 0) return "nao_chegou";
  if (crmEnviou === 0 && metaRecebeu > 0) return "so_no_meta";
  return "diferenca";
}

/**
 * Cruza, por dia (fuso do Meta) e evento, o que o CRM enviou com sucesso e o
 * que o Meta contou. Só entram eventos que o CRM manda (os das etapas) — o
 * conjunto pode ter outros (do site, por exemplo) que não são desta conta.
 */
export function compararComMeta(input: {
  envios: EnvioAoMeta[];
  meta: ContagemDoMeta[];
  etapas: Etapa[];
  dias: string[];
}): LinhaDeComparacao[] {
  const eventoDaEtapa = new Map<string, string>(); // evento → nome da etapa
  for (const e of input.etapas) if (e.eventoMeta) eventoDaEtapa.set(e.eventoMeta, e.nome);

  const chave = (dia: string, ev: string) => `${dia}|${ev}`;
  const crm = new Map<string, number>();
  const eventos = new Set<string>(eventoDaEtapa.keys());

  for (const e of input.envios) {
    if (e.status !== "sent") continue;
    const ev = e.metaEventName ?? eventoDoEnvio(e.eventName, input.etapas);
    if (!ev) continue;
    eventos.add(ev);
    const k = chave(diaNoFuso(e.criadoEm, FUSO_DO_META), ev);
    crm.set(k, (crm.get(k) ?? 0) + 1);
  }

  const meta = new Map<string, number>();
  for (const m of input.meta) {
    if (!eventos.has(m.evento)) continue;
    const k = chave(m.dia, m.evento);
    meta.set(k, (meta.get(k) ?? 0) + m.quantidade);
  }

  const linhas: LinhaDeComparacao[] = [];
  for (const dia of [...input.dias].sort().reverse()) {
    for (const ev of eventos) {
      const c = crm.get(chave(dia, ev)) ?? 0;
      const m = meta.get(chave(dia, ev)) ?? 0;
      if (c === 0 && m === 0) continue;
      linhas.push({
        dia,
        evento: ev,
        etapa: eventoDaEtapa.get(ev) ?? null,
        crmEnviou: c,
        metaRecebeu: m,
        situacao: situacaoDe(c, m),
      });
    }
  }
  return linhas;
}

function eventoDoEnvio(eventName: string, etapas: Etapa[]): string | null {
  const id = etapaDoEnvio(eventName, etapas);
  return etapas.find((e) => e.id === id)?.eventoMeta ?? null;
}

/**
 * Resposta do `/{dataset}/stats?aggregation=event`:
 * `{ data: [{ start_time, data: [{ value, count }] }] }`, um balde por hora ou
 * dia. `start_time` vem em UTC; o dia é o do fuso da conta.
 */
export interface RespostaDeStats {
  data?: Array<{ start_time?: string; timestamp?: string; data?: Array<{ value: string; count: number }> }>;
}

export function lerStatsDoMeta(resposta: RespostaDeStats, fuso = FUSO_DO_META): ContagemDoMeta[] {
  const soma = new Map<string, ContagemDoMeta>();
  for (const balde of resposta.data ?? []) {
    const inicio = balde.start_time ?? balde.timestamp;
    if (!inicio) continue;
    const dia = diaNoFuso(inicio, fuso);
    for (const item of balde.data ?? []) {
      const k = `${dia}|${item.value}`;
      const atual = soma.get(k) ?? { dia, evento: item.value, quantidade: 0 };
      atual.quantidade += Number(item.count) || 0;
      soma.set(k, atual);
    }
  }
  return [...soma.values()];
}

// ─── Cliques CTWA ───────────────────────────────────────────────────────────

export interface CliqueCtwa {
  capturadoEm: string;
  status: string;
}

export function resumirCliques(cliques: CliqueCtwa[], dias: string[]) {
  const porDia = new Map(dias.map((d) => [d, { dia: d, cliques: 0, leadSubmitted: 0 }]));
  for (const c of cliques) {
    const linha = porDia.get(diaNoFuso(c.capturadoEm, FUSO_DO_FUNIL));
    if (!linha) continue;
    linha.cliques += 1;
    if (c.status === "sent") linha.leadSubmitted += 1;
  }
  const serie = [...porDia.values()];
  return {
    total: serie.reduce((s, l) => s + l.cliques, 0),
    leadSubmitted: serie.reduce((s, l) => s + l.leadSubmitted, 0),
    porDia: serie,
  };
}
