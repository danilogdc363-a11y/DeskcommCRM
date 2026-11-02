// ACELERA (fork): ponte do login único com tela de carregamento.
//
// A ponte em si é obrigatória (ver lib/auth/ponte-de-volta.ts): o cookie de
// sessão é SameSite=Strict, então a chegada vinda do OS precisa de um passo
// same-origin antes de /app. A ponte do upstream é uma página branca com um
// parágrafo — no login único ela aparecia como um "flash branco" antes do CRM
// (Danilo, 18/out). Esta versão mostra um carregamento na cor da marca, no
// tema do sistema, e redireciona na hora. Arquivo próprio para não mexer no
// upstream.
import { createHash } from "node:crypto";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const hexValido = (cor: string) => (/^#[0-9a-fA-F]{6}$/.test(cor) ? cor : "#FF7300");

export function pontaDeCarregamento(destino: string, nomeDaMarca: string, accent: string): Response {
  const script = `window.location.replace(${JSON.stringify(destino).replace(/</g, "\\u003c")});`;
  const cor = hexValido(accent);
  const style = `:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#5d6672}@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#9aa3ae}}html,body{height:100%;margin:0}body{background:var(--bg);color:var(--fg);font:14px system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center}.c{display:grid;gap:14px;justify-items:center}.s{width:28px;height:28px;border-radius:50%;border:3px solid ${cor}33;border-top-color:${cor};animation:g .8s linear infinite}@keyframes g{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.s{animation:none}}a{color:${cor}}`;
  const sh = (s: string) => createHash("sha256").update(s).digest("base64");
  const nome = escapeHtml(nomeDaMarca);
  const alvo = escapeHtml(destino);
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrando no ${nome}</title><style>${style}</style></head><body><div class="c" role="status"><div class="s" aria-hidden="true"></div><span>Entrando no ${nome}…</span><noscript><a href="${alvo}">Continuar</a></noscript></div><script>${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${sh(script)}'; style-src 'sha256-${sh(style)}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      },
    },
  );
}
