/**
 * GET /api/v1/conversions/export-leads — CSV de leads com a origem do anúncio.
 *
 * `?periodo=hoje|24h|7d|30d|tudo` (padrão 30d). `admin`: o arquivo leva nome e
 * telefone. Lê em páginas de 1.000 até o teto e avisa no cabeçalho se cortou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { csvDeLeads, lerLeadsParaExportar, type LinhaDeLead } from "@/lib/conversoes/exportar-leads";
import { lerFiltros } from "@/lib/conversoes/historico";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TAMANHO_DA_PAGINA = 1000;
const TETO_DO_EXPORT = 10_000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "conversions",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const { periodo } = lerFiltros(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const admin = createAdminClient();

  const linhas: LinhaDeLead[] = [];
  let total = 0;
  try {
    for (let pagina = 1; linhas.length < TETO_DO_EXPORT; pagina++) {
      const lote = await lerLeadsParaExportar(admin, orgId, periodo, pagina, TAMANHO_DA_PAGINA);
      total = lote.total;
      linhas.push(...lote.linhas);
      if (lote.linhas.length === 0 || linhas.length >= total) break;
    }
  } catch {
    return fail("internal_error", t("Não foi possível ler os leads."), 500, { requestId });
  }

  const cortado = total > linhas.length;
  await audit({
    organizationId: orgId,
    actorUserId: authz.user.id,
    action: "conversion.exported",
    resourceType: "crm_leads",
    requestId,
    metadata: { tipo: "leads", linhas: linhas.length, total, cortado, periodo },
  });

  return new Response(csvDeLeads(linhas), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Request-Id": requestId,
      ...(cortado ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
