/**
 * GET /api/v1/conversions/export — CSV do histórico de envios de conversão.
 *
 * Mesmos filtros da tela (`periodo`, `situacao`, `evento`, `plataforma`,
 * `busca`). `admin`, como a tela de Conversões: o arquivo leva nome de negócio.
 * Lê em páginas de 1.000 até o teto, e avisa no cabeçalho quando o teto cortou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { csvDeConversoes } from "@/lib/conversoes/exportar-csv";
import { lerFiltros, lerHistorico, type LinhaDoHistorico } from "@/lib/conversoes/historico";
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
    allowPlatformAdmin: "leitura",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const filtros = lerFiltros(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const admin = createAdminClient();

  const linhas: LinhaDoHistorico[] = [];
  let total = 0;
  try {
    for (let pagina = 1; linhas.length < TETO_DO_EXPORT; pagina++) {
      const lote = await lerHistorico(
        admin,
        orgId,
        { ...filtros, pagina },
        new Date(),
        TAMANHO_DA_PAGINA,
      );
      total = lote.total;
      linhas.push(...lote.linhas);
      if (lote.linhas.length === 0 || linhas.length >= total) break;
    }
  } catch {
    return fail("internal_error", t("Não foi possível ler o histórico de envios."), 500, {
      requestId,
    });
  }

  const cortado = total > linhas.length;
  await audit({
    organizationId: orgId,
    actorUserId: authz.user.id,
    action: "conversion.exported",
    resourceType: "ad_conversion_dispatches",
    requestId,
    metadata: { linhas: linhas.length, total, cortado, periodo: filtros.periodo },
  });

  return new Response(csvDeConversoes(linhas), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="conversoes-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Request-Id": requestId,
      ...(cortado ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
