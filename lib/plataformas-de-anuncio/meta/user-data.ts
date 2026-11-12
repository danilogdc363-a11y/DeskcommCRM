/**
 * A montagem do `user_data` da API de Conversões da Meta — função pura.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * Até aqui os eventos do CRM saíam só com o telefone em hash, e a qualidade de
 * correspondência (EMQ) do conjunto de dados ficava em 2,5/10 — enquanto o
 * formulário, no MESMO conjunto, tirava 7,8 porque mandava clique (`fbc`),
 * navegador (`fbp`, IP, user agent), id externo, nome e local. A Meta usa cada
 * um desses campos para achar a pessoa; quanto mais campos, mais eventos casam
 * com quem viu o anúncio, e melhor o otimizador aprende.
 *
 * ─── As regras da Meta, campo a campo ───────────────────────────────────────
 *
 *  - EM HASH SHA-256 (depois de normalizar): `ph`, `em`, `fn`, `ln`, `ct`,
 *    `st`, `zp`, `country`, `external_id` (o hash é recomendado, não exigido —
 *    em hash ele não expõe o id do CRM).
 *  - EM CLARO, e hashear quebraria o match: `fbc`, `fbp`, `client_ip_address`,
 *    `client_user_agent`, `ctwa_clid`, `page_id`, `whatsapp_business_account_id`.
 *  - Normalização ANTES do hash: minúsculas, sem espaço nas pontas; nome sem
 *    pontuação; cidade sem espaço nem pontuação; estado em sigla de 2 letras;
 *    país em ISO-3166 alfa-2 minúsculo; telefone só dígitos com DDI.
 *  - Valores em LISTA nos campos em hash: string crua onde ele espera lista é
 *    aceita com aviso e ignorada no match.
 *
 * Campo ausente não sai — nunca um hash de string vazia, que casaria todo mundo
 * que também não tem o campo.
 */
import { createHash } from "node:crypto";

