/**
 * (Acelera) GET /api/v1/meta-ads/formularios/paginas/[pageId]/verificar —
 * pergunta à Meta se a Página ainda manda os avisos de formulário para o app.
 * Só lê; não muda nada.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { verificarPagina } from "@/lib/leads/lead-ads/conexao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const { pageId } = await ctx.params;
  if (!/^\d{1,32}$/.test(pageId)) return fail("validation_failed", "Página inválida.", 422, { requestId });
  const r = await verificarPagina(createAdminClient(), { organizationId: authz.org.orgId, pageId });
  if (!r.ok) return fail(r.codigo, r.mensagem, r.status, { requestId, details: r.detalhe });
  return ok({ mensagem: r.mensagem }, { requestId });
}
