/**
 * (Acelera) GET|POST /api/v1/webhooks/lead-ads — o aviso `leadgen` da Meta:
 * formulário nativo do Instagram/Facebook, para QUALQUER empresa.
 *
 * Uma URL só para todas as empresas. De quem é o lead decide a Página
 * (`entry[].id` do aviso → `webhook_sources.meta_page_id`, que cada empresa liga
 * em Configurações › Meta Ads). O `organization_id` NUNCA vem do corpo: vem da
 * fonte que reivindica a Página.
 *
 * - GET: a conferência da URL pela Meta. Responde o desafio em texto puro quando
 *   o `hub.verify_token` é o derivado do segredo do app (`verificacao.ts`).
 * - POST: assinatura `x-hub-signature-256` com o segredo do app, em falha
 *   fechada, ANTES de qualquer leitura de banco. Cada lead é recebido por conta
 *   própria (`receber.ts`): um que falha não segura os outros. Página sem dona e
 *   lead que não entra respondem 200 (a Meta reenviaria para sempre algo que
 *   não melhora); só falha NOSSA responde 500, e a reentrega é segura porque o
 *   `leadgen_id` é único por empresa.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ApiError } from "@/lib/api/types";
import { appDaMeta } from "@/lib/channels/meta/app";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { CABECALHO_DA_ASSINATURA_DA_META, assinaturaDaMetaConfere, idadeDoSinal } from "@/lib/leads/lead-ads/assinatura";
import { lerLeadsDoFormularioMeta } from "@/lib/leads/lead-ads/payload";
import {
  COLUNAS_DA_FONTE_DA_PAGINA,
  fonteDaPagina,
  receberLead,
  type FonteDaPagina,
} from "@/lib/leads/lead-ads/receber";
import { verifyTokenConfere } from "@/lib/leads/lead-ads/verificacao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O formulário da Meta é pequeno; 1 MB é folga larga. */
const LIMITE_DO_CORPO = 1_048_576;
/** Teto por minuto para a instalação inteira (todas as empresas dividem a URL). */
const ENTREGAS_POR_MINUTO = 600;

/**
 * Os segredos de app em que esta rota confia: o do AMBIENTE (`META_APP_SECRET`,
 * o app do login, que é quem cadastra e assina este webhook) e o `appDaMeta()`
 * (banco primeiro: o da tela Admin → Meta, do canal oficial). Quando são o mesmo
 * app, são iguais; se alguém gravou na tela o segredo de OUTRO app, aceitar só o
 * do banco recusaria toda entrega e a conferência da URL pela Meta.
 */
async function segredosDoApp(): Promise<string[]> {
  const { appSecret } = await appDaMeta();
  const doAmbiente = process.env.META_APP_SECRET?.trim();
  return [...new Set([doAmbiente, appSecret].filter((s): s is string => Boolean(s)))];
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const segredos = await segredosDoApp();
  if (
    q.get("hub.mode") === "subscribe" &&
    segredos.some((segredo) => verifyTokenConfere(q.get("hub.verify_token"), segredo))
  ) {
    return new NextResponse(q.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  if (Number(req.headers.get("content-length") ?? "0") > LIMITE_DO_CORPO) {
    return new NextResponse(null, { status: 413 });
  }
  const corpo = await req.text();
  if (Buffer.byteLength(corpo, "utf8") > LIMITE_DO_CORPO) return new NextResponse(null, { status: 413 });

  // A assinatura vem PRIMEIRO, sobre o corpo CRU: corpo de quem não se
  // autenticou não é lido nem interpretado. O segredo é o do app (banco, senão
  // META_APP_SECRET).
  const segredos = await segredosDoApp();
  const cabecalho = req.headers.get(CABECALHO_DA_ASSINATURA_DA_META);
  const recusas = (segredos.length > 0 ? segredos : [null]).map((segredo) =>
    assinaturaDaMetaConfere(corpo, cabecalho, segredo),
  );
  if (!recusas.some((r) => r === null)) {
    logger.warn("[lead-ads] entrega recusada na assinatura", { request_id: requestId, motivo: recusas[0] });
    return new NextResponse(null, { status: 401 });
  }

  const limite = await checkRateLimit("meta_lead_ads:instalacao", ENTREGAS_POR_MINUTO, 60);
  if (!limite.allowed) return new NextResponse(null, { status: 429, headers: { "Retry-After": "60" } });

  const leitura = lerLeadsDoFormularioMeta(corpo);
  if (!leitura.ok) return new NextResponse(null, { status: 400 });

  const admin = createAdminClient();
  const paginas = [...new Set(leitura.leads.map((l) => l.pageId).filter((p): p is string => Boolean(p)))];
  const donas = new Map<string, FonteDaPagina>();
  if (paginas.length > 0) {
    // Sem filtro de `is_active`: a fonte pausada precisa ser achada para o lead
    // ser registrado como "fonte pausada" em vez de sumir como "sem dona".
    const { data, error } = await admin
      .from("webhook_sources")
      .select(COLUNAS_DA_FONTE_DA_PAGINA)
      .in("meta_page_id", paginas);
    if (error) {
      logger.error("[lead-ads] fontes das páginas não puderam ser lidas", {
        request_id: requestId,
        error_code: error.code,
      });
      return new NextResponse(null, { status: 500 });
    }
    for (const linha of (data ?? []) as unknown as Record<string, unknown>[]) {
      const fonte = fonteDaPagina(linha);
      if (fonte.pageId) donas.set(fonte.pageId, fonte);
    }
  }

  for (const d of leitura.descartados) {
    logger.warn("[lead-ads] lead ignorado antes da escrita", {
      request_id: requestId,
      leadgen_id: d.leadgenId,
      motivo: d.motivo,
    });
  }

  const agora = new Date();
  const tokens = new Map<string, string | null>();
  let falhaNossa = false;
  const processar = async (lead: (typeof leitura.leads)[number]) => {
    const fonte = lead.pageId ? donas.get(lead.pageId) : undefined;
    if (!fonte) {
      // Página que nenhuma empresa ligou: não é de ninguém. Fica só no log.
      logger.warn("[lead-ads] lead ignorado antes da escrita", {
        request_id: requestId,
        leadgen_id: lead.leadgenId,
        motivo: "pagina_sem_dona",
      });
      return;
    }
    const idade = idadeDoSinal(lead.entradaEm, agora);
    try {
      await receberLead(admin, fonte, lead, {
        requestId,
        tokens,
        atrasoSegundos: idade.atrasada ? idade.segundos : null,
      });
    } catch (erro) {
      // ApiError = o card não pôde nascer (funil/etapa apagados, régua): já está
      // em "Leads recebidos" com o motivo, e reenviar não conserta. Só o resto é falha nossa.
      if (erro instanceof ApiError) return;
      falhaNossa = true;
      logger.error("[lead-ads] importação falhou", {
        request_id: requestId,
        webhook_source_id: fonte.id,
        leadgen_id: lead.leadgenId,
        motivo: erro instanceof Error ? erro.message.slice(0, 160) : "desconhecido",
      });
    }
  };
  // Em paralelo: o lote cabe no tempo do webhook da Meta.
  await Promise.all(leitura.leads.map(processar));

  return new NextResponse(null, { status: falhaNossa ? 500 : 200 });
}
