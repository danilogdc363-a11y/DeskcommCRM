/**
 * O app da Meta que faz o LOGIN com o Facebook — App ID e App Secret, lidos SÓ
 * DO AMBIENTE do servidor (`META_APP_ID` e `META_APP_SECRET`).
 *
 * É o mesmo app do WhatsApp oficial, mas decisão do dono do produto: o login
 * NÃO lê o banco nem `/admin/sistema`. Por isso, se alguém trocar o segredo do
 * webhook pela tela (que tem precedência sobre o `.env` em
 * `lib/channels/meta/app.ts`), o login continua com o `META_APP_SECRET` do
 * ambiente — e os dois só divergem se alguém cadastrar valores diferentes. Sendo
 * o mesmo app, deveriam ser iguais.
 *
 * Mudou o ambiente? É preciso reimplantar para valer.
 */
export interface AppDeLoginDaMeta {
  readonly appId: string;
  readonly appSecret: string;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** O par completo, ou `null` (vazio é ausente: o template do `.env` gera `CHAVE=`). */
export function appDeLoginDaMeta(
  ambiente: Record<string, string | undefined> = process.env,
): AppDeLoginDaMeta | null {
  const appId = texto(ambiente.META_APP_ID);
  const appSecret = texto(ambiente.META_APP_SECRET);
  return appId && appSecret ? { appId, appSecret } : null;
}

/** Os nomes das variáveis que faltam, para a tela dizer exatamente o que cadastrar. */
export function variaveisDoLoginQueFaltam(
  ambiente: Record<string, string | undefined> = process.env,
): string[] {
  return (["META_APP_ID", "META_APP_SECRET"] as const).filter((nome) => !texto(ambiente[nome]));
}
