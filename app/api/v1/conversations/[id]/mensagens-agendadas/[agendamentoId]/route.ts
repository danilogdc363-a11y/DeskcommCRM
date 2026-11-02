import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * DELETE /api/v1/conversations/[id]/mensagens-agendadas/[agendamentoId] — cancela.
 * ACELERA (só do fork). O filtro por `pendente` disputa com a trava do relógio:
 * quem chegar primeiro ganha, e o perdedor recebe 409 em vez de um sucesso falso.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, noContent } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; agendamentoId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id, agendamentoId } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mensagens_agendadas")
    .update({
      status: "cancelada",
      cancelado_por: authz.user.id,
      concluida_em: new Date().toISOString(),
    })
    .eq("id", agendamentoId)
    .eq("organization_id", authz.org.orgId)
    .eq("conversation_id", id)
    .eq("status", "pendente")
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", t("Não foi possível cancelar."), 500, { requestId });
  if (!data) {
    return fail("agendamento_nao_pendente", t("Esta mensagem já saiu ou já foi cancelada."), 409, {
      requestId,
    });
  }
  await audit({
    action: "conversation.mensagem_agendada_cancelada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
  });
  return noContent(requestId);
}
