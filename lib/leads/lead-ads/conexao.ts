/**
 * (Acelera) Ligar e desligar as Páginas de formulário de anúncio de UMA empresa.
 *
 * Quem chama (as rotas de `/api/v1/meta-ads/formularios/*`) já provou que a
 * pessoa é administradora da empresa; o `organizationId` vem da sessão, nunca
 * do corpo. Este módulo usa o admin client, então TODA consulta repete o
 * `organization_id` (service role ignora a RLS).
 *
 * O token da Página é lido da Meta AQUI, no servidor, com o token do login da
 * empresa — nunca passa pelo navegador — e é gravado cifrado na fonte de
 * captação da Página.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { appDeLoginDaMeta } from "@/lib/plataformas-de-anuncio/meta/login/app";
import { ESCOPO_DE_FORMULARIOS } from "@/lib/plataformas-de-anuncio/meta/login/oauth";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { traduzirErroDaMeta, type ErroEmPortugues } from "./erros-da-meta";
import { listarTudo } from "./graph";
import {
  desinscreverPagina,
  garantirInscricaoDoApp,
  inscreverPagina,
  listarPaginasDoUsuario,
  paginaEstaInscrita,
  permissoesConcedidas,
} from "./paginas";
import { COLUNAS_DA_FONTE_DA_PAGINA, fonteDaPagina, leadSoComIds, receberLead, type FonteDaPagina } from "./receber";

const PREFIXO_DO_NOME = "Formulário da Meta — ";

export type Recusa = { ok: false; status: number; codigo: string; mensagem: string };
const recusa = (status: number, codigo: string, mensagem: string): Recusa => ({ ok: false, status, codigo, mensagem });
const daMeta = (e: ErroEmPortugues): Recusa => recusa(e.codigo === "limite_da_meta" ? 429 : 422, e.codigo, e.mensagem);

const SEM_LOGIN =
  "A empresa ainda não entrou com o Facebook para os formulários. Clique em “Conectar formulários” e tente de novo.";

export interface PaginaDaTela {
  id: string;
  nome: string;
  conectada: boolean;
  ativa: boolean;
  funilId: string | null;
  etapaId: string | null;
  ultimoRecebimento: string | null;
}

export interface ListaDePaginas {
  /** O login foi feito e a Meta devolveu as Páginas. */
  loginFeito: boolean;
  /** Permissões de formulário que a Meta NÃO concedeu no login. */
  permissoesFaltando: string[];
  paginas: PaginaDaTela[];
  /** Frase pronta para a tela quando a Meta recusou ou o login não foi feito. */
  aviso: string | null;
}

type FonteComRecebimento = FonteDaPagina & { ultimoRecebimento: string | null };

