/**
 * GET /api/v1/reports/funil-meta — resultados do funil e o que o Meta registrou.
 *
 * Query: `preset` (7d|14d|28d|semana|semana_passada) OU `de`/`ate` (YYYY-MM-DD,
 * até 90 dias). Funil = o padrão da organização.
 *
 * ## Escopo
 *
 * Dados do CRM pelo client do USUÁRIO (RLS) e com `organization_id` explícito,
 * como nas outras telas de Análise. O admin client só lê a credencial da API de
 * Conversões para consultar o Meta; o token nunca sai do servidor.
 *
 * Piso `manager`, o mesmo de Meta Ads: conjunto de dados e envios são da
 * empresa inteira, não há recorte por atendente que faça sentido aqui.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { lerEstatisticasDoConjunto } from "@/lib/plataformas-de-anuncio/meta/estatisticas-do-conjunto";
import {
  FUSO_DO_META,
  compararComMeta,
  diasEntre,
  inicioDoDia,
  janelaDoPreset,
  janelaLivre,
  montarFunil,
  resumirCliques,
  somarDias,
  type AtividadeDeEtapa,
  type EnvioAoMeta,
  type Etapa,
} from "@/lib/reports/funil-meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  preset: z.enum(["7d", "14d", "28d", "semana", "semana_passada"]).optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
});

const PAGINA = 1000;

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** Lê todas as páginas: o PostgREST corta em 1000 linhas sem avisar. */
async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await consulta(i, i + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGINA) return out;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const url = new URL(req.url);
  const q = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return fail("validation_failed", "Query inválida.", 422, { requestId });

  const janela =
    q.data.de && q.data.ate
      ? janelaLivre(q.data.de, q.data.ate)
      : janelaDoPreset(q.data.preset ?? "7d", new Date());
  if (!janela) {
    return fail("validation_failed", "Intervalo inválido (máximo de 90 dias).", 422, { requestId });
  }

  // A comparação usa os MESMOS dias de calendário, mas cortados em Los Angeles.
  const diasMeta = diasEntre(janela.primeiroDia, janela.ultimoDia);
  const janelaMeta = {
    de: inicioDoDia(janela.primeiroDia, FUSO_DO_META),
    ate: inicioDoDia(somarDias(janela.ultimoDia, 1), FUSO_DO_META),
  };
  const deTudo = new Date(Math.min(janela.de.getTime(), janelaMeta.de.getTime())).toISOString();
  const ateTudo = new Date(Math.max(janela.ate.getTime(), janelaMeta.ate.getTime())).toISOString();

  const supabase = await createClient();
  try {
    const { data: funil } = await supabase
      .from("crm_pipelines")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();
    if (!funil) return fail("not_found", "Nenhum funil padrão nesta organização.", 404, { requestId });

    const etapas = await lerEtapas(supabase, orgId, funil.id);
    const ids = etapas.map((e) => e.id);

    const [abertos, atividades, envios, cliques] = await Promise.all([
      lerAbertos(supabase, orgId, ids),
      lerAtividades(supabase, orgId, funil.id, janela.de.toISOString(), janela.ate.toISOString()),
      lerTudo<{ event_name: string; meta_event_name: string | null; status: string; created_at: string }>((a, b) =>
        supabase
          .from("ad_conversion_dispatches")
          .select("event_name, meta_event_name, status, created_at")
          .eq("organization_id", orgId)
          .eq("platform", "meta_ads")
          .gte("created_at", deTudo)
          .lt("created_at", ateTudo)
          .range(a, b),
      ),
      lerTudo<{ captured_at: string; status: string }>((a, b) =>
        supabase
          .from("meta_ctwa_click_dispatches")
          .select("captured_at, status")
          .eq("organization_id", orgId)
          .gte("captured_at", janela.de.toISOString())
          .lt("captured_at", janela.ate.toISOString())
          .range(a, b),
      ),
    ]);

    const todosEnvios: EnvioAoMeta[] = envios.map((e) => ({
      eventName: e.event_name,
      metaEventName: e.meta_event_name,
      status: e.status,
      criadoEm: e.created_at,
    }));
    const dentro = (e: EnvioAoMeta, de: Date, ate: Date) => {
      const t = new Date(e.criadoEm).getTime();
      return t >= de.getTime() && t < ate.getTime();
    };

    const linhasDoFunil = montarFunil({
      etapas,
      abertosPorEtapa: abertos,
      atividades,
      envios: todosEnvios.filter((e) => dentro(e, janela.de, janela.ate)),
    });

    // O Meta só guarda 28 dias de estatística: pedir mais antigo é recusado.
    const limiteDoMeta = new Date(Date.now() - 28 * 86_400_000 + 60_000);
    const janelaPedidaAoMeta = {
      de: janelaMeta.de < limiteDoMeta ? limiteDoMeta : janelaMeta.de,
      ate: janelaMeta.ate > new Date() ? new Date() : janelaMeta.ate,
    };
    const stats = isServiceRoleConfigured()
      ? await lerEstatisticasDoConjunto(createAdminClient(), orgId, janelaPedidaAoMeta)
      : ({ ok: false, motivo: "leitura_indisponivel" } as const);

    const comparacao = compararComMeta({
      etapas,
      envios: todosEnvios.filter((e) => dentro(e, janelaMeta.de, janelaMeta.ate)),
      meta: stats.ok ? stats.contagens : [],
      dias: diasMeta,
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
        meta: stats.ok
          ? { ok: true as const, datasetId: stats.datasetId, comparacao }
          : { ok: false as const, motivo: stats.motivo, comparacao },
        cliques: resumirCliques(
          cliques.map((c) => ({ capturadoEm: c.captured_at, status: c.status })),
          diasMeta,
        ),
      },
      { requestId },
    );
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : "erro", 500, { requestId });
  }
}

