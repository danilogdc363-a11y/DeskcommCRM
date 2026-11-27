/**
 * GET /api/v1/reports/funil-de-vendas — Acelera (fork): Análise › Funil de vendas.
 *
 * Query: `preset` (este_mes|mes_passado|7d|14d|28d) OU `de`/`ate` (AAAA-MM-DD),
 * e `modo` (coorte|movimento). Sempre compara com o período anterior de mesmo
 * tamanho. Funil = o padrão da organização.
 *
 * Admin client, com `organization_id` em TODA consulta (resolvido pelo
 * `requireRole`, nunca do pedido): `ad_insights_connections` só abre pelo admin,
 * e o painel é da empresa inteira (piso `manager`, o mesmo de Meta Ads). O
 * token do Meta é decifrado aqui e não sai do servidor.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { lerInsights } from "@/lib/plataformas-de-anuncio/meta/insights";
import {
  acharEtapasChave,
  contarEventosDoMeta,
  contarFunil,
  contarSemEnvio,
  etapasDosEventos,
  destinoDaMudanca,
  diaNoFuso,
  ehDoMeta,
  janelaAnterior,
  janelaDoPreset,
  janelaLivre,
  somarGasto,
  somarLeadsDoMeta,
  type EntradaEmEtapa,
  type EnvioAoMeta,
  type Janela,
  type LeadDoFunil,
} from "@/lib/reports/funil-de-vendas";
import { lerTudo } from "@/lib/reports/ler-tudo";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  preset: z.enum(["este_mes", "mes_passado", "7d", "14d", "28d"]).optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
  modo: z.enum(["coorte", "movimento"]).default("movimento"),
});

const LOTE = 200;

type LinhaDeLead = {
  id: string;
  contact_id: string | null;
  created_at: string;
  stage_id: string;
  source: string | null;
  source_metadata: Record<string, unknown> | null;
};

const CAMPOS_DO_LEAD = "id, contact_id, created_at, stage_id, source, source_metadata";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const q = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return fail("validation_failed", "Período inválido.", 422, { requestId });

  const agora = new Date();
  const janela =
    q.data.de && q.data.ate
      ? janelaLivre(q.data.de, q.data.ate)
      : janelaDoPreset(q.data.preset ?? "este_mes", agora);
  if (!janela) {
    return fail("validation_failed", "Intervalo inválido (máximo de 120 dias).", 422, { requestId });
  }
  if (!isServiceRoleConfigured()) {
    return fail("unavailable", "Leitura indisponível nesta instalação.", 503, { requestId });
  }
  const anterior = janelaAnterior(janela);
  const modo = q.data.modo;

  const admin = createAdminClient();
  try {
    const { data: funil, error: erroFunil } = await admin
      .from("crm_pipelines")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();
    if (erroFunil) throw new Error(erroFunil.message);
    if (!funil) return fail("not_found", "Nenhum funil padrão nesta organização.", 404, { requestId });

    const { data: stages, error: erroEtapas } = await admin
      .from("crm_stages")
      .select("id, name, is_won, is_lost, position, is_archived")
      .eq("organization_id", orgId)
      .eq("pipeline_id", funil.id);
    if (erroEtapas) throw new Error(erroEtapas.message);
    const etapasAtivas = (stages ?? [])
      .filter((s) => !s.is_archived)
      .map((s) => ({
        id: s.id as string,
        name: s.name as string,
        is_won: Boolean(s.is_won),
        is_lost: Boolean(s.is_lost),
        position: Number(s.position),
      }));
    const etapas = acharEtapasChave(etapasAtivas);
    const etapasPorDegrau = etapasDosEventos(etapasAtivas);
    const doFunil = new Set((stages ?? []).map((s) => s.id as string));

    const dados = await carregar(admin, orgId, funil.id as string, doFunil, {
      de: anterior.de,
      ate: janela.ate,
    });

    const contar = (j: Janela, filtro?: (l: LeadDoFunil) => boolean) =>
      contarFunil({
        modo,
        janela: j,
        etapas,
        leads: dados.leads,
        entradas: dados.entradas,
        primeiraResposta: dados.primeiraResposta,
        filtro,
      });

    const doMeta = (l: LeadDoFunil) => l.doMeta;
    const organico = (l: LeadDoFunil) => !l.doMeta;
    const origens = {
      geral: { atual: contar(janela), antes: contar(anterior) },
      meta: { atual: contar(janela, doMeta), antes: contar(anterior, doMeta) },
      organico: { atual: contar(janela, organico), antes: contar(anterior, organico) },
    };

    const [anuncios, envios] = await Promise.all([
      lerMeta(admin, orgId, janela, anterior, agora),
      lerEnviosAoMeta(admin, orgId, janela.de),
    ]);
    const eventosDoMeta = {
      porEtapa: contarEventosDoMeta({ envios, etapasPorDegrau, janela }),
      semEnvio: contarSemEnvio({ envios, entradas: dados.entradas, etapasPorDegrau, janela }),
    };

    return ok(
      {
        modo,
        funil: { id: funil.id, nome: funil.name },
        semEtapaDeReuniao: etapas.reuniao.size === 0,
        janela: { primeiroDia: janela.primeiroDia, ultimoDia: janela.ultimoDia },
        anterior: { primeiroDia: anterior.primeiroDia, ultimoDia: anterior.ultimoDia },
        origens,
        eventosDoMeta,
        meta: anuncios.ok
          ? {
              ok: true as const,
              contaId: anuncios.contaId,
              atual: { gasto: anuncios.atual.gasto, leadsNoMeta: anuncios.atual.leads },
              antes: { gasto: anuncios.antes.gasto, leadsNoMeta: anuncios.antes.leads },
            }
          : { ok: false as const, motivo: anuncios.motivo },
      },
      { requestId },
    );
  } catch (erro) {
    logger.error("[reports.funil-de-vendas] falha", {
      requestId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", "Não foi possível montar o funil.", 500, { requestId });
  }
}

/**
 * Tudo que as duas janelas (atual + anterior) precisam, numa leitura só:
 * leads criados no intervalo, leads que mudaram de etapa nele, leads cujo
 * contato mandou a primeira mensagem nele, as mudanças de etapa desses leads e
 * a primeira mensagem recebida de cada contato.
 */