async function fontesDaEmpresa(admin: SupabaseClient, organizationId: string): Promise<FonteComRecebimento[]> {
  const { data, error } = await admin
    .from("webhook_sources")
    .select(`${COLUNAS_DA_FONTE_DA_PAGINA}, last_received_at`)
    .eq("organization_id", organizationId)
    .not("meta_page_id", "is", null);
  if (error) {
    logger.error("[lead-ads.conexao] fontes da empresa não puderam ser lidas", { organizationId, erro: error.message });
    return [];
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((l) => ({
    ...fonteDaPagina(l),
    ultimoRecebimento: (l.last_received_at as string | null) ?? null,
  }));
}

function nomeDaPagina(nomeDaFonte: string, pageId: string): string {
  return nomeDaFonte.startsWith(PREFIXO_DO_NOME) ? nomeDaFonte.slice(PREFIXO_DO_NOME.length) : `Página ${pageId}`;
}

export async function listarPaginasDaEmpresa(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ListaDePaginas> {
  const locais = await fontesDaEmpresa(admin, organizationId);
  const dasFontes = new Map(locais.filter((f) => f.pageId).map((f) => [f.pageId as string, f]));
  const daFonte = (id: string, nome: string): PaginaDaTela => {
    const f = dasFontes.get(id);
    return {
      id,
      nome,
      conectada: Boolean(f),
      ativa: f?.ativa ?? false,
      funilId: f?.funilId ?? null,
      etapaId: f?.etapaId ?? null,
      ultimoRecebimento: f?.ultimoRecebimento ?? null,
    };
  };
  const soLocais = () => locais.filter((f) => f.pageId).map((f) => daFonte(f.pageId as string, nomeDaPagina(f.nome, f.pageId as string)));

  const cred = await lerCredencialDeLeitura(admin, organizationId, "meta_ads");
  if (!cred.ok) return { loginFeito: false, permissoesFaltando: [], paginas: soLocais(), aviso: SEM_LOGIN };

  const perm = await permissoesConcedidas(cred.credencial.accessToken);
  if (!perm.ok) {
    return { loginFeito: false, permissoesFaltando: [], paginas: soLocais(), aviso: traduzirErroDaMeta(perm).mensagem };
  }
  const faltando = ESCOPO_DE_FORMULARIOS.filter((p) => !perm.concedidas.includes(p));
  if (faltando.length > 0) {
    return {
      loginFeito: false,
      permissoesFaltando: [...faltando],
      paginas: soLocais(),
      aviso:
        "O Facebook ainda não concedeu as permissões de formulário. Clique em “Conectar formulários” e aceite todas. Se a tela do Facebook não pedir, é porque a Meta ainda não liberou para o seu usuário: hoje só quem tem função no app consegue.",
    };
  }

  const r = await listarPaginasDoUsuario(cred.credencial.accessToken);
  if (!r.ok) {
    return { loginFeito: true, permissoesFaltando: [], paginas: soLocais(), aviso: traduzirErroDaMeta(r).mensagem };
  }
  const daMetaIds = new Set(r.paginas.map((p) => p.id));
  const paginas = r.paginas.map((p) => daFonte(p.id, p.nome));
  // Página ligada que a pessoa de agora não enxerga (outra pessoa ligou): continua na lista.
  for (const f of locais) {
    if (f.pageId && !daMetaIds.has(f.pageId)) paginas.push(daFonte(f.pageId, nomeDaPagina(f.nome, f.pageId)));
  }
  paginas.sort((a, b) => Number(b.conectada) - Number(a.conectada) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { loginFeito: true, permissoesFaltando: [], paginas, aviso: null };
}

export interface ResultadoDeConectar {
  ok: true;
  fonteId: string;
  /** A Meta não aceitou cadastrar o endereço no app: o único passo manual. */
  avisoDoApp: string | null;
}

async function destinoDaEmpresa(
  admin: SupabaseClient,
  organizationId: string,
  funilId: string,
  etapaId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("crm_stages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", funilId)
    .eq("id", etapaId)
    .maybeSingle();
  return Boolean(data);
}

export async function conectarPagina(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    userId: string;
    pageId: string;
    funilId: string;
    etapaId: string;
    baseDoApp: string;
    requestId: string;
  },
): Promise<ResultadoDeConectar | Recusa> {
  const { organizationId, pageId } = entrada;
  if (!(await destinoDaEmpresa(admin, organizationId, entrada.funilId, entrada.etapaId))) {
    return recusa(422, "destino_invalido", "O funil ou a etapa escolhidos não existem mais nesta empresa. Escolha de novo.");
  }
  const app = appDeLoginDaMeta();
  if (!app) {
    return recusa(503, "app_nao_configurado", "O app da Meta ainda não foi configurado no servidor (faltam META_APP_ID e META_APP_SECRET). Peça a quem administra o sistema.");
  }

  // A Página já é de OUTRA empresa? Uma Página pertence a uma empresa só.
  const { data: dona } = await admin
    .from("webhook_sources")
    .select("id, organization_id")
    .eq("meta_page_id", pageId)
    .maybeSingle();
  const donaDaPagina = dona as { id: string; organization_id: string } | null;
  if (donaDaPagina && donaDaPagina.organization_id !== organizationId) {
    return recusa(409, "pagina_de_outra_empresa", "Esta Página já está ligada a outra empresa. Peça a quem a ligou para desconectá-la primeiro.");
  }

  const cred = await lerCredencialDeLeitura(admin, organizationId, "meta_ads");
  if (!cred.ok) {
    return cred.motivo === "cifra_indisponivel"
      ? recusa(503, "cifra_indisponivel", "Esta instalação está sem a chave mestra de criptografia. Quem instalou o sistema precisa configurá-la.")
      : recusa(409, "sem_login", SEM_LOGIN);
  }
  const lista = await listarPaginasDoUsuario(cred.credencial.accessToken);
  if (!lista.ok) return daMeta(traduzirErroDaMeta(lista));
  const pagina = lista.paginas.find((p) => p.id === pageId);
  if (!pagina) {
    return recusa(404, "pagina_nao_encontrada", "Esta Página não aparece na sua conta do Facebook. É preciso ser administrador da Página e ter dado as permissões no login.");
  }

  const cifrado = await encryptWebhookSecret(admin, pagina.tokenDaPagina);
  if (!cifrado) {
    return recusa(503, "cifra_indisponivel", "Esta instalação está sem a chave mestra de criptografia, e o acesso da Página não foi gravado. Quem instalou o sistema precisa configurá-la.");
  }

  // Liga a Página ao app ANTES de gravar: se a Meta recusar (acesso a leads,
  // permissão), nada fica "meio ligado" no CRM.
  const inscricao = await inscreverPagina(pageId, pagina.tokenDaPagina);
  if (!inscricao.ok) return daMeta(traduzirErroDaMeta(inscricao));

  // O endereço no app da Meta (uma vez por instalação; repetir é inofensivo).
  let avisoDoApp: string | null = null;
  const noApp = await garantirInscricaoDoApp(app, entrada.baseDoApp);
  if (!noApp.ok) {
    logger.warn("[lead-ads.conexao] a Meta não aceitou cadastrar o webhook do app", {
      organizationId,
      status: noApp.status,
      codigo: noApp.erro?.codigo ?? null,
    });
    avisoDoApp =
      "A Página foi ligada, mas o CRM não conseguiu cadastrar o endereço dos avisos no app da Meta. Avise a Acelera: é um passo único, feito no painel do app (Webhooks → Página), e vale para todas as empresas.";
  }

  const valores = {
    name: `${PREFIXO_DO_NOME}${pagina.nome}`.slice(0, 200),
    default_pipeline_id: entrada.funilId,
    default_stage_id: entrada.etapaId,
    meta_page_id: pageId,
    meta_page_token_encrypted: cifrado,
    meta_lead_retrieval: true,
    is_active: true,
  };
  let fonteId: string;
  if (donaDaPagina) {
    const { error } = await admin
      .from("webhook_sources")
      .update(valores)
      .eq("organization_id", organizationId)
      .eq("id", donaDaPagina.id);
    if (error) return await desfazerEFalhar(pagina.id, pagina.tokenDaPagina, error.message);
    fonteId = donaDaPagina.id;
  } else {
    const { data, error } = await admin
      .from("webhook_sources")
      .insert({
        ...valores,
        organization_id: organizationId,
        path_token: randomBytes(24).toString("base64url"),
        created_by_user_id: entrada.userId,
      })
      .select("id")
      .single();
    if (error || !data) {
      // 23505 = outra empresa ligou a mesma Página no mesmo instante.
      if (error?.code === "23505") {
        await desinscreverPagina(pageId, pagina.tokenDaPagina);
        return recusa(409, "pagina_de_outra_empresa", "Esta Página acabou de ser ligada a outra empresa.");
      }
      return await desfazerEFalhar(pagina.id, pagina.tokenDaPagina, error?.message ?? "insert_sem_linha");
    }
    fonteId = (data as { id: string }).id;
  }

  await audit({
    action: "meta_lead_ads.page_connected",
    actorUserId: entrada.userId,
    organizationId,
    resourceType: "webhook_source",
    resourceId: fonteId,
    requestId: entrada.requestId,
    // Nunca o token: só a Página e o destino.
    metadata: { page_id: pageId, pipeline_id: entrada.funilId, stage_id: entrada.etapaId },
  });
  return { ok: true, fonteId, avisoDoApp };

  async function desfazerEFalhar(id: string, tokenDaPagina: string, detalhe: string): Promise<Recusa> {
    logger.error("[lead-ads.conexao] a fonte da Página não foi gravada", { organizationId, detalhe });
    await desinscreverPagina(id, tokenDaPagina);
    return recusa(500, "erro_ao_gravar", "Não consegui gravar agora. Nada foi ligado. Tente de novo em instantes.");
  }
}

export async function desconectarPagina(
  admin: SupabaseClient,
  entrada: { organizationId: string; userId: string; pageId: string; requestId: string },
): Promise<{ ok: true } | Recusa> {
  const { data } = await admin
    .from("webhook_sources")
    .select(COLUNAS_DA_FONTE_DA_PAGINA)
    .eq("organization_id", entrada.organizationId)
    .eq("meta_page_id", entrada.pageId)
    .maybeSingle();
  if (!data) return recusa(404, "pagina_nao_ligada", "Esta Página não está ligada nesta empresa.");
  const fonte = fonteDaPagina(data as unknown as Record<string, unknown>);

  // Tira o app da Página na Meta (melhor esforço: se falhar, o CRM já ignora os
  // avisos porque a Página fica sem dona).
  if (fonte.tokenCifrado) {
    const token = await decryptWebhookSecret(admin, fonte.tokenCifrado);
    if (token) {
      const r = await desinscreverPagina(entrada.pageId, token);
      if (!r.ok) logger.warn("[lead-ads.conexao] não consegui desinscrever a Página", { organizationId: entrada.organizationId });
    }
  }
  // A Página fica livre (outra empresa pode ligá-la) e a fonte continua, pausada,
  // para o histórico de "Leads recebidos" não perder a origem.
  const { error } = await admin
    .from("webhook_sources")
    .update({ meta_page_id: null, meta_page_token_encrypted: null, meta_lead_retrieval: false, is_active: false })
    .eq("organization_id", entrada.organizationId)
    .eq("id", fonte.id);
  if (error) return recusa(500, "erro_ao_gravar", "Não consegui desligar agora. Tente de novo em instantes.");

  await audit({
    action: "meta_lead_ads.page_disconnected",
    actorUserId: entrada.userId,
    organizationId: entrada.organizationId,
    resourceType: "webhook_source",
    resourceId: fonte.id,
    requestId: entrada.requestId,
    metadata: { page_id: entrada.pageId },
  });
  return { ok: true };
}

export async function verificarPagina(
  admin: SupabaseClient,
  entrada: { organizationId: string; pageId: string },
): Promise<{ ok: true; mensagem: string } | Recusa> {
  const app = appDeLoginDaMeta();
  if (!app) return recusa(503, "app_nao_configurado", "O app da Meta ainda não foi configurado no servidor.");
  const { data } = await admin
    .from("webhook_sources")
    .select(COLUNAS_DA_FONTE_DA_PAGINA)
    .eq("organization_id", entrada.organizationId)
    .eq("meta_page_id", entrada.pageId)
    .maybeSingle();
  if (!data) return recusa(404, "pagina_nao_ligada", "Esta Página não está ligada nesta empresa.");
  const fonte = fonteDaPagina(data as unknown as Record<string, unknown>);
  const token = fonte.tokenCifrado ? await decryptWebhookSecret(admin, fonte.tokenCifrado) : null;
  if (!token) return recusa(422, "login_vencido", "O acesso desta Página não pôde ser lido. Desconecte e conecte a Página de novo.");
  const r = await paginaEstaInscrita(entrada.pageId, token, app.appId);
  if (!r.ok) return daMeta(traduzirErroDaMeta(r));
  if (!r.inscrita) {
    return recusa(422, "pagina_nao_inscrita", "A Página não está mais enviando avisos de formulário para o app. Desconecte e conecte de novo.");
  }
  return { ok: true, mensagem: "Tudo certo: a Meta está enviando os avisos de formulário desta Página para o CRM." };
}

export interface ResultadoDaImportacao {
  ok: true;
  encontrados: number;
  entraram: number;
  jaExistiam: number;
  ignorados: number;
  falharam: number;
  /** Parou no limite do clique: clicar de novo continua de onde parou. */
  parouNoLimite: boolean;
}

const LIMITE_DE_NOVOS_POR_CLIQUE = 150;
const LIMITE_DE_LEADS_LISTADOS = 2_000;
const EM_PARALELO = 5;

export async function importarLeadsAntigos(
  admin: SupabaseClient,
  entrada: { organizationId: string; pageId: string; dias: number; requestId: string; agora?: Date },
): Promise<ResultadoDaImportacao | Recusa> {
  const { data } = await admin
    .from("webhook_sources")
    .select(COLUNAS_DA_FONTE_DA_PAGINA)
    .eq("organization_id", entrada.organizationId)
    .eq("meta_page_id", entrada.pageId)
    .maybeSingle();
  if (!data) return recusa(404, "pagina_nao_ligada", "Esta Página não está ligada nesta empresa.");
  const fonte = fonteDaPagina(data as unknown as Record<string, unknown>);
  const token = fonte.tokenCifrado ? await decryptWebhookSecret(admin, fonte.tokenCifrado) : null;
  if (!token) return recusa(422, "login_vencido", "O acesso desta Página não pôde ser lido. Desconecte e conecte a Página de novo.");

  const desde = Math.floor(((entrada.agora ?? new Date()).getTime() - entrada.dias * 86_400_000) / 1000);
  const filtro = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]);

  const formularios = await listarTudo<{ id?: unknown }>({
    caminho: `${entrada.pageId}/leadgen_forms`,
    token,
    consulta: { fields: "id" },
  });
  if (!formularios.ok) return daMeta(traduzirErroDaMeta(formularios));

  const ids: string[] = [];
  for (const f of formularios.itens) {
    if (typeof f.id !== "string" || !/^\d+$/.test(f.id)) continue;
    const leads = await listarTudo<{ id?: unknown }>(
      { caminho: `${f.id}/leads`, token, consulta: { fields: "id", filtering: filtro } },
      LIMITE_DE_LEADS_LISTADOS,
    );
    if (!leads.ok) return daMeta(traduzirErroDaMeta(leads));
    for (const l of leads.itens) if (typeof l.id === "string" && /^\d+$/.test(l.id)) ids.push(l.id);
    if (ids.length >= LIMITE_DE_LEADS_LISTADOS) break;
  }
  const unicos = [...new Set(ids)];

  const tokens = new Map<string, string | null>([[fonte.id, token]]);
  const resultado: ResultadoDaImportacao = {
    ok: true,
    encontrados: unicos.length,
    entraram: 0,
    jaExistiam: 0,
    ignorados: 0,
    falharam: 0,
    parouNoLimite: false,
  };
  for (let i = 0; i < unicos.length; i += EM_PARALELO) {
    if (resultado.entraram + resultado.ignorados + resultado.falharam >= LIMITE_DE_NOVOS_POR_CLIQUE) {
      resultado.parouNoLimite = true;
      break;
    }
    await Promise.all(
      unicos.slice(i, i + EM_PARALELO).map(async (leadgenId) => {
        try {
          const r = await receberLead(admin, fonte, leadSoComIds(leadgenId, entrada.pageId), {
            requestId: entrada.requestId,
            tokens,
            pularSeJaEntrou: true,
            semAviso: true,
          });
          if (r.estado === "entrou") resultado.entraram++;
          else if (r.estado === "duplicado") resultado.jaExistiam++;
          else resultado.ignorados++;
        } catch (erro) {
          resultado.falharam++;
          logger.warn("[lead-ads.conexao] lead antigo não entrou", {
            request_id: entrada.requestId,
            leadgen_id: leadgenId,
            motivo: erro instanceof Error ? erro.message.slice(0, 120) : "desconhecido",
          });
        }
      }),
    );
  }
  return resultado;
}
