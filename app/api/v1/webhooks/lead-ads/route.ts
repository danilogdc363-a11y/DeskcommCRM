/**
 * (Acelera) Aviso `leadgen` da Meta: formulário nativo do Instagram/Facebook.
 * GET é a verificação da assinatura do webhook; POST importa os leads avisados.
 * A falha responde 500 para a Meta reenviar; a captação deduplica por `external_id`.
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  assinaturaDaMetaConfere,
  idsDeLeadDoAviso,
  importarLeadDaMeta,
} from "@/lib/acelera/lead-ads";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const esperado = process.env.ACELERA_LEADS_VERIFY_TOKEN;
  if (esperado && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === esperado) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(req: NextRequest) {
  const segredo = process.env.ACELERA_LEADS_APP_SECRET;
  const corpo = await req.text();
  if (!segredo || !assinaturaDaMetaConfere(corpo, req.headers.get("x-hub-signature-256"), segredo)) {
    return new NextResponse(null, { status: 401 });
  }

  let aviso: unknown;
  try {
    aviso = JSON.parse(corpo);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  try {
    for (const id of idsDeLeadDoAviso(aviso)) await importarLeadDaMeta(id);
  } catch (erro) {
    logger.error("[acelera.lead-ads] importação falhou", {
      motivo: erro instanceof Error ? erro.message : "desconhecido",
    });
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
