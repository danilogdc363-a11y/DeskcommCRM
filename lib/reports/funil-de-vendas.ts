/**
 * Acelera (fork): Análise › Funil de vendas.
 *
 * Funções PURAS — a rota busca no banco e no Meta, aqui só se conta.
 *
 * Quatro degraus no funil padrão da organização:
 *   1. Leads novos   — `crm_leads.created_at` no período.
 *   2. Responderam   — o contato do lead mandou ao menos uma mensagem (inbound).
 *   3. Reunião       — passou pela etapa "Reunião marcada" (está nela, ou há
 *                      `stage_changed` para ela).
 *   4. Fecharam      — etapa ganha (`is_won`).
 *
 * Dois jeitos de olhar o mesmo período (`modo`):
 *   - "coorte": só os leads CRIADOS no período, e onde estão hoje. Responde
 *     "dos leads que chegaram em novembro, quantos viraram venda?".
 *   - "movimento": quem ENTROU em cada degrau dentro do período, não importa
 *     quando foi criado. Responde "quantas reuniões marcamos em novembro?".
 *     Aqui "respondeu" = a PRIMEIRA mensagem do contato caiu no período, e
 *     reunião/fechou = houve mudança para a etapa no período.
 *
 * Os dias são cortados em Brasília.
 */

export const FUSO = "America/Sao_Paulo";
export const DIAS_MAXIMOS = 120;

export type Preset = "este_mes" | "mes_passado" | "7d" | "14d" | "28d";
export type Modo = "coorte" | "movimento";

export interface Janela {
  /** Início inclusivo (UTC). */
  de: Date;
  /** Fim exclusivo (UTC). */
  ate: Date;
  /** Primeiro e último dia (AAAA-MM-DD, Brasília), inclusivos. */
  primeiroDia: string;
  ultimoDia: string;
}

// ─── Datas ──────────────────────────────────────────────────────────────────

export function diaNoFuso(instante: Date, fuso = FUSO): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

function partes(dia: string): [number, number, number] {
  const [a = 0, m = 1, d = 1] = dia.split("-").map(Number);
  return [a, m, d];
}

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

/** Meia-noite do dia no fuso, como instante UTC. */
export function inicioDoDia(dia: string, fuso = FUSO): Date {
  const [a, m, d] = partes(dia);
  const palpite = new Date(Date.UTC(a, m - 1, d));
  const off = deslocamentoMin(palpite, fuso);
  const corrigido = new Date(palpite.getTime() - off * 60_000);
  const off2 = deslocamentoMin(corrigido, fuso);
  return off2 === off ? corrigido : new Date(palpite.getTime() - off2 * 60_000);
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = partes(dia);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function contarDias(de: string, ate: string): number {
  const [a1, m1, d1] = partes(de);
  const [a2, m2, d2] = partes(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000) + 1;
}

function janelaDeDias(primeiroDia: string, ultimoDia: string): Janela {
  return {
    de: inicioDoDia(primeiroDia),
    ate: inicioDoDia(somarDias(ultimoDia, 1)),
    primeiroDia,
    ultimoDia,
  };
}

/** "Últimos N dias" inclui hoje; "este mês" vai do dia 1 até hoje. */
export function janelaDoPreset(preset: Preset, agora: Date): Janela {
  const hoje = diaNoFuso(agora);
  const [a, m] = partes(hoje);
  switch (preset) {
    case "este_mes":
      return janelaDeDias(`${hoje.slice(0, 8)}01`, hoje);
    case "mes_passado": {
      const primeiro = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
      const ultimo = new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10);
      return janelaDeDias(primeiro, ultimo);
    }
    default: {
      const n = Number(preset.replace("d", ""));
      return janelaDeDias(somarDias(hoje, -(n - 1)), hoje);
    }
  }
}

/** Intervalo livre; `null` se inválido ou maior que o teto. */
export function janelaLivre(de: string, ate: string): Janela | null {
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  if (!formato.test(de) || !formato.test(ate) || de > ate) return null;
  if (contarDias(de, ate) > DIAS_MAXIMOS) return null;
  return janelaDeDias(de, ate);
}

/** O período de mesmo tamanho imediatamente antes. */
export function janelaAnterior(j: Janela): Janela {
  const n = contarDias(j.primeiroDia, j.ultimoDia);
  const ultimo = somarDias(j.primeiroDia, -1);
  return janelaDeDias(somarDias(ultimo, -(n - 1)), ultimo);
}

// ─── Origem ─────────────────────────────────────────────────────────────────

const UTM_DO_META = new Set(["ig", "facebook", "fb", "instagram", "meta"]);

/**
 * Lead que veio do Meta: anúncio de clique para WhatsApp (`meta_ads`) ou
 * formulário que chegou por webhook com utm/source_name do Instagram/Facebook.
 */
export function ehDoMeta(source: string | null, metadata: Record<string, unknown> | null): boolean {
  if (source === "meta_ads") return true;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const utm = texto(metadata?.utm_source);
  const nome = texto(metadata?.source_name);
  return UTM_DO_META.has(utm) || UTM_DO_META.has(nome);
}

// ─── Funil ──────────────────────────────────────────────────────────────────

