/**
 * GET /api/v1/reports/funil-meta — resultados do funil e o que o Meta registrou.
 *
 * Query: `preset` (7d|14d|28d|semana|semana_passada) OU `de`/`ate` (YYYY-MM-DD,
 * até 90 dias). Funil = o padrão da organização.
 *
 * ## Escopo — admin client, organização escrita em toda consulta
 *
 * `ad_conversion_dispatches`, `meta_ads_conversion_rules` e
 * `meta_ctwa_click_dispatches` são revogadas de `authenticated` no baseline:
 * com o client do usuário a primeira carga daria permission denied. Por isso
 * tudo aqui lê com o admin client, como `lib/conversoes/historico.ts`, e TODA
 * consulta filtra `organization_id` pela organização ativa resolvida pelo
 * `requireRole` (cookie validado), nunca do pedido.
 *
 * Piso `manager`, o mesmo de Meta Ads: conjunto de dados e envios são da
 * empresa inteira; não há recorte por atendente que a RLS precisasse fazer.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { lerTudo } from "@/lib/reports/ler-tudo";
import { lerEstatisticasDoConjunto } from "@/lib/plataformas-de-anuncio/meta/estatisticas-do-conjunto";
import {
  FUSO_DO_META,
  compararComMeta,
  diasCobertosPeloMeta,
  diasEntre,
  inicioDoDia,
  janelaDoPreset,
  janelaLivre,
  montarFunil,
  mudancaDeEtapa,
  resumirCliques,
  somarDias,
  type AtividadeDeEtapa,
  type EnvioAoMeta,
  type Etapa,
} from "@/lib/reports/funil-meta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  preset: z.enum(["7d", "14d", "28d", "semana", "semana_passada"]).optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
});

const LOTE_DE_IDS = 200;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const url = new URL(req.url);
  const q = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return fail("validation_failed", "Query inválida.", 422, { requestId });

  const agora = new Date();
  const janela =
    q.data.de && q.data.ate
      ? janelaLivre(q.data.de, q.data.ate)
      : janelaDoPreset(q.data.preset ?? "7d", agora);
  if (!janela) {
    return fail("validation_failed", "Intervalo inválido (máximo de 90 dias).", 422, { requestId });
  }
  if (!isServiceRoleConfigured()) {
    return fail("unavailable", "Leitura indisponível nesta instalação.", 503, { requestId });
  }

  // A comparação usa os MESMOS dias de calendário, cortados em Los Angeles.
  const dias = diasEntre(janela.primeiroDia, janela.ultimoDia);
  const janelaMeta = {
    de: inicioDoDia(janela.primeiroDia, FUSO_DO_META),
    ate: inicioDoDia(somarDias(janela.ultimoDia, 1), FUSO_DO_META),
  };
  const deTudo = new Date(Math.min(janela.de.getTime(), janelaMeta.de.getTime())).toISOString();
  const ateTudo = new Date(Math.max(janela.ate.getTime(), janelaMeta.ate.getTime())).toISOString();

  const admin = createAdminClient();
  try {
    const { data: funil, error: erroFunil } = await admin
      .from("crm_pipelines")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();
    if (erroFunil) throw new Error(erroFunil.message);
    if (!funil)
      return fail("not_found", "Nenhum funil padrão nesta organização.", 404, { requestId });

    const etapas = await lerEtapas(admin, orgId, funil.id);
    const ids = etapas.map((e) => e.id);

    const [abertos, atividades, envios, cliques] = await Promise.all([
      lerAbertos(admin, orgId, ids),
      lerAtividades(admin, orgId, funil.id, ids, janela.de.toISOString(), janela.ate.toISOString()),
      lerTudo<{
        id: string;
        event_name: string;
        meta_event_name: string | null;
        status: string;
        created_at: string;
        attempted_at: string | null;
      }>((a, b) =>
        admin
          .from("ad_conversion_dispatches")
          .select("id, event_name, meta_event_name, status, created_at, attempted_at")
          .eq("organization_id", orgId)
          .eq("platform", "meta_ads")
          .gte("created_at", deTudo)
          .lt("created_at", ateTudo)
          .order("id")
          .range(a, b),
      ),
      lerCliques(admin, orgId, janela.de.toISOString(), janela.ate.toISOString()),
    ]);

    const todosEnvios: EnvioAoMeta[] = envios.map((e) => ({
      eventName: e.event_name,
      metaEventName: e.meta_event_name,
      status: e.status,
      criadoEm: e.created_at,
      tentadoEm: e.attempted_at,
    }));
    const dentro = (e: EnvioAoMeta, de: Date, ate: Date) => {
      const t = new Date(e.tentadoEm ?? e.criadoEm).getTime();
      return t >= de.getTime() && t < ate.getTime();
    };

    const linhasDoFunil = montarFunil({
      etapas,
      abertosPorEtapa: abertos,
      atividades,
      envios: todosEnvios.filter((e) => dentro(e, janela.de, janela.ate)),
    });

    // O Meta só guarda 28 dias. Dia que começa antes disso não é comparado
    // (sairia cortado e daria "diferença" falsa): vira "sem dados do Meta".
    const cobertos = diasCobertosPeloMeta(dias, agora);
    const primeiroCoberto = dias.find((d) => cobertos.has(d));
    const stats = primeiroCoberto
      ? await lerEstatisticasDoConjunto(admin, orgId, {
          de: inicioDoDia(primeiroCoberto, FUSO_DO_META),
          ate: janelaMeta.ate > agora ? agora : janelaMeta.ate,
        })
      : null;

    const comparacao = compararComMeta({
      etapas,
      envios: todosEnvios.filter((e) => dentro(e, janelaMeta.de, janelaMeta.ate)),
      meta: stats?.ok ? stats.contagens : null,
      dias,
      diasComMeta: cobertos,
    });

    return ok(
      {
        janela: {
          de: janela.de.toISOString(),
          ate: janela.ate.toISOString(),
          primeiroDia: janela.primeiroDia,
          ultimoDia: janela.ultimoDia,
        },
        funil: { id: funil.id, nome: funil.name, etapas: linhasDoFunil },
        meta: stats?.ok
          ? {
              ok: true as const,
              datasetId: stats.datasetId,
              diasSemDados: dias.length - cobertos.size,
              comparacao,
            }
          : { ok: false as const, motivo: stats ? stats.motivo : "fora_dos_28_dias", comparacao },
        cliques: cliques
          ? resumirCliques(
              cliques.map((c) => ({ capturadoEm: c.captured_at, status: c.status })),
              dias,
            )
          : null,
      },
      { requestId },
    );
  } catch (erro) {
    // O texto cru do Postgres fica no log, não na tela.
    logger.error("[reports.funil-meta] falha", {
      requestId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", "Não foi possível montar o relatório.", 500, { requestId });
  }
}

async function lerEtapas(
  admin: SupabaseClient,
  orgId: string,
  pipelineId: string,
): Promise<Etapa[]> {
  const { data: stages, error } = await admin
    .from("crm_stages")
    .select("id, name, position, is_won")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .eq("is_lost", false)
    .order("position");
  if (error) throw new Error(error.message);

  const { data: regras, error: erroRegras } = await admin
    .from("meta_ads_conversion_rules")
    .select("stage_id, meta_event")
    .eq("organization_id", orgId)
    .eq("enabled", true);
  if (erroRegras) throw new Error(erroRegras.message);
  const eventoPorEtapa = new Map(
    (regras ?? []).map((r) => [r.stage_id as string, r.meta_event as string]),
  );

  return (stages ?? []).map((s) => ({
    id: s.id as string,
    nome: s.name as string,
    posicao: s.position as number,
    ganha: Boolean(s.is_won),
    eventoMeta: eventoPorEtapa.get(s.id as string) ?? (s.is_won ? "Purchase" : null),
  }));
}

async function lerAbertos(
  admin: SupabaseClient,
  orgId: string,
  etapas: string[],
): Promise<Record<string, number>> {
  const contagens = await Promise.all(
    etapas.map(async (id) => {
      const { count, error } = await admin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("stage_id", id);
      if (error) throw new Error(error.message);
      return [id, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(contagens);
}

/**
 * Entradas por etapa. `stage_changed` é lido nas DUAS grafias de payload e
 * filtrado pela etapa de destino pertencer ao funil — não por
 * `payload.pipeline_id`, que agente, handoff e agenda não gravam.
 */
