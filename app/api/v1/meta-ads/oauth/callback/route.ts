/**
 * GET /api/v1/meta-ads/oauth/callback — a volta do "Conectar com o Facebook".
 *
 * Confere o `state`, troca o `code` por token, troca esse por um de LONGA
 * duração (~60 dias), cifra e grava no mesmo lugar do token colado à mão
 * (`ad_insights_connections`). Irmã de
 * `app/api/v1/plataformas-de-anuncio/google/callback/route.ts`.
 *
 * É retorno de NAVEGADOR: todo desfecho volta, por ponte (ver `voltar`), para
 * `/app/settings/meta-ads` com `?erro=<código>` ou `?ok=1`, nunca JSON.
 *
 * ─── A ORDEM DOS PASSOS É CONTRATO ──────────────────────────────────────────
 * 1. `error` na query ANTES de tudo: "Cancelar" não é falha.
 * 2. `state` antes do `code`; depois dele, o cookie de vínculo (o navegador que
 *    volta é o que saiu), a régua de suporte e só então a queima do nonce.
 * 3. Troca do `code` DEPOIS do `state` confirmado e queimado: o `code` é de uso
 *    único e não se gasta antes de saber que o retorno é legítimo.
 * 4. Cifra ANTES do upsert: gravar em claro, nem por um instante.
 *
 * Nenhum token, `code` ou segredo vai para log ou para a URL de volta.
 */
import { NextResponse, type NextRequest } from "next/server";

import { NOME_DO_VINCULO, vinculoConfere } from "@/lib/agenda/google/vinculo";
import { audit } from "@/lib/audit";
import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { marcaDaSaida } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { supportCallbackWriteAllowed } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { appDeLoginDaMeta } from "@/lib/plataformas-de-anuncio/meta/login/app";
import { verificarEstado } from "@/lib/plataformas-de-anuncio/meta/login/estado";
import {
  CAMINHO_DO_CALLBACK,
  trocarCodigoPorToken,
  trocarPorTokenDeLongaDuracao,
  urlDeRetorno,
} from "@/lib/plataformas-de-anuncio/meta/login/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

/**
 * A volta é por PÁGINA-PONTE, não por redirect.
 *
 * O cookie de sessão do CRM é `SameSite=Strict` e não viaja numa navegação cuja
 * cadeia começou em `facebook.com`. Um 302 daqui para `/app/settings/meta-ads`
 * ainda pertence a essa cadeia: o `proxy.ts` não via a sessão e mandava a
 * pessoa para `/login?next=...`, embora a conexão já estivesse gravada. A ponte
 * devolve um HTML 200 no nosso origin; o `location.replace` de dentro dele é
 * iniciado por documento nosso (same-site) e o cookie viaja. Mesmo desenho do
 * Google (`app/api/v1/agenda/google/callback/route.ts`) e de
 * `lib/auth/ponte-de-volta.ts`. Não se afrouxa o cookie de sessão.
 */
