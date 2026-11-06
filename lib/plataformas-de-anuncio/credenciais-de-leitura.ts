/**
 * A credencial de LEITURA da organização — lida e decifrada.
 *
 * Irmã de `credenciais.ts`, que faz o mesmo para o eixo de conversões. As duas
 * existem separadas porque as tabelas são separadas, e as tabelas são separadas
 * pelas quatro razões no cabeçalho da migration 0214 — a primeira delas sendo
 * que o índice único da 0213 é `(organization_id, platform)` e os dois tokens
 * têm escopos diferentes na plataforma.
 *
 * ⚠️ SEMPRE COM `organization_id` NO FILTRO. Mesma lição da #236 que
 * `credenciais.ts` documenta: identificador de provider não é único por
 * instalação, e uma busca sem a organização casava duas linhas, o `maybeSingle()`
 * devolvia `null` com `PGRST116` descartado, e duas organizações passavam a
 * operar pela conta de outra. Aqui o índice é `(organization_id, platform)` e o
 * filtro repete a organização — banco e código dizendo a mesma coisa.
 *
 * ⚠️ EXIGE O ADMIN CLIENT. `ad_insights_connections` tem RLS ligada e ZERO
 * policies, com grants revogados de anon/authenticated (0214). Pelo client de
 * sessão isto não devolve nada — nem erro, só vazio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { encryptWebhookSecret, decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { appDeLoginDaMeta } from "./meta/login/app";
import { RENOVAR_QUANDO_FALTAR_MS, trocarPorTokenDeLongaDuracao } from "./meta/login/oauth";
import type { CredencialDeLeitura, PlataformaDeAnuncio } from "./types";

/**
 * Três ausências, três significados, e nenhum deles é "não configurado".
 *
 * Uma a menos que em `credenciais.ts`: lá existe `conexao_desabilitada` porque
 * lá existe um switch de pausa. Aqui a 0205 não tem `enabled` — desconectar é
 * apagar a linha — então "desligado" não é um estado alcançável, e inventar o
 * motivo faria a tela oferecer um botão de religar que não liga nada.
 */
export type MotivoSemLeitura = "sem_conexao" | "cifra_indisponivel";

export type LeituraDeCredencialDeLeitura =
  | { ok: true; credencial: CredencialDeLeitura }
  | { ok: false; motivo: MotivoSemLeitura };

export async function lerCredencialDeLeitura(
  admin: SupabaseClient,
  organizationId: string,
  plataforma: PlataformaDeAnuncio,
): Promise<LeituraDeCredencialDeLeitura> {
  const { data, error } = await admin
    .from("ad_insights_connections")
    .select("access_token_encrypted, default_account_id, token_expires_at")
    .eq("organization_id", organizationId)
    .eq("platform", plataforma)
    .maybeSingle();

  // O erro NÃO é descartado — foi exatamente o descarte que a #236 mediu.
  if (error) {
    logger.error("[ads.credencial-de-leitura] leitura falhou", {
      organizationId,
      plataforma,
      error: error.message,
    });
    return { ok: false, motivo: "sem_conexao" };
  }
  if (!data) return { ok: false, motivo: "sem_conexao" };

  const linha = data as {
    access_token_encrypted: string | null;
    default_account_id: string | null;
    token_expires_at: string | null;
  };

  // A coluna é NOT NULL no schema, então isto não deveria acontecer. A guarda
  // fica porque o tipo do client não sabe disso, e um `!` aqui trocaria um
  // caminho tratado por um crash na rota.
  if (!linha.access_token_encrypted) return { ok: false, motivo: "sem_conexao" };

  const token = await decryptWebhookSecret(admin, linha.access_token_encrypted);
  // Decifrar falha quando a GUC da chave mestra não está no ambiente. Devolver
  // "sem conexão" aqui faria a tela pedir para reconectar — e o novo cadastro
  // falharia igual, porque o problema é da INSTALAÇÃO e não do cadastro.
  if (!token) return { ok: false, motivo: "cifra_indisponivel" };

  const tokenEmVigor = await renovarSeFaltarPouco(admin, organizationId, plataforma, token, linha.token_expires_at);

  return {
    ok: true,
    credencial: { accessToken: tokenEmVigor, contaPadrao: linha.default_account_id },
  };
}