async function lerEtapas(supabase: Cliente, orgId: string, pipelineId: string): Promise<Etapa[]> {
  const { data: stages, error } = await supabase
    .from("crm_stages")
    .select("id, name, position, is_won")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .eq("is_lost", false)
    .order("position");
  if (error) throw new Error(error.message);

  const { data: regras } = await supabase
    .from("meta_ads_conversion_rules")
    .select("stage_id, meta_event")
    .eq("organization_id", orgId)
    .eq("enabled", true);
  const eventoPorEtapa = new Map((regras ?? []).map((r) => [r.stage_id as string, r.meta_event as string]));

  return (stages ?? []).map((s) => ({
    id: s.id,
    nome: s.name,
    posicao: s.position,
    ganha: Boolean(s.is_won),
    eventoMeta: eventoPorEtapa.get(s.id) ?? (s.is_won ? "Purchase" : null),
  }));
}

async function lerAbertos(supabase: Cliente, orgId: string, etapas: string[]): Promise<Record<string, number>> {
  const contagens = await Promise.all(
    etapas.map(async (id) => {
      const { count, error } = await supabase
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

async function lerAtividades(
  supabase: Cliente,
  orgId: string,
  pipelineId: string,
  de: string,
  ate: string,
): Promise<AtividadeDeEtapa[]> {
  const mudancas = await lerTudo<{ performed_at: string; payload: Record<string, string> | null }>((a, b) =>
    supabase
      .from("crm_lead_activities")
      .select("performed_at, payload")
      .eq("organization_id", orgId)
      .eq("type", "stage_changed")
      .eq("payload->>pipeline_id", pipelineId)
      .gte("performed_at", de)
      .lt("performed_at", ate)
      .range(a, b),
  );
  const criados = await lerTudo<{ performed_at: string; crm_leads: { pipeline_id: string } | null }>((a, b) =>
    supabase
      .from("crm_lead_activities")
      .select("performed_at, crm_leads!inner(pipeline_id)")
      .eq("organization_id", orgId)
      .eq("type", "lead_created")
      .eq("crm_leads.pipeline_id", pipelineId)
      .gte("performed_at", de)
      .lt("performed_at", ate)
      .range(a, b) as never,
  );

  return [
    ...mudancas.map((m) => ({
      tipo: "stage_changed" as const,
      performedAt: m.performed_at,
      fromStageId: m.payload?.from_stage_id ?? null,
      toStageId: m.payload?.to_stage_id ?? null,
    })),
    ...criados.map((c) => ({ tipo: "lead_created" as const, performedAt: c.performed_at })),
  ];
}
