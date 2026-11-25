/**
 * (Acelera) /api/v1/meta-ads/formularios/paginas — as Páginas de formulário de
 * anúncio da empresa ativa.
 *
 * GET    lista as Páginas da pessoa (Meta) e quais já estão ligadas.
 * POST   liga uma Página: { page_id, pipeline_id, stage_id }.
 * DELETE desliga: { page_id }.
 *
 * Piso `admin` (a mesma credencial da tela Meta Ads). A empresa vem da SESSÃO,
 * nunca do corpo. O token da Página é lido da Meta no servidor e gravado
 * cifrado: não passa pelo navegador nem volta em resposta nenhuma.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { conectarPagina, desconectarPagina, listarPaginasDaEmpresa } from "@/lib/leads/lead-ads/conexao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ID_DE_PAGINA = z.string().regex(/^\d{1,32}$/);
const ligarSchema = z.object({
  page_id: ID_DE_PAGINA,
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
});
const desligarSchema = z.object({ page_id: ID_DE_PAGINA });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const lista = await listarPaginasDaEmpresa(createAdminClient(), authz.org.orgId);
  return ok(lista, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const apoio = await requireSupportWrite();
  if (apoio) return apoio;
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const limite = await checkRateLimit(`meta_formularios:${authz.org.orgId}`, 20, 60);
  if (!limite.allowed) return fail("rate_limited", "Muitos pedidos. Espere um minuto.", 429, { requestId, headers: { "Retry-After": "60" } });

  const parsed = ligarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Escolha a Página, o funil e a etapa.", 422, { requestId });

  const r = await conectarPagina(createAdminClient(), {
    organizationId: authz.org.orgId,
    userId: authz.user.id,
    pageId: parsed.data.page_id,
    funilId: parsed.data.pipeline_id,
    etapaId: parsed.data.stage_id,
    baseDoApp: env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    requestId,
  });
  if (!r.ok) return fail(r.codigo, r.mensagem, r.status, { requestId, details: r.detalhe });
  return ok({ fonte_id: r.fonteId, aviso_do_app: r.avisoDoApp }, { requestId, status: 201 });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const apoio = await requireSupportWrite();
  if (apoio) return apoio;
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;

  const parsed = desligarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Informe a Página.", 422, { requestId });

  const r = await desconectarPagina(createAdminClient(), {
    organizationId: authz.org.orgId,
    userId: authz.user.id,
    pageId: parsed.data.page_id,
    requestId,
  });
  if (!r.ok) return fail(r.codigo, r.mensagem, r.status, { requestId, details: r.detalhe });
  return ok({ desligada: true }, { requestId });
}