/** O que o CRM sabe da pessoa, EM CLARO. O hash é responsabilidade daqui. */
export interface IdentidadeParaMeta {
  /**
   * Sai em hash como `external_id`. É o telefone em dígitos com DDI, igual ao
   * que o formulário do OS manda (o id do contato só quando não há telefone).
   */
  externalId?: string | null;
  email?: string | null;
  /** O nome como está no contato — o primeiro e o último nome saem dele. */
  nome?: string | null;
  cidade?: string | null;
  /** Sigla (`SP`) ou nome por extenso (`São Paulo`). */
  estado?: string | null;
  cep?: string | null;
  /** ISO-3166 alfa-2. Sem ele, o DDI do telefone decide (55 → `br`). */
  pais?: string | null;
  /** `fb.1.<ms>.<fbclid>` — já montado (`fbcDoClique`). */
  fbc?: string | null;
  fbp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface EntradaDoUserData {
  /** E.164 sem `+`, em claro. */
  telefone: string | null;
  identidade?: IdentidadeParaMeta;
  /** Clique-para-WhatsApp: `ctwa_clid` + página/WABA. */
  clique?: {
    ctwaClid: string;
    pageId?: string | null;
    whatsappBusinessAccountId?: string | null;
  };
}

export function sha256(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Minúsculas, sem pontas. A base de toda normalização da Meta. */
const basico = (v: string) => v.trim().toLowerCase();

export function normalizarEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const e = basico(v);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** Só letras (com acento) — nome com dígito ou emoji vira o que sobrar. */
function limparParteDoNome(v: string): string {
  return basico(v).replace(/[^\p{L}]/gu, "");
}

/**
 * Primeiro e último nome. Um nome só (o apelido do WhatsApp, muitas vezes)
 * vira só `fn`: inventar o sobrenome não existe, e mandar o mesmo valor nos
 * dois campos ensinaria um sobrenome errado.
 */
export function partesDoNome(v: string | null | undefined): {
  fn: string | null;
  ln: string | null;
} {
  if (!v) return { fn: null, ln: null };
  const partes = v
    .split(/\s+/)
    .map(limparParteDoNome)
    .filter((p) => p.length >= 2);
  if (partes.length === 0) return { fn: null, ln: null };
  return {
    fn: partes[0] ?? null,
    ln: partes.length > 1 ? (partes[partes.length - 1] ?? null) : null,
  };
}

/** `São José dos Campos` → `saojosedoscampos` (a Meta pede sem espaço). */
export function normalizarCidade(v: string | null | undefined): string | null {
  if (!v) return null;
  const c = semAcento(basico(v)).replace(/[^a-z]/g, "");
  return c.length >= 2 ? c : null;
}

/** Os 27 estados. O nome chega por extenso (e em inglês em `Federal District`). */
const UF_POR_NOME: Record<string, string> = {
  acre: "ac",
  alagoas: "al",
  amapa: "ap",
  amazonas: "am",
  bahia: "ba",
  ceara: "ce",
  distritofederal: "df",
  federaldistrict: "df",
  espiritosanto: "es",
  goias: "go",
  maranhao: "ma",
  matogrosso: "mt",
  matogrossodosul: "ms",
  minasgerais: "mg",
  para: "pa",
  paraiba: "pb",
  parana: "pr",
  pernambuco: "pe",
  piaui: "pi",
  riodejaneiro: "rj",
  riograndedonorte: "rn",
  riograndedosul: "rs",
  rondonia: "ro",
  roraima: "rr",
  santacatarina: "sc",
  saopaulo: "sp",
  sergipe: "se",
  tocantins: "to",
};
const UFS = new Set(Object.values(UF_POR_NOME));

export function normalizarEstado(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = semAcento(basico(v)).replace(/[^a-z]/g, "");
  if (UFS.has(s)) return s;
  return UF_POR_NOME[s] ?? null;
}

export function normalizarCep(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

export function normalizarPais(
  pais: string | null | undefined,
  telefone: string | null,
): string | null {
  const p = pais ? basico(pais) : "";
  if (/^[a-z]{2}$/.test(p)) return p;
  return telefone?.startsWith("55") && telefone.length >= 12 ? "br" : null;
}

/** Mesma forma que o pixel grava no cookie `_fbc`. */
const RE_FBC = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]+$/;
const RE_FBP = /^fb\.\d\.\d{10,13}\.\d+$/;

/**
 * Monta o `fbc` a partir do `fbclid` e de QUANDO o clique foi visto.
 *
 * O instante é o do clique (a captura do link), em milissegundos — a Meta usa
 * o timestamp para validar a janela de atribuição, e carimbar a hora do envio
 * deslocaria o clique para depois da conversão.
 */
export function fbcDoClique(
  fbclid: string | null | undefined,
  vistoEm: string | Date | null | undefined,
): string | null {
  const id = fbclid?.trim();
  if (!id || !/^[A-Za-z0-9_-]{10,500}$/.test(id) || !vistoEm) return null;
  const ms = new Date(vistoEm).getTime();
  if (!Number.isFinite(ms)) return null;
  return `fb.1.${ms}.${id}`;
}

export function fbcValido(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s && RE_FBC.test(s) ? s : null;
}
export function fbpValido(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s && RE_FBP.test(s) ? s : null;
}

/** IPv4 ou IPv6 com aparência de endereço. Lixo não sai. */
export function ipValido(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split(".").every((o) => Number(o) <= 255)) return s;
  if (/^[0-9a-fA-F:]{2,45}$/.test(s) && s.includes(":")) return s.toLowerCase();
  return null;
}

export function userAgentValido(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s && s.length >= 10 ? s.slice(0, 500) : null;
}

export function montarUserData(entrada: EntradaDoUserData): Record<string, unknown> {
  const { telefone, identidade: i = {}, clique } = entrada;
  const ud: Record<string, unknown> = {};
  const emHash = (campo: string, valor: string | null) => {
    if (valor) ud[campo] = [sha256(valor)];
  };

  if (clique?.ctwaClid) {
    ud.ctwa_clid = clique.ctwaClid;
    // UM dos dois (#2098): a página é a identidade do clique; a WABA só na falta.
    if (clique.pageId) ud.page_id = clique.pageId;
    else if (clique.whatsappBusinessAccountId)
      ud.whatsapp_business_account_id = clique.whatsappBusinessAccountId;
  }

  const ph = telefone?.replace(/\D/g, "") || null;
  emHash("ph", ph);
  emHash("em", normalizarEmail(i.email));
  const { fn, ln } = partesDoNome(i.nome);
  emHash("fn", fn);
  emHash("ln", ln);
  emHash("ct", normalizarCidade(i.cidade));
  emHash("st", normalizarEstado(i.estado));
  emHash("zp", normalizarCep(i.cep));
  emHash("country", normalizarPais(i.pais, ph));
  emHash("external_id", i.externalId?.trim() || null);

  const fbc = fbcValido(i.fbc);
  const fbp = fbpValido(i.fbp);
  const ip = ipValido(i.ip);
  const ua = userAgentValido(i.userAgent);
  if (fbc) ud.fbc = fbc;
  if (fbp) ud.fbp = fbp;
  if (ip) ud.client_ip_address = ip;
  if (ua) ud.client_user_agent = ua;
  return ud;
}