async function lerAtividades(
  admin: SupabaseClient,
  orgId: string,
  pipelineId: string,
  idsDasEtapas: string[],
  de: string,
  ate: string,
): Promise<AtividadeDeEtapa[]> {
  const doFunil = new Set(idsDasEtapas);
  const [mudancas, criados] = await Promise.all([
    lerTudo<{ id: string; performed_at: string; payload: Record<string, unknown> | null }>((a, b) =>
      admin
        .from("crm_lead_activities")
        .select("id, performed_at, payload")
        .eq("organization_id", orgId)
        .eq("type", "stage_changed")
        .gte("performed_at", de)
        .lt("performed_at", ate)
        .order("id")
        .range(a, b),
    ),
    lerTudo<{ id: string; performed_at: string; lead_id: string | null }>((a, b) =>
      admin
        .from("crm_lead_activities")
        .select("id, performed_at, lead_id")
        .eq("organization_id", orgId)
        .eq("type", "lead_created")
        .gte("performed_at", de)
        .lt("performed_at", ate)
        .order("id")
        .range(a, b),
    ),
  ]);

  const leadsDoFunil = await leadsNoFunil(
    admin,
    orgId,
    pipelineId,
    criados.map((c) => c.lead_id).filter((v): v is string => Boolean(v)),
  );

  const out: AtividadeDeEtapa[] = [];
  for (const m of mudancas) {
    const { fromStageId, toStageId } = mudancaDeEtapa(m.payload);
    if (toStageId && doFunil.has(toStageId)) {
      out.push({ tipo: "stage_changed", performedAt: m.performed_at, fromStageId, toStageId });
    }
  }
  for (const c of criados) {
    if (c.lead_id && leadsDoFunil.has(c.lead_id))
      out.push({ tipo: "lead_created", performedAt: c.performed_at });
  }
  return out;
}

