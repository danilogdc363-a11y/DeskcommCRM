/**
 * O `state` do login com o Facebook (Meta Ads) — assinado, com prazo, de uso
 * único (o nonce é queimado no callback).
 *
 * Mesma construção de `lib/plataformas-de-anuncio/google/estado.ts`, com um
 * rótulo próprio dentro da assinatura: um `state` do Google Ads, mesmo com
 * assinatura válida, NUNCA é aceito aqui (e vice-versa).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const VALIDADE_DO_ESTADO_MS = 10 * 60 * 1000;

const ROTULO = "meta-ads-login";
const TAMANHO_MINIMO_DO_SEGREDO = 16;

export interface EstadoDoLoginMetaAds {
  organizationId: string;
  userId: string;
  nonce: string;
  expiraEmMs: number;
  /** Sessão de quem iniciou: a régua de suporte do callback confere por ela. */
  authSessionId?: string;
}

function assinar(carga: string, segredo: string): Buffer {
  return createHmac("sha256", segredo).update(`${ROTULO}|${carga}`, "utf8").digest();
}

function conferirSegredo(segredo: string): string {
  const s = segredo?.trim() ?? "";
  if (s.length < TAMANHO_MINIMO_DO_SEGREDO) {
    throw new Error("INTERNAL_SECRET ausente ou curto demais: o retorno do Facebook não teria como ser verificado");
  }
  return s;
}

export function emitirEstado(
  dados: { organizationId: string; userId: string; authSessionId?: string },
  opcoes: { segredo: string; agora: Date; nonce?: string; validadeMs?: number },
): string {
  const segredo = conferirSegredo(opcoes.segredo);
  const organizationId = dados.organizationId?.trim() ?? "";
  const userId = dados.userId?.trim() ?? "";
  if (!organizationId || !userId) throw new Error("state precisa de organizationId e userId");
  const sessao = dados.authSessionId ?? "";
  for (const campo of [organizationId, userId, sessao]) {
    if (campo.includes(".")) throw new Error("campo com ponto: o separador do state não sobreviveria");
  }
  const nonce = opcoes.nonce?.trim() || randomBytes(16).toString("hex");
  const expira = opcoes.agora.getTime() + (opcoes.validadeMs ?? VALIDADE_DO_ESTADO_MS);
  const carga = `${organizationId}.${userId}.${nonce}.${expira}${sessao ? `.${sessao}` : ""}`;
  const assinatura = assinar(carga, segredo).toString("hex");
  return `${Buffer.from(carga, "utf8").toString("base64url")}.${assinatura}`;
}

/** O conteúdo do `state` quando é nosso e vale; `null` em qualquer outro caso. */
export function verificarEstado(
  token: string | null | undefined,
  opcoes: { segredo: string; agora: Date },
): EstadoDoLoginMetaAds | null {
  if (!token) return null;
  const segredo = conferirSegredo(opcoes.segredo);
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [cargaCodificada, assinaturaHex] = partes;
  if (!cargaCodificada || !assinaturaHex) return null;

  const carga = Buffer.from(cargaCodificada, "base64url").toString("utf8");
  const esperada = assinar(carga, segredo);
  const recebida = Buffer.from(assinaturaHex, "hex");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;

  const campos = carga.split(".");
  if (campos.length < 4 || campos.length > 5) return null;
  const [organizationId, userId, nonce, expiraTexto, authSessionId] = campos;
  const expiraEmMs = Number(expiraTexto);
  if (!organizationId || !userId || !nonce || !Number.isFinite(expiraEmMs)) return null;
  if (opcoes.agora.getTime() > expiraEmMs) return null;
  return { organizationId, userId, nonce, expiraEmMs, ...(authSessionId ? { authSessionId } : {}) };
}
