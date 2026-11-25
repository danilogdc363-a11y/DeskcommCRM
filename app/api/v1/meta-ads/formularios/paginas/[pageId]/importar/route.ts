/**
 * (Acelera) POST /api/v1/meta-ads/formularios/paginas/[pageId]/importar —
 * "Trazer leads antigos" de uma Página já ligada: { dias: 7 | 30 | 90 }.
 *
 * Entra pelo MESMO caminho do aviso (`receber.ts`), deduplicando por
 * `leadgen_id`: clicar de novo não duplica, e continua de onde parou quando o
 * lote passa do limite de um clique. Não avisa ninguém.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { importarLeadsAntigos } from "@/lib/leads/lead-ads/conexao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({ dias: z.union([z.literal(7), z.literal(30), z.literal(90)]) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const apoio = await requireSupportWrite();
  if (apoio) return apoio;
  const authz = await requireRole("admin", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const limite = await checkRateLimit(`meta_formularios_importar:${authz.org.orgId}`, 6, 60);
  if (!limite.allowed) return fail("rate_limited", "Muitos pedidos. Espere um minuto.", 429, { requestId, headers: { "Retry-After": "60" } });

  const { pageId } = await ctx.params;
  if (!/^\d{1,32}$/.test(pageId)) return fail("validation_failed", "Página inválida.", 422, { requestId });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Escolha 7, 30 ou 90 dias.", 422, { requestId });

  const r = await importarLeadsAntigos(createAdminClient(), {
    organizationId: authz.org.orgId,
    pageId,
    dias: parsed.data.dias,
    requestId,
  });
  if (!r.ok) return fail(r.codigo, r.mensagem, r.status, { requestId });
  return ok(
    {
      encontrados: r.encontrados,
      entraram: r.entraram,
      ja_existiam: r.jaExistiam,
      ignorados: r.ignorados,
      falharam: r.falharam,
      parou_no_limite: r.parouNoLimite,
    },
    { requestId },
  );
}