async function leadsNoFunil(
  admin: SupabaseClient,
  orgId: string,
  pipelineId: string,
  ids: string[],
): Promise<Set<string>> {
  const unicos = [...new Set(ids)];
  const achados = new Set<string>();
  for (let i = 0; i < unicos.length; i += LOTE_DE_IDS) {
    const { data, error } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .in("id", unicos.slice(i, i + LOTE_DE_IDS));
    if (error) throw new Error(error.message);
    for (const l of data ?? []) achados.add(l.id as string);
  }
  return achados;
}

/**
 * `meta_ctwa_click_dispatches` só existe a partir da 1.100. Numa instalação
 * sem a tabela a seção some (null) em vez de derrubar o relatório.
 */
async function lerCliques(
  admin: SupabaseClient,
  orgId: string,
  de: string,
  ate: string,
): Promise<Array<{ captured_at: string; status: string }> | null> {
  try {
    return await lerTudo<{ id: string; captured_at: string; status: string }>((a, b) =>
      admin
        .from("meta_ctwa_click_dispatches")
        .select("id, captured_at, status")
        .eq("organization_id", orgId)
        .gte("captured_at", de)
        .lt("captured_at", ate)
        .order("id")
        .range(a, b),
    );
  } catch (erro) {
    logger.warn("[reports.funil-meta] cliques CTWA indisponíveis", {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
