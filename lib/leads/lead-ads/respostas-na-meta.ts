/**
 * AS RESPOSTAS DO FORMULÁRIO, BUSCADAS NA GRAPH API — a peça que faz o lead real
 * entrar (issue #3768, fatia 1-bis).
 *
 * ═══ POR QUE ESTA CHAMADA EXISTE ════════════════════════════════════════════
 *
 * O aviso de formulário preenchido que a Meta entrega no webhook traz os IDS:
 * `leadgen_id`, `page_id`, `form_id`, `ad_id`, `campaign_id` e o instante. As
 * RESPOSTAS — nome, telefone, e-mail e as demais perguntas — não vêm nele. Quem
 * só lê o corpo do aviso recebe um envelope vazio e um lead que não existe. É
 * esta chamada, autenticada com o token da PÁGINA, que devolve o `field_data` do
 * lead — a mesma forma `{ name, values }` que o aviso às vezes traz embutida.
 *
 * ═══ O QUE ESTA PEÇA NÃO FAZ ════════════════════════════════════════════════
 *
 * **Não inventa dado.** Quando a plataforma não responde — tempo esgotado, erro
 * HTTP, corpo ilegível, `field_data` vazio —, a resposta é uma FALHA NOMEADA, e
 * não um lead com nome de telefone e campos em branco. Um card em branco é pior
 * que um lead ausente: ele ocupa a coluna, alguém liga para um número que talvez
 * nem exista, e a tela mostra "criado" para um dado que ninguém tem. Quem decide
 * o que fazer com a falha é a rota, que a registra por nome.
 *
 * **Não decide se pode chamar.** Ligar a busca é opção da fonte, desligada por
 * padrão (migration 9320, critério da doc 235); quem lê a opção e o token
 * cifrado é a rota. Aqui chega o token já em claro, e só depois de a fonte ter
 * dito que sim.
 *
 * ═══ POR QUE O TOKEN VAI NO CABEÇALHO, E NÃO NA QUERY ═══════════════════════
 *
 * `access_token` na URL é credencial em log de proxy, em `Referer` de erro e em
 * qualquer captura de URL — e este token lê leads de uma página inteira. No
 * cabeçalho `Authorization: Bearer`, ele não entra na URL que o log registra.
 *
 * ═══ POR QUE O TETO DE TEMPO É CURTO ════════════════════════════════════════
 *
 * Quem está do outro lado é o webhook: a plataforma espera a resposta HTTP para
 * decidir se reentrega, e um servidor nosso pendurado numa chamada de rede
 * segura a resposta até o timeout dela. Cinco segundos é folga larga para uma
 * leitura de lead (uma linha, três a vinte respostas) e curto o bastante para a
 * reentrega acontecer ainda nesta janela. Estourou, é `tempo_esgotado` — nomeado,
 * e o lead NÃO entra com dado inventado; a reentrega seguinte tenta de novo.
 */
import { chamarGraph } from "./graph";
import { traduzirErroDaMeta, type ErroEmPortugues } from "./erros-da-meta";
import { respostasDoFieldData, type LeadDoFormulario, type RespostaDoFormulario } from "./payload";

/**
 * Teto da chamada. Ver o cabeçalho: curto porque quem espera é o webhook.
 *
 * Exportado para o teste poder medi-lo sem repetir o número — e para quem lê o
 * código achar o valor sem procurar dentro do `if`.
 */
export const TEMPO_LIMITE_DA_BUSCA_MS = 5_000;

// (Acelera) Os NOMES de anúncio, conjunto e campanha vêm na MESMA leitura do
// lead. Se o token não puder ver a conta de anúncio, a Meta recusa o pedido
// inteiro: aí relê sem eles — o lead entra com os ids, nunca fica de fora.
const CAMPOS_BASE = "field_data,created_time,form_id,ad_id,adset_id,campaign_id,platform";
const CAMPOS_COM_NOMES = `${CAMPOS_BASE},ad_name,adset_name,campaign_name`;

/** O que a busca não conseguiu, cada motivo com o seu dono. */
export type MotivoDaFalhaNaBusca =
  /** A fonte não ligou a busca. Não é erro: é configuração. */
  | "busca_desligada"
  /** A fonte não tem token de página. */
  | "sem_token_da_pagina"
  /** O token está gravado e esta instalação não consegue decifrá-lo. */
  | "token_indecifravel"
  /** A plataforma não respondeu dentro do teto. */
  | "tempo_esgotado"
  /** A plataforma recusou a chamada. */
  | "recusada_pela_meta"
  /** Respondeu algo que não é JSON, ou um JSON sem `field_data`. */
  | "resposta_ilegivel"
  /** Respondeu `field_data` presente e sem nenhuma resposta útil. */
  | "sem_respostas";