async function voltar(base: string, params: Record<string, string>): Promise<NextResponse> {
  const url = new URL("/app/settings/meta-ads", base || "http://localhost:3000");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const marca = await marcaDaSaida(null);
  const ponte = respostaDePonte(
    `${url.pathname}${url.search}`,
    marca.nome,
    "Voltando para o Meta Ads…",
  );
  const resposta = new NextResponse(ponte.body, { status: ponte.status, headers: ponte.headers });
  // Toda saída passa por aqui: o vínculo morre com o fluxo, sucesso ou erro.
  // `Set-Cookie` vale igual num 200.
  resposta.cookies.set(NOME_DO_VINCULO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK,
    maxAge: 0,
  });
  return resposta;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = env.NEXT_PUBLIC_APP_URL;
  const url = new URL(req.url);

  // 1. Cancelar o login não é erro. Qualquer outra recusa da Meta vira
  // `meta_recusou`, e a tela explica a causa mais comum (acesso avançado).
  const recusa = url.searchParams.get("error");
  if (recusa) {
    return await voltar(base, { erro: recusa === "access_denied" ? "cancelado" : "meta_recusou" });
  }

  // 2. `state` antes do `code`. Sob `try`: a rota é pública e `verificarEstado`
  // lança com `INTERNAL_SECRET` curto — sem isto, 500.
  let estado: ReturnType<typeof verificarEstado>;
  try {
    estado = verificarEstado(url.searchParams.get("state"), {
      segredo: env.INTERNAL_SECRET,
      agora: new Date(),
    });
  } catch (erro) {
    logger.error("[meta-ads.oauth.callback] state não verificável", {
      motivo: erro instanceof Error ? erro.message : String(erro),
    });
    return await voltar(base, { erro: "estado_invalido" });
  }
  if (!estado) return await voltar(base, { erro: "estado_invalido" });

  if (!vinculoConfere(req.cookies.get(NOME_DO_VINCULO)?.value, estado.nonce, env.INTERNAL_SECRET)) {
    logger.warn("[meta-ads.oauth.callback] vínculo do navegador não confere", {
      organizationId: estado.organizationId,
    });
    return await voltar(base, { erro: "estado_invalido" });
  }

  const code = url.searchParams.get("code");
  if (!code) return await voltar(base, { erro: "sem_codigo" });

  if (!(await supportCallbackWriteAllowed(estado.organizationId, estado.userId, estado.authSessionId))) {
    return await voltar(base, { erro: "estado_invalido" });
  }

  const admin = createAdminClient();
  const app = appDeLoginDaMeta();
  if (!app) return await voltar(base, { erro: "app_nao_configurado" });

  // O retorno vale UMA vez. A tabela de nonces é a mesma do Google (a chave é o
  // nonce aleatório, não o provedor). Qualquer erro recusa: sem gravar não há
  // uso único a garantir.
  const { error: erroDoNonce } = await admin.from("calendar_oauth_nonces").insert({
    nonce: estado.nonce,
    organization_id: estado.organizationId,
    user_id: estado.userId,
    expira_em: new Date(estado.expiraEmMs).toISOString(),
  });
  if (erroDoNonce) return await voltar(base, { erro: "estado_invalido" });

  // 3. Código → token curto → token de longa duração.
  const agora = new Date();
  const curto = await trocarCodigoPorToken(app, code, { redirectUri: urlDeRetorno(base), agora });
  if (!curto.ok) {
    logger.error("[meta-ads.oauth.callback] troca de código falhou", {
      organizationId: estado.organizationId,
      motivo: curto.motivo,
    });
    return await voltar(base, { erro: curto.recursoIndisponivel ? "meta_recusou" : "troca_falhou" });
  }
  const longo = await trocarPorTokenDeLongaDuracao(app, curto.accessToken, { agora });
  if (!longo.ok) {
    logger.error("[meta-ads.oauth.callback] troca por token longo falhou", {
      organizationId: estado.organizationId,
      motivo: longo.motivo,
    });
    return await voltar(base, { erro: longo.recursoIndisponivel ? "meta_recusou" : "troca_falhou" });
  }

  // 4. Cifra antes do upsert.
  const cifrado = await encryptWebhookSecret(admin, longo.accessToken);
  if (!cifrado) return await voltar(base, { erro: "cifra_indisponivel" });

  // Sem `default_account_id` nos valores: o upsert mantém a conta padrão que a
  // pessoa já tinha escolhido.
  const { error } = await admin.from("ad_insights_connections").upsert(
    {
      organization_id: estado.organizationId,
      platform: "meta_ads",
      access_token_encrypted: cifrado,
      token_expires_at: longo.expiraEm.toISOString(),
      updated_by: estado.userId,
    },
    { onConflict: "organization_id,platform" },
  );
  if (error) {
    logger.error("[meta-ads.oauth.callback] upsert falhou", {
      organizationId: estado.organizationId,
      detalhe: error.message,
    });
    return await voltar(base, { erro: "erro_ao_gravar" });
  }

  await audit({
    action: "ad_insights_connection.updated",
    actorUserId: estado.userId,
    organizationId: estado.organizationId,
    resourceType: "ad_insights_connections",
    resourceId: null,
    // O QUE mudou, jamais o token.
    metadata: { platform: "meta_ads", via: "login_com_facebook", token_trocado: true },
  });

  return await voltar(base, { ok: "1" });
}
