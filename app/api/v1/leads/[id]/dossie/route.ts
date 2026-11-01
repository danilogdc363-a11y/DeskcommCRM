/**
 * (Acelera) GET /api/v1/leads/[id]/dossie — o dossiê do lead para o Acelera OS.
 *
 * Sessão de navegador OU Bearer `dsk_…` com `mcp:read` (`lib/api/auth-dual.ts`):
 * o OS lê por servidor quando o lead entra em "Fechou". A org sai da linha do
 * token, nunca da URL. Lead de outra org vira 404.
 *
 * LGPD: o corpo das mensagens não vai para log — só ids no erro.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { lerDossieDoLead } from "@/lib/acelera/dossie-do-lead";
import { resolveAuthDual } from "@/lib/api/auth-dual";
import { fail, ok } from "@/lib/api/wrappers";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "agent",
    scope: "mcp:read",
  });
  if (!authz.ok) return authz.response;

  const { id: leadId } = await ctx.params;
  if (!z.uuid().safeParse(leadId).success) {
    return fail("not_found", "Lead não encontrado.", 404, { requestId });
  }

  const dossie = await lerDossieDoLead(authz.supabase, authz.organizationId, leadId);
  if (!dossie) return fail("not_found", "Lead não encontrado.", 404, { requestId });
  return ok(dossie, { requestId });
}
