/**
 * O app da Meta que faz o LOGIN com o Facebook — App ID e App Secret da
 * INSTALAÇÃO.
 *
 * É o mesmo app que o WhatsApp oficial já usa (`lib/channels/meta/app.ts`): o
 * App Secret é a mesma coluna (`platform_meta_app.app_secret_encrypted`) e o
 * App ID entrou na migration acelera_0005.
 *
 * BANCO PRIMEIRO, `.env` COMO PISO (`META_APP_ID` + `META_APP_SECRET`), pela
 * mesma razão do irmão: o rollback de imagem do kit não desfaz o schema. O par
 * é servido INTEIRO e da MESMA origem — ID de um app com segredo de outro é um
 * login que a Meta recusa sem dizer por quê.
 *
 * Nunca lança: a tela precisa abrir mesmo com o banco ruim, e o desfecho de
 * "não configurado" já é tratado por quem chama.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface AppDeLoginDaMeta {
  readonly appId: string;
  readonly appSecret: string;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** O par do `.env`. Puro e síncrono. */
export function appDeLoginDoAmbiente(
  source: Record<string, string | undefined> = process.env,
): AppDeLoginDaMeta | null {
  const appId = texto(source.META_APP_ID);
  const appSecret = texto(source.META_APP_SECRET);
  return appId && appSecret ? { appId, appSecret } : null;
}

export async function appDeLoginDaMeta(
  admin: SupabaseClient,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<AppDeLoginDaMeta | null> {
  try {
    const { data, error } = await admin
      .from("platform_meta_app")
      .select("app_id, app_secret_encrypted")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      // Clone sem a migration (42703/42P01): o `.env` assume.
      logger.info("[meta.login.app] sem app no banco; vale o .env", { codigo: error.code });
    } else if (data) {
      const linha = data as { app_id: string | null; app_secret_encrypted: string | null };
      const appId = texto(linha.app_id);
      const cifrado = texto(linha.app_secret_encrypted);
      if (appId && cifrado) {
        const appSecret = texto(await decryptWebhookSecret(admin, cifrado));
        if (appSecret) return { appId, appSecret };
        logger.warn("[meta.login.app] segredo do banco não decifrou; vale o .env inteiro");
      }
    }
  } catch (err) {
    logger.warn("[meta.login.app] leitura do banco falhou; vale o .env", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return appDeLoginDoAmbiente(ambiente);
}
