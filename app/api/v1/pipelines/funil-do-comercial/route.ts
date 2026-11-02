/**
 * GET /api/v1/pipelines/funil-do-comercial — ACELERA (só do fork).
 *
 * O funil de Orçamentos e suas etapas para o "+ Criar lead" da conversa, ou
 * `null` quando esta organização não o tem (a tela cai no funil padrão). Existe
 * porque a leitura de etapas por id exige gerente, e quem atende é atendente.
 */
import { randomUUID } from "node:crypto";

import { FUNIL_DE_ORCAMENTOS_ID } from "@/lib/acelera/eventos-da-conversa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "pipelines" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data: pipeline, error } = await supabase
    .from("crm_pipelines")
    .select("*")
    .eq("id", FUNIL_DE_ORCAMENTOS_ID)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!pipeline) return ok(null, { requestId });

  const { data: stages, error: erroDasEtapas } = await supabase
    .from("crm_stages")
    .select("*")
    .eq("organization_id", authz.org.orgId)
    .eq("pipeline_id", FUNIL_DE_ORCAMENTOS_ID)
    .eq("is_archived", false)
    .order("position");
  if (erroDasEtapas) return fail("internal_error", erroDasEtapas.message, 500, { requestId });
  return ok({ pipeline, stages: stages ?? [] }, { requestId });
}
