/**
 * (Acelera) Receber UM lead do formulário da Meta, de ponta a ponta, para a
 * fonte (Página) que é dona dele. É o miolo que a rota do aviso e o botão
 * "Trazer leads antigos" compartilham — uma régua só para os dois caminhos.
 *
 * Ordem: a fonte está ativa? → as respostas (busca autenticada, token da
 * PÁGINA) → contato + card (`entrada.ts`, função direta, sem HTTP).
 * Nunca inventa dado: lead sem respostas não entra, e o motivo fica em "Leads
 * recebidos" quando há fonte dona.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { registrarCaptacao, type MotivoDaRecusa } from "@/lib/webhooks/captacao";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { logger } from "@/lib/logger";

import { avisarComercialPeloOs } from "./aviso-do-os";
import { cardPeloLeadgenId, entradaDoLeadDoFormulario, type FonteDoLeadAds } from "./entrada";
import type { ErroEmPortugues } from "./erros-da-meta";
import { leadComRespostas, type LeadDoFormulario } from "./payload";
import { buscarRespostasDoLead, leadComOrigem } from "./respostas-na-meta";

/** O que a fonte precisa ter para a porta funcionar. */
export interface FonteDaPagina extends FonteDoLeadAds {
  pageId: string | null;
  /** Buscar as respostas na Graph (ligado pelo servidor ao conectar a Página). */
  buscaLigada: boolean;
  /** Cifrado; decifrado uma vez por lote, nunca devolvido. */
  tokenCifrado: string | null;
  ativa: boolean;
}

export const COLUNAS_DA_FONTE_DA_PAGINA =
  "id, name, organization_id, default_pipeline_id, default_stage_id, is_active, " +
  "meta_page_id, meta_lead_retrieval, meta_page_token_encrypted";

export function fonteDaPagina(linha: Record<string, unknown>): FonteDaPagina {
  return {
    id: linha.id as string,
    organizationId: linha.organization_id as string,
    nome: (linha.name as string | null) ?? "Formulário da Meta",
    funilId: linha.default_pipeline_id as string,
    etapaId: linha.default_stage_id as string,
    pageId: (linha.meta_page_id as string | null) ?? null,
    buscaLigada: linha.meta_lead_retrieval === true,
    tokenCifrado: (linha.meta_page_token_encrypted as string | null) ?? null,
    ativa: linha.is_active === true,
  };
}

/** Um lead só com os ids, que é o que o aviso (e a lista de leads antigos) traz. */
export function leadSoComIds(
  leadgenId: string,
  pageId: string | null,
  extras: Partial<LeadDoFormulario> = {},
): LeadDoFormulario {
  return {
    leadgenId,
    pageId,
    formId: null,
    adId: null,
    campaignId: null,
    adNome: null,
    adsetId: null,
    adsetNome: null,
    campaignNome: null,
    plataforma: null,
    criadoEm: null,
    entradaEm: null,
    nome: null,
    telefone: null,
    email: null,
    respostas: [],
    campos: {},
    ...extras,
  };
}

export type MotivoDoIgnorado =
  | "sem_field_data"
  | "sem_respostas_na_meta"
  | "pagina_desligada";

export type ResultadoDoRecebimento =
  | { estado: "entrou" | "duplicado"; leadId: string | null; contatoId: string | null }
  | { estado: "ignorado"; motivo: MotivoDoIgnorado; detalhe?: string; erro?: ErroEmPortugues };

const MOTIVO_NA_TELA: Record<MotivoDoIgnorado, MotivoDaRecusa> = {
  sem_field_data: "lead_ads_sem_respostas",
  sem_respostas_na_meta: "lead_ads_busca_falhou",
  pagina_desligada: "lead_ads_fonte_pausada",
};

export interface ContextoDoRecebimento {
  requestId: string;
  /** Token decifrado por fonte, uma vez por lote (a decifra é uma RPC). */
  tokens: Map<string, string | null>;
  atrasoSegundos?: number | null;
  /** Leads antigos: não avisa o comercial (ver `aviso-do-os.ts`). */
  semAviso?: boolean;
  /** Leads antigos: quem já entrou é pulado sem ler a Meta e sem nova linha em "Leads recebidos". */
  pularSeJaEntrou?: boolean;
  buscar?: typeof buscarRespostasDoLead;
}

export async function receberLead(
  admin: SupabaseClient,
  fonte: FonteDaPagina,
  base: LeadDoFormulario,
  ctx: ContextoDoRecebimento,
): Promise<ResultadoDoRecebimento> {
  const registrarIgnorado = async (motivo: MotivoDoIgnorado, detalhe?: string) => {
    await registrarCaptacao(admin, {
      organizationId: fonte.organizationId,
      webhookSourceId: fonte.id,
      sourceName: fonte.nome,
      outcome: "recusado",
      rejectReason: MOTIVO_NA_TELA[motivo],
      fields: {
        leadgen_id: base.leadgenId,
        ...(base.pageId ? { page_id: base.pageId } : {}),
        ...(detalhe ? { detalhe } : {}),
      },
      requestId: ctx.requestId,
    });
  };

  if (!fonte.ativa) {
    await registrarIgnorado("pagina_desligada");
    return { estado: "ignorado", motivo: "pagina_desligada" };
  }

  if (ctx.pularSeJaEntrou) {
    const existente = await cardPeloLeadgenId(admin, fonte.organizationId, base.leadgenId);
    if (existente) return { estado: "duplicado", leadId: existente.id, contatoId: existente.contactId };
  }

  let lead = base;
  if (lead.respostas.length === 0) {
    if (!fonte.buscaLigada) {
      await registrarIgnorado("sem_field_data");
      return { estado: "ignorado", motivo: "sem_field_data" };
    }
    let token = ctx.tokens.get(fonte.id);
    if (token === undefined) {
      token = fonte.tokenCifrado ? await decryptWebhookSecret(admin, fonte.tokenCifrado) : null;
      ctx.tokens.set(fonte.id, token);
    }
    if (!token) {
      const detalhe = fonte.tokenCifrado ? "token_indecifravel" : "sem_token_da_pagina";
      await registrarIgnorado("sem_respostas_na_meta", detalhe);
      return { estado: "ignorado", motivo: "sem_respostas_na_meta", detalhe };
    }
    const busca = await (ctx.buscar ?? buscarRespostasDoLead)({ leadgenId: base.leadgenId, token });
    if (!busca.ok) {
      const detalhe = busca.detalhe ? `${busca.motivo}:${busca.detalhe}` : busca.motivo;
      logger.warn("[lead-ads] aviso sem as respostas do formulário", {
        request_id: ctx.requestId,
        webhook_source_id: fonte.id,
        leadgen_id: base.leadgenId,
        motivo: busca.motivo,
        detalhe: busca.detalhe ?? null,
      });
      await registrarIgnorado("sem_respostas_na_meta", detalhe);
      return { estado: "ignorado", motivo: "sem_respostas_na_meta", detalhe, erro: busca.erro };
    }
    lead = leadComOrigem(leadComRespostas(base, busca.respostas), busca.origem);
  }

  const resultado = await entradaDoLeadDoFormulario(admin, fonte, lead, ctx.requestId, {
    atrasoSegundos: ctx.atrasoSegundos ?? null,
  });
  // Legado transitório: só o card que nasceu AGORA (a reentrega volta "duplicado").
  if (resultado.desfecho === "criado" && !ctx.semAviso) await avisarComercialPeloOs(lead);
  return {
    estado: resultado.desfecho === "criado" ? "entrou" : "duplicado",
    leadId: resultado.leadId,
    contatoId: resultado.contatoId,
  };
}