/** A origem do anúncio que a leitura completa devolve (todos opcionais). */
export interface OrigemDoLead {
  adId: string | null;
  adNome: string | null;
  adsetId: string | null;
  adsetNome: string | null;
  campaignId: string | null;
  campaignNome: string | null;
  formId: string | null;
  plataforma: string | null;
  /** Segundos (epoch). */
  criadoEm: number | null;
}

export type ResultadoDaBusca =
  | { ok: true; respostas: RespostaDoFormulario[]; origem: OrigemDoLead }
  /**
   * `detalhe` é diagnóstico CURTO e sem PII: o status HTTP, o código de erro do
   * corpo. Nunca o corpo da resposta (ele carrega as respostas de alguém) e
   * nunca o token. `erro` é a frase em português para a tela.
   */
  | { ok: false; motivo: MotivoDaFalhaNaBusca; detalhe?: string; erro?: ErroEmPortugues };

export interface PedidoDaBusca {
  leadgenId: string;
  /** Token de página em claro — a rota o decifra antes de chamar. */
  token: string;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function segundos(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return Math.floor(t / 1000);
    const n = Number(v);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

/** Junta a origem lida na Graph ao lead do aviso (o que já veio no aviso vence). */
export function leadComOrigem(base: LeadDoFormulario, origem: OrigemDoLead): LeadDoFormulario {
  return {
    ...base,
    formId: base.formId ?? origem.formId,
    adId: base.adId ?? origem.adId,
    campaignId: base.campaignId ?? origem.campaignId,
    adsetId: base.adsetId ?? origem.adsetId,
    adNome: origem.adNome,
    adsetNome: origem.adsetNome,
    campaignNome: origem.campaignNome,
    plataforma: origem.plataforma,
    criadoEm: base.criadoEm ?? origem.criadoEm,
  };
}

/**
 * Lê o lead na Graph API. Nunca lança: falha de rede é desfecho nomeado.
 *
 * O `fetch` é injetável (`opcoes.fetchImpl`) porque esta é a única peça da porta
 * com rede: sem o ponto de injeção, o teste teria de dublar o `fetch` global.
 */
export async function buscarRespostasDoLead(
  pedido: PedidoDaBusca,
  opcoes: { fetchImpl?: typeof fetch; tempoLimiteMs?: number } = {},
): Promise<ResultadoDaBusca> {
  const token = pedido.token.trim();
  if (token === "") return { ok: false, motivo: "sem_token_da_pagina" };
  if (pedido.leadgenId.trim() === "") return { ok: false, motivo: "resposta_ilegivel", detalhe: "leadgen_id vazio" };

  const ler = (fields: string) =>
    chamarGraph<Record<string, unknown>>({
      caminho: encodeURIComponent(pedido.leadgenId),
      token,
      consulta: { fields },
      tempoLimiteMs: opcoes.tempoLimiteMs ?? TEMPO_LIMITE_DA_BUSCA_MS,
      fetchImpl: opcoes.fetchImpl,
    });

  let r = await ler(CAMPOS_COM_NOMES);
  if (!r.ok && r.motivo === "recusada" && (r.status === 400 || r.status === 403)) r = await ler(CAMPOS_BASE);

  if (!r.ok) {
    if (r.motivo === "rede") {
      return { ok: false, motivo: "tempo_esgotado", detalhe: `${opcoes.tempoLimiteMs ?? TEMPO_LIMITE_DA_BUSCA_MS}ms`, erro: traduzirErroDaMeta(r) };
    }
    if (r.motivo === "ilegivel") return { ok: false, motivo: "resposta_ilegivel", detalhe: "json_invalido" };
    // O status e o código são o diagnóstico que quem opera precisa; não são PII.
    const detalhe = `http_${r.status ?? "?"}${r.erro?.codigo !== null && r.erro?.codigo !== undefined ? `_codigo_${r.erro.codigo}` : ""}`;
    return { ok: false, motivo: "recusada_pela_meta", detalhe, erro: traduzirErroDaMeta(r) };
  }

  const corpo = r.dados;
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return { ok: false, motivo: "resposta_ilegivel", detalhe: "corpo_nao_objeto" };
  }
  const fieldData = corpo.field_data;
  if (!Array.isArray(fieldData)) return { ok: false, motivo: "resposta_ilegivel", detalhe: "sem_field_data" };

  const respostas = respostasDoFieldData(fieldData);
  if (respostas.length === 0) {
    return { ok: false, motivo: "sem_respostas", detalhe: `field_data_itens=${fieldData.length}` };
  }
  return {
    ok: true,
    respostas,
    origem: {
      adId: texto(corpo.ad_id),
      adNome: texto(corpo.ad_name),
      adsetId: texto(corpo.adset_id),
      adsetNome: texto(corpo.adset_name),
      campaignId: texto(corpo.campaign_id),
      campaignNome: texto(corpo.campaign_name),
      formId: texto(corpo.form_id),
      plataforma: texto(corpo.platform),
      criadoEm: segundos(corpo.created_time),
    },
  };
}
