/**
 * GET /api/v1/conversations/[id]/eventos-do-lead — ACELERA (só do fork).
 *
 * O negócio aberto do contato e, para cada evento, a etapa que o envia e o
 * resultado no livro-razão. Só leitura: quem move o card é a rota de lote de sempre.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import {
  leadDaConversa,
  opcoesDeEvento,
  type EtapaDoFunil,
  type OrigemDoLead,
  type RegistroDoEvento,
} from "@/lib/acelera/eventos-da-conversa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MOTIVO_LEGIVEL } from "@/lib/conversoes/estado-da-conexao";
import { lerAtribuicao } from "@/lib/conversoes/leitura-da-atribuicao";
import { listarRegrasMeta } from "@/lib/conversoes/regras-meta";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const organizationId = authz.org.orgId;
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversa } = await supabase
    .from("conversations")
    .select("contact_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!conversa) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const { data: abertos, error: erroDosLeads } = await supabase
    .from("crm_leads")
    .select("id, title, pipeline_id, stage_id")
    .eq("organization_id", organizationId)
    .eq("contact_id", conversa.contact_id)
    .eq("status", "open")
    .order("updated_at", { ascending: false });
  if (erroDosLeads) return fail("internal_error", t("Falha ao ler o lead."), 500, { requestId });

  const lead = leadDaConversa(
    (abertos ?? []) as Array<{ id: string; title: string; pipeline_id: string; stage_id: string }>,
  );
  if (!lead) return ok({ lead: null, opcoes: [] }, { requestId });

  try {
    const admin = createAdminClient();
    const [etapas, regras, registros, leitura] = await Promise.all([
      admin
        .from("crm_stages")
        .select("id, name, position, is_won, is_lost")
        .eq("organization_id", organizationId)
        .eq("pipeline_id", lead.pipeline_id)
        .eq("is_archived", false),
      listarRegrasMeta(admin, organizationId),
      admin
        .from("ad_conversion_dispatches")
        .select("event_name, status, reason, detail, attempted_at")
        .eq("organization_id", organizationId)
        .eq("lead_id", lead.id),
      lerAtribuicao(admin, organizationId, conversa.contact_id),
    ]);
    if (etapas.error || registros.error) throw new Error("leitura");
    const origem: OrigemDoLead = !leitura.temAtribuicao
      ? "nenhuma"
      : leitura.atribuicao.plataforma === "meta_ads"
        ? "meta"
        : "outra";
    const opcoes = opcoesDeEvento({
      etapas: (etapas.data ?? []) as EtapaDoFunil[],
      etapaAtualId: lead.stage_id,
      regras,
      registros: (registros.data ?? []) as RegistroDoEvento[],
      origem,
    }).map((o) => ({
      ...o,
      bloqueio: o.bloqueio ? t(o.bloqueio) : null,
      motivoLegivel: o.registro?.motivo
        ? t(MOTIVO_LEGIVEL[o.registro.motivo] ?? o.registro.detalhe ?? o.registro.motivo)
        : null,
    }));
    return ok({ lead, opcoes }, { requestId });
  } catch {
    return fail("internal_error", t("Falha ao ler os eventos do lead."), 500, { requestId });
  }
}