/**
 * Renovação SOB DEMANDA do token de longa duração obtido pelo login com o
 * Facebook: sem cron novo. Quando falta menos de 7 dias para vencer, a própria
 * leitura troca o token por um novo (mais ~60 dias) e grava.
 *
 * Nunca derruba a leitura: qualquer falha (app sem ID/segredo, Meta fora do ar,
 * token já vencido) devolve o token que já existe, e quem lê recebe o erro
 * normal da Meta. Token colado à mão não tem vencimento conhecido
 * (`token_expires_at` nulo) e nunca é renovado.
 */
async function renovarSeFaltarPouco(
  admin: SupabaseClient,
  organizationId: string,
  plataforma: PlataformaDeAnuncio,
  token: string,
  expiraEmIso: string | null,
): Promise<string> {
  if (plataforma !== "meta_ads" || !expiraEmIso) return token;
  const agora = new Date();
  const faltaMs = new Date(expiraEmIso).getTime() - agora.getTime();
  if (!Number.isFinite(faltaMs) || faltaMs > RENOVAR_QUANDO_FALTAR_MS || faltaMs <= 0) return token;

  try {
    const app = appDeLoginDaMeta();
    if (!app) return token;
    const novo = await trocarPorTokenDeLongaDuracao(app, token, { agora });
    if (!novo.ok) {
      logger.warn("[ads.credencial-de-leitura] renovação do token falhou", { organizationId, motivo: novo.motivo });
      return token;
    }
    const cifrado = await encryptWebhookSecret(admin, novo.accessToken);
    if (!cifrado) return token;
    const { error } = await admin
      .from("ad_insights_connections")
      .update({ access_token_encrypted: cifrado, token_expires_at: novo.expiraEm.toISOString() })
      .eq("organization_id", organizationId)
      .eq("platform", plataforma);
    if (error) {
      // Não gravou: o token novo seria perdido, e o antigo segue valendo até vencer.
      logger.warn("[ads.credencial-de-leitura] token renovado mas não gravado", { organizationId });
      return token;
    }
    return novo.accessToken;
  } catch (erro) {
    logger.warn("[ads.credencial-de-leitura] renovação do token lançou", {
      organizationId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return token;
  }
}

/**
 * Existe conexão? — sem decifrar nada.
 *
 * A página server-side só precisa saber se mostra a tabela ou o convite a
 * conectar. Chamar `lerCredencialDeLeitura()` para isso traria o token em claro
 * para dentro de um componente que renderiza HTML, e a única forma de garantir
 * que um segredo não vaza para o browser é ele não entrar no componente.
 */
export async function existeConexaoDeLeitura(
  admin: SupabaseClient,
  organizationId: string,
  plataforma: PlataformaDeAnuncio,
): Promise<{ conectada: boolean; contaPadrao: string | null; expiraEm: string | null }> {
  const { data, error } = await admin
    .from("ad_insights_connections")
    .select("default_account_id, token_expires_at")
    .eq("organization_id", organizationId)
    .eq("platform", plataforma)
    .maybeSingle();

  if (error) {
    logger.error("[ads.credencial-de-leitura] checagem falhou", {
      organizationId,
      plataforma,
      error: error.message,
    });
    return { conectada: false, contaPadrao: null, expiraEm: null };
  }

  const linha = data as { default_account_id: string | null; token_expires_at: string | null } | null;
  return {
    conectada: Boolean(linha),
    contaPadrao: linha?.default_account_id ?? null,
    expiraEm: linha?.token_expires_at ?? null,
  };
}
