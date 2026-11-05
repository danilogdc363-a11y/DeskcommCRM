/**
 * GET /api/v1/meta-ads/oauth/connect — começa o "Conectar com o Facebook" da
 * tela Configurações › Meta Ads.
 *
 * Manda o admin ao consentimento da Meta (escopo só `ads_read`) com um `state`
 * assinado que carrega a ORGANIZAÇÃO. Irmã de
 * `app/api/v1/plataformas-de-anuncio/google/connect/route.ts`: grava o mesmo
 * cookie de vínculo, restrito ao caminho do callback, que prova na volta que o
 * navegador é o que saiu.
 *
 * Piso de papel `admin` (o mesmo da página e da ação do token colado). Todo
 * desfecho de erro volta à tela com `?erro=<código>`, nunca JSON: este endereço
 * é aberto pelo navegador, num clique de botão.
 */
import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { assinarVinculo, NOME_DO_VINCULO, VALIDADE_DO_VINCULO_S } from "@/lib/agenda/google/vinculo";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { authenticatedSessionId, requireSupportWrite } from "@/lib/impersonate/support";
import { appDeLoginDaMeta } from "@/lib/plataformas-de-anuncio/meta/login/app";
import { emitirEstado } from "@/lib/plataformas-de-anuncio/meta/login/estado";
import {
  CAMINHO_DO_CALLBACK,
  montarUrlDeLogin,
  urlDeRetorno,
} from "@/lib/plataformas-de-anuncio/meta/login/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";

function voltarComErro(codigo: string): NextResponse {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL(`/app/settings/meta-ads?erro=${codigo}`, base));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = req.headers.get("x-request-id") ?? undefined;

  const autorizado = await requireRole("admin", { requestId, resource: "ad_insights_connections" });
  if (!autorizado.ok) return autorizado.response;
  const { user, org } = autorizado;

  const app = await appDeLoginDaMeta(createAdminClient());
  if (!app) return voltarComErro("app_nao_configurado");

  // O nonce é usado duas vezes: dentro do `state` e na assinatura do cookie de
  // vínculo — o par que o callback confere.
  const nonce = randomBytes(16).toString("base64url");

  let state: string;
  try {
    state = emitirEstado(
      { organizationId: org.orgId, userId: user.id, authSessionId: await authenticatedSessionId() },
      { segredo: env.INTERNAL_SECRET, agora: new Date(), nonce },
    );
  } catch {
    return voltarComErro("estado_invalido");
  }

  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const resposta = NextResponse.redirect(montarUrlDeLogin(app, { state, redirectUri: urlDeRetorno(base) }));
  // `lax`: strict não viaja na volta da Meta. `cookieSecure()` e não `true`
  // literal, para não perder o cookie numa instalação servida por http.
  resposta.cookies.set(NOME_DO_VINCULO, assinarVinculo(nonce, env.INTERNAL_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK,
    maxAge: VALIDADE_DO_VINCULO_S,
  });
  return resposta;
}