export interface LeadDoFunil {
  id: string;
  contatoId: string | null;
  criadoEm: string;
  etapaId: string;
  doMeta: boolean;
}

export interface EntradaEmEtapa {
  leadId: string;
  paraEtapaId: string;
  em: string;
}

export interface EtapasChave {
  reuniao: Set<string>;
  ganha: Set<string>;
}

export interface ContagemDoFunil {
  novos: number;
  responderam: number;
  reuniao: number;
  fecharam: number;
}

function dentro(iso: string, j: Janela): boolean {
  const t = new Date(iso).getTime();
  return t >= j.de.getTime() && t < j.ate.getTime();
}

/**
 * Conta os quatro degraus.
 *
 * `leads` traz TODOS os leads citados (criados no período e os que se
 * moveram nele); `entradas` todas as mudanças de etapa desses leads;
 * `primeiraResposta` a primeira mensagem recebida de cada contato.
 */
export function contarFunil(input: {
  modo: Modo;
  janela: Janela;
  etapas: EtapasChave;
  leads: LeadDoFunil[];
  entradas: EntradaEmEtapa[];
  primeiraResposta: Map<string, string>;
  filtro?: (l: LeadDoFunil) => boolean;
}): ContagemDoFunil {
  const { modo, janela, etapas, entradas, primeiraResposta } = input;
  const leads = input.filtro ? input.leads.filter(input.filtro) : input.leads;
  const novos = leads.filter((l) => dentro(l.criadoEm, janela));

  if (modo === "coorte") {
    const passouPor = (lead: LeadDoFunil, alvo: Set<string>) =>
      alvo.has(lead.etapaId) ||
      entradas.some((e) => e.leadId === lead.id && alvo.has(e.paraEtapaId));
    return {
      novos: novos.length,
      responderam: novos.filter((l) => l.contatoId && primeiraResposta.has(l.contatoId)).length,
      reuniao: novos.filter((l) => passouPor(l, etapas.reuniao)).length,
      fecharam: novos.filter((l) => etapas.ganha.has(l.etapaId)).length,
    };
  }

  const ids = new Set(leads.map((l) => l.id));
  const entrouNo = (alvo: Set<string>) =>
    new Set(
      entradas
        .filter((e) => ids.has(e.leadId) && alvo.has(e.paraEtapaId) && dentro(e.em, janela))
        .map((e) => e.leadId),
    ).size;
  const contatos = new Set(
    leads
      .map((l) => l.contatoId)
      .filter((c): c is string => {
        if (!c) return false;
        const primeira = primeiraResposta.get(c);
        return Boolean(primeira && dentro(primeira, janela));
      }),
  );
  return {
    novos: novos.length,
    responderam: contatos.size,
    reuniao: entrouNo(etapas.reuniao),
    fecharam: entrouNo(etapas.ganha),
  };
}

// ─── Números do painel ──────────────────────────────────────────────────────

/** Variação % de `antes` para `agora`; `null` quando não há base. */
export function variacao(agora: number, antes: number): number | null {
  if (!antes) return null;
  return ((agora - antes) / antes) * 100;
}

/** Fração de `parte` em `todo`, em %; `null` sem base. */
export function taxa(parte: number, todo: number): number | null {
  return todo ? (parte / todo) * 100 : null;
}

/** Custo por unidade; `null` quando não houve unidade ou gasto. */
export function custoPor(gasto: number | null, quantidade: number): number | null {
  if (gasto === null || !quantidade) return null;
  return gasto / quantidade;
}

/** Soma o `spend` (texto) das linhas de insight do Meta. */
export function somarGasto(linhas: Array<{ spend?: string | null }>): number {
  return linhas.reduce((s, l) => s + (Number(l.spend) || 0), 0);
}

/** Etapas-chave pelo nome ("Reunião marcada") e pela flag de ganho. */
export function acharEtapasChave(
  etapas: Array<{ id: string; name: string; is_won: boolean }>,
): EtapasChave {
  const normal = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase();
  return {
    reuniao: new Set(etapas.filter((e) => normal(e.name) === "reuniao marcada").map((e) => e.id)),
    ganha: new Set(etapas.filter((e) => e.is_won).map((e) => e.id)),
  };
}

/** Lê destino de um `stage_changed` nas duas grafias de payload. */
export function destinoDaMudanca(payload: Record<string, unknown> | null | undefined): string | null {
  const v = payload?.to_stage_id ?? payload?.para;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Leads que o PRÓPRIO Meta contou (formulário instantâneo e afins). Um tipo
 * por linha, para não somar o mesmo lead duas vezes: `lead` já agrupa os
 * outros quando vem; senão cai no agrupado do formulário.
 */
export function somarLeadsDoMeta(
  linhas: Array<{ actions?: Array<{ action_type?: string; value?: string }> }>,
): number {
  const ORDEM = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped"];
  return linhas.reduce((s, l) => {
    const acoes = l.actions ?? [];
    for (const tipo of ORDEM) {
      const a = acoes.find((x) => x.action_type === tipo);
      if (a) return s + (Number(a.value) || 0);
    }
    return s;
  }, 0);
}