async function carregar(
  admin: SupabaseClient,
  orgId: string,
  pipelineId: string,
  etapasDoFunil: Set<string>,
  intervalo: { de: Date; ate: Date },
): Promise<{ leads: LeadDoFunil[]; entradas: EntradaEmEtapa[]; primeiraResposta: Map<string, string> }> {
  const de = intervalo.de.toISOString();
  const ate = intervalo.ate.toISOString();

  const [criados, mudancasNoIntervalo, contatosQueFalaram] = await Promise.all([
    lerTudo<LinhaDeLead>((a, b) =>
      admin
        .from("crm_leads")
        .select(CAMPOS_DO_LEAD)
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipelineId)
        .gte("created_at", de)
        .lt("created_at", ate)
        .order("id")
        .range(a, b),
    ),
    lerTudo<{ id: string; lead_id: string | null; performed_at: string; payload: Record<string, unknown> | null }>(
      (a, b) =>
        admin
          .from("crm_lead_activities")
          .select("id, lead_id, performed_at, payload")
          .eq("organization_id", orgId)
          .eq("type", "stage_changed")
          .gte("performed_at", de)
          .lt("performed_at", ate)
          .order("id")
          .range(a, b),
    ),
    lerTudo<{ id: string; contact_id: string | null }>((a, b) =>
      admin
        .from("messages")
        .select("id, contact_id")
        .eq("organization_id", orgId)
        .eq("direction", "inbound")
        .gte("created_at", de)
        .lt("created_at", ate)
        .order("id")
        .range(a, b),
    ),
  ]);

  const porId = new Map<string, LinhaDeLead>(criados.map((l) => [l.id, l]));

  // Leads que se mexeram no intervalo mas foram criados antes.
  const movidos = [
    ...new Set(
      mudancasNoIntervalo
        .filter((m) => m.lead_id && etapasDoFunil.has(destinoDaMudanca(m.payload) ?? ""))
        .map((m) => m.lead_id as string),
    ),
  ].filter((id) => !porId.has(id));
  for (const l of await lerEmLotes<LinhaDeLead>(movidos, (ids) =>
    admin
      .from("crm_leads")
      .select(CAMPOS_DO_LEAD)
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .in("id", ids),
  ))
    porId.set(l.id, l);

  // Leads de contatos que mandaram mensagem no intervalo (para "responderam"
  // no modo movimento, mesmo sem mudar de etapa).
  const contatosConhecidos = new Set([...porId.values()].map((l) => l.contact_id));
  const outrosContatos = [
    ...new Set(contatosQueFalaram.map((m) => m.contact_id).filter((c): c is string => Boolean(c))),
  ].filter((c) => !contatosConhecidos.has(c));
  for (const l of await lerEmLotes<LinhaDeLead>(outrosContatos, (ids) =>
    admin
      .from("crm_leads")
      .select(CAMPOS_DO_LEAD)
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .in("contact_id", ids),
  ))
    porId.set(l.id, l);

  const ids = [...porId.keys()];

  // Mudanças de etapa desses leads em QUALQUER data (a coorte pergunta
  // "passou pela reunião?", não importa quando).
  const todasAsMudancas = await lerEmLotes<{
    id: string;
    lead_id: string;
    performed_at: string;
    payload: Record<string, unknown> | null;
  }>(ids, (lote) =>
    admin
      .from("crm_lead_activities")
      .select("id, lead_id, performed_at, payload")
      .eq("organization_id", orgId)
      .eq("type", "stage_changed")
      .in("lead_id", lote),
  );
  const entradas: EntradaEmEtapa[] = [];
  for (const m of todasAsMudancas) {
    const para = destinoDaMudanca(m.payload);
    if (para) entradas.push({ leadId: m.lead_id, paraEtapaId: para, em: m.performed_at });
  }

  // Primeira mensagem recebida de cada contato.
  const contatos = [...new Set(ids.map((id) => porId.get(id)?.contact_id).filter((c): c is string => Boolean(c)))];
  const primeiraResposta = new Map<string, string>();
  for (let i = 0; i < contatos.length; i += LOTE) {
    const lote = contatos.slice(i, i + LOTE);
    const msgs = await lerTudo<{ id: string; contact_id: string; created_at: string }>((a, b) =>
      admin
        .from("messages")
        .select("id, contact_id, created_at")
        .eq("organization_id", orgId)
        .eq("direction", "inbound")
        .in("contact_id", lote)
        .order("id")
        .range(a, b),
    );
    for (const m of msgs) {
      const atual = primeiraResposta.get(m.contact_id);
      if (!atual || m.created_at < atual) primeiraResposta.set(m.contact_id, m.created_at);
    }
  }

  const leads: LeadDoFunil[] = [...porId.values()].map((l) => ({
    id: l.id,
    contatoId: l.contact_id,
    criadoEm: l.created_at,
    etapaId: l.stage_id,
    doMeta: ehDoMeta(l.source, l.source_metadata),
  }));
  return { leads, entradas, primeiraResposta };
}

