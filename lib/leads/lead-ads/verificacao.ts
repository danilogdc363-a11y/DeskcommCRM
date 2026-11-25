/**
 * (Acelera) A senha de verificação do webhook de formulário, DERIVADA do
 * segredo do app da Meta — sem variável nova.
 *
 * O CRM cadastra a URL no app da Meta (`POST /{app-id}/subscriptions`) e a Meta
 * confere com um `GET` que devolve `hub.verify_token`. O valor sai de um HMAC
 * do `META_APP_SECRET` (que o servidor já tem), então o CRM sabe recalcular na
 * hora da conferência e ninguém precisa digitar nem guardar nada. Trocar o
 * segredo do app troca a senha; o próximo "conectar" recadastra.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const ROTULO = "deskcomm:formulario-da-meta:verificacao:v1";

export function verifyTokenDoFormulario(appSecret: string): string {
  return createHmac("sha256", appSecret).update(ROTULO).digest("hex").slice(0, 32);
}

export function verifyTokenConfere(recebido: string | null, appSecret: string | null): boolean {
  if (!recebido || !appSecret) return false;
  const esperado = Buffer.from(verifyTokenDoFormulario(appSecret));
  const obtido = Buffer.from(recebido);
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}
