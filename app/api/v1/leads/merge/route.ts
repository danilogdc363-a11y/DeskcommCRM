import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/leads/merge — "Unificar fichas": junta 2+ negócios num principal.
 *
 * ACELERA (fork). A regra mora em `fn_mesclar_negocios` (migration acelera 0008),
 * pelo mesmo motivo da fusão de contatos: trava, reponta toda FK pelo catálogo e
 * escreve a lápide numa transação só. Esta rota autoriza (gestor), valida, chama
 * e audita. Com `preview: true` a função só conta — nada é escrito nem auditado.
 *
 * Cliente do USUÁRIO (cookie), não o admin: `auth.uid()` chega à função, que
 * reconfere o papel e grava quem unificou.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { leadsMergeSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DESFECHOS: Record<string, { code: string; status: number; message: string }> = {
  insufficient_role: {
    code: "forbidden_role",
    status: 403,
    message: "Unificar fichas exige papel de gerente ou acima.",
  },
  selecao_de_mesclagem_invalida: {
    code: "validation_failed",
    status: 422,
    message: "Seleção inválida: escolha um negócio principal e ao menos um a ser absorvido.",
  },
  secundario_repetido: {
    code: "validation_failed",
    status: 422,
    message: "O mesmo negócio aparece duas vezes na seleção.",
  },
  negocio_principal_indisponivel: {
    code: "not_found",
    status: 404,
    message: "O negócio principal não está disponível — ele pode já ter sido unificado em outro.",
  },
  negocio_secundario_indisponivel: {
    code: "not_found",
    status: 404,
    message: "Um dos negócios selecionados não está disponível — ele pode já ter sido unificado em outro.",
  },
  contato_principal_indisponivel: {
    code: "not_found",
    status: 404,
    message: "O contato do negócio principal não está disponível (anonimizado ou já unificado).",
  },
  contato_secundario_indisponivel: {
    code: "not_found",
    status: 404,
    message: "O contato de um dos negócios não está disponível (anonimizado ou já unificado).",
  },
};

export interface ResultadoDaUnificacao {
  previa: boolean;
  negocio_id: string;
  negocios_mesclados: string[];
  contatos_a_juntar: string[];
  /** `tabela.coluna` → quantas linhas passam (ou passariam) para o principal. */
  repontado: Record<string, number>;
  nao_repontado: Record<string, number>;
  tags_novas?: string[];
  campos_novos?: string[];
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let input;
  try {
    input = await validateRequest(leadsMergeSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mesclar_negocios", {
    p_organization_id: org.orgId,
    p_negocio_principal: input.primary_lead_id,
    p_negocios_secundarios: input.secondary_lead_ids,
    p_previa: input.preview ?? false,
  });

  if (error) {
    const bruto = error.message ?? "";
    const chave = Object.keys(DESFECHOS).find((k) => bruto.includes(k));
    const previsto = chave ? DESFECHOS[chave] : undefined;
    if (previsto) {
      return fail(previsto.code, previsto.message, previsto.status, { requestId });
    }
    console.error("[leads/merge] fn_mesclar_negocios falhou", { requestId, code: error.code });
    return fail("internal_error", "Não deu para unificar agora. Nada foi alterado.", 500, {
      requestId,
    });
  }

  const resultado = data as unknown as ResultadoDaUnificacao;

  if (!resultado.previa) {
    await audit({
      action: "lead.merged",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "lead",
      resourceId: input.primary_lead_id,
      requestId,
      metadata: {
        merged_lead_ids: input.secondary_lead_ids,
        merged_contact_ids: resultado.contatos_a_juntar,
        repointed: resultado.repontado,
        not_repointed: resultado.nao_repontado,
      },
    });
  }

  return ok(resultado, { requestId });
}