async function lerEmLotes<T>(
  ids: string[],
  consulta: (lote: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await consulta(ids.slice(i, i + LOTE));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

type LeituraDoMeta =
  | {
      ok: true;
      contaId: string;
      atual: { gasto: number; leads: number };
      antes: { gasto: number; leads: number };
    }
  | { ok: false; motivo: "sem_conexao" | "cifra_indisponivel" | "sem_conta" | "falha_na_leitura" };

/** Gasto e leads contados pelo Meta, na conta padrão da conexão de leitura. */
async function lerMeta(
  admin: SupabaseClient,
  orgId: string,
  janela: Janela,
  anterior: Janela,
  agora: Date,
): Promise<LeituraDoMeta> {
  const credencial = await lerCredencialDeLeitura(admin, orgId, "meta_ads");
  if (!credencial.ok) return { ok: false, motivo: credencial.motivo };
  const conta = credencial.credencial.contaPadrao;
  if (!conta) return { ok: false, motivo: "sem_conta" };
  const contaId = conta.startsWith("act_") ? conta : `act_${conta}`;
  const token = credencial.credencial.accessToken;
  const hoje = diaNoFuso(agora);
  const ate = (dia: string) => (dia > hoje ? hoje : dia);

  const [atual, antes] = await Promise.all([
    lerInsights(token, contaId, janela.primeiroDia, ate(janela.ultimoDia)),
    lerInsights(token, contaId, anterior.primeiroDia, ate(anterior.ultimoDia)),
  ]);
  if (!atual.ok || !antes.ok) {
    logger.warn("[reports.funil-de-vendas] leitura do Meta falhou", {
      falha: !atual.ok ? atual.falha : !antes.ok ? antes.falha : null,
    });
    return { ok: false, motivo: "falha_na_leitura" };
  }
  return {
    ok: true,
    contaId,
    atual: { gasto: somarGasto(atual.dados), leads: somarLeadsDoMeta(atual.dados) },
    antes: { gasto: somarGasto(antes.dados), leads: somarLeadsDoMeta(antes.dados) },
  };
}

/**
 * Envios à API de Conversões a partir do início do período (até agora: o
 * envio de quem entrou no último dia pode sair logo depois). A tabela é
 * revogada de `authenticated`, por isso o admin client, com a organização no
 * filtro.
 */
async function lerEnviosAoMeta(admin: SupabaseClient, orgId: string, de: Date): Promise<EnvioAoMeta[]> {
  const linhas = await lerTudo<{
    id: string;
    lead_id: string | null;
    event_name: string;
    status: string;
    created_at: string;
    attempted_at: string | null;
  }>((a, b) =>
    admin
      .from("ad_conversion_dispatches")
      .select("id, lead_id, event_name, status, created_at, attempted_at")
      .eq("organization_id", orgId)
      .eq("platform", "meta_ads")
      .gte("created_at", de.toISOString())
      .order("id")
      .range(a, b),
  );
  return linhas.map((l) => ({
    leadId: l.lead_id,
    eventName: l.event_name,
    status: l.status,
    em: l.attempted_at ?? l.created_at,
  }));
}
