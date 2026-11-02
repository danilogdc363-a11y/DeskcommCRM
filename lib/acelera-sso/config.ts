/**
 * ACELERA (fork) — configuração do login único (ver `ACELERA.md`).
 * Sem `node:crypto`: é importado pelo `proxy.ts`.
 */

export type ConfigAcelera = {
  segredo: string | null;
  papelDeMembro: string | undefined;
  soSso: boolean;
  urlDeLoginDoOs: string | null;
};

export function configAcelera(e: Record<string, string | undefined> = process.env): ConfigAcelera {
  const url = e.ACELERA_OS_LOGIN_URL?.trim();
  return {
    segredo: e.ACELERA_SSO_SECRET?.trim() || null,
    papelDeMembro: e.ACELERA_SSO_MEMBER_ROLE?.trim() || undefined,
    soSso: e.ACELERA_SSO_ONLY?.trim() === "true",
    urlDeLoginDoOs: url && /^https?:\/\//.test(url) ? url : null,
  };
}

/**
 * Com `ACELERA_SSO_ONLY=true`, a tela de login/cadastro própria some e quem
 * chega lá vai pro login do OS. Saída de emergência: `?acesso_local=1` mantém
 * o login por senha (para o admin da instalação, se o OS cair).
 */
export function destinoSemLoginProprio(
  pathname: string,
  params: URLSearchParams,
  cfg: ConfigAcelera,
): string | null {
  if (!cfg.soSso || !cfg.urlDeLoginDoOs) return null;
  if (!/^\/(login|signup)(\/.*)?$/.test(pathname)) return null;
  if (params.has("acesso_local")) return null;
  // MFA, redefinição de senha e confirmação seguem funcionando (fluxos já iniciados).
  if (/^\/login\/(mfa|reset|recovery|continuar|forgot)$/.test(pathname)) return null;
  return cfg.urlDeLoginDoOs;
}
