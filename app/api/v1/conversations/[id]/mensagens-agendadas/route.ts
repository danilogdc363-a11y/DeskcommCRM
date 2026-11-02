import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/conversations/[id]/mensagens-agendadas — pendentes e falhas recentes.
 * POST /api/v1/conversations/[id]/mensagens-agendadas — agenda (dia e hora em São Paulo).
 * ACELERA (só do fork).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import {
  criarAgendamentoSchema,
  instanteDoAgendamento,
  recusaDoInstante,
} from "@/lib/acelera/mensagens-agendadas";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS = "id, corpo, enviar_em, status, motivo_falha, concluida_em";
const FALHA_VISIVEL_POR_MS = 3 * 24 * 60 * 60 * 1000;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const supabase = await createClient();
  const desde = new Date(Date.now() - FALHA_VISIVEL_POR_MS).toISOString();
  const { data, error } = await supabase
    .from("mensagens_agendadas")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .eq("conversation_id", id)
    .or(`status.in.(pendente,enviando),and(status.eq.falhou,concluida_em.gte.${desde})`)
    .order("enviar_em", { ascending: true });
  if (error) {
    return fail("internal_error", traduzir("Falha ao listar agendamentos.", authz.user.idioma), 500, {
      requestId,
    });
  }
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;

  const parsed = criarAgendamentoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Escreva a mensagem e escolha dia e hora."), 422, {
      requestId,
    });
  }
  const instante = instanteDoAgendamento(parsed.data.dia, parsed.data.hora);
  const recusa = recusaDoInstante(instante, new Date());
  if (recusa || !instante) {
    return fail("agendamento_invalido", t(recusa ?? "Data ou hora inválida."), 422, { requestId });
  }

  const supabase = await createClient();
  const { data: conversa, error: erroDaConversa } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (erroDaConversa) {
    return fail("internal_error", t("Falha ao ler a conversa."), 500, { requestId });
  }
  if (!conversa) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const { data, error } = await supabase
    .from("mensagens_agendadas")
    .insert({
      organization_id: authz.org.orgId,
      conversation_id: id,
      corpo: parsed.data.corpo,
      enviar_em: instante.toISOString(),
      criado_por: authz.user.id,
    })
    .select(COLUNAS)
    .single();
  if (error || !data) {
    return fail("internal_error", t("Não foi possível agendar a mensagem."), 500, { requestId });
  }
  await audit({
    action: "conversation.mensagem_agendada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
  });
  return ok(data, { status: 201, requestId });
}
