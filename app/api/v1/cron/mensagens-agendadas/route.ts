/**
 * GET/POST /api/v1/cron/mensagens-agendadas — ACELERA (só do fork).
 *
 * Envia as mensagens agendadas vencidas pelo mesmo handler do composer, como a
 * pessoa que agendou. As regras e a trava moram em `lib/acelera/mensagens-agendadas.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { rodarMensagensAgendadas, type EnviarAgendada } from "@/lib/acelera/mensagens-agendadas";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import type { SendMessageInput } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const enviar: EnviarAgendada = (envio) =>
    sendMessageHandler(
      admin,
      {
        organization_id: envio.organizationId,
        actor: { type: "user", id: envio.autorId },
        requestId,
        internalMessageId: envio.agendamentoId,
      },
      {
        conversation_id: envio.conversationId,
        type: "text",
        body: envio.corpo,
        metadata: { mensagem_agendada_id: envio.agendamentoId },
      } as SendMessageInput,
    );

  try {
    const resultado = await rodarMensagensAgendadas(admin, new Date(), enviar);
    if (resultado.enviadas + resultado.falhas + resultado.destravadas > 0) {
      void audit({
        action: "conversation.mensagens_agendadas_run",
        organizationId: null,
        bypassedRls: true,
        metadata: { ...resultado },
        requestId,
      });
    }
    return ok(resultado, { requestId });
  } catch (erro) {
    logger.error("[mensagens-agendadas] rodada falhou", {
      error: erro instanceof Error ? erro.message : String(erro),
      requestId,
    });
    return fail("internal_error", "Falha ao rodar mensagens agendadas.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
