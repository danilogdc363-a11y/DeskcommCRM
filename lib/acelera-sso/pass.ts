/**
 * ACELERA (fork) — passe de login único vindo do Acelera OS.
 *
 * Código só do fork: ver `ACELERA.md` na raiz. Fica isolado nesta pasta para
 * não conflitar ao puxar atualizações do upstream.
 *
 * Formato (tem que bater com `lib/crm-comercial/pass.ts` do Acelera OS):
 *   crm1.<payload base64url>.<HMAC-SHA256(chave, "crm1." + payload) base64url>
 * payload = JSON { sub, email, name, role, org: { id, slug, name }, aud: "crm-comercial", exp, nonce }
 *
 * Módulo puro (sem I/O): a rota `/sso` cuida de replay, usuário e sessão.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PREFIXO_DO_PASSE = "crm1";
export const AUDIENCIA_DO_PASSE = "crm-comercial";
/** Folga de relógio entre os dois servidores. */
export const FOLGA_DE_RELOGIO_S = 10;

export type PasseAcelera = {
  sub: string;
  email: string;
  name: string;
  role: string;
  /** Workspace do OS. O `id` é a chave que liga ele à organização no CRM. */
  org: { id: string; slug: string; name: string };
  aud: string;
  exp: number;
  nonce: string;
};

export type ResultadoDoPasse =
  | { ok: true; passe: PasseAcelera }
  | { ok: false; motivo: "formato" | "assinatura" | "audiencia" | "expirado" | "campos" };

function assinar(corpo: string, chave: string): string {
  return createHmac("sha256", chave).update(corpo).digest("base64url");
}

/** Só para testes (e para quem quiser gerar um passe de teste local). */
export function assinarPasseDeTeste(
  dados: Omit<PasseAcelera, "aud"> & { aud?: string },
  chave: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ aud: AUDIENCIA_DO_PASSE, ...dados }),
  ).toString("base64url");
  const corpo = `${PREFIXO_DO_PASSE}.${payload}`;
  return `${corpo}.${assinar(corpo, chave)}`;
}

export function conferirPasse(
  token: string,
  chave: string,
  agoraS = Math.floor(Date.now() / 1000),
): ResultadoDoPasse {
  if (!token || token.length > 4096) return { ok: false, motivo: "formato" };
  const partes = token.split(".");
  if (partes.length !== 3) return { ok: false, motivo: "formato" };
  const [prefixo, payload, assinatura] = partes as [string, string, string];
  if (prefixo !== PREFIXO_DO_PASSE) return { ok: false, motivo: "formato" };

  const esperado = Buffer.from(assinar(`${prefixo}.${payload}`, chave));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
    return { ok: false, motivo: "assinatura" };
  }

  let dados: Partial<PasseAcelera>;
  try {
    dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, motivo: "formato" };
  }
  if (dados.aud !== AUDIENCIA_DO_PASSE) return { ok: false, motivo: "audiencia" };
  if (typeof dados.exp !== "number" || dados.exp + FOLGA_DE_RELOGIO_S < agoraS) {
    return { ok: false, motivo: "expirado" };
  }
  if (
    typeof dados.email !== "string" ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email) ||
    typeof dados.sub !== "string" ||
    typeof dados.nonce !== "string" ||
    !dados.nonce ||
    typeof dados.org?.id !== "string" ||
    !dados.org.id
  ) {
    return { ok: false, motivo: "campos" };
  }
  return {
    ok: true,
    passe: {
      sub: dados.sub,
      email: dados.email.toLowerCase(),
      name: typeof dados.name === "string" ? dados.name.slice(0, 120) : "",
      role: typeof dados.role === "string" ? dados.role : "member",
      org: {
        id: dados.org.id,
        slug: typeof dados.org.slug === "string" ? dados.org.slug : "",
        name:
          typeof dados.org.name === "string" && dados.org.name.trim()
            ? dados.org.name.trim().slice(0, 120)
            : "Minha empresa",
      },
      aud: dados.aud,
      exp: dados.exp,
      nonce: dados.nonce,
    },
  };
}

/**
 * Anti-replay simples: cada nonce vale uma vez enquanto o passe estiver vivo.
 * Em memória do processo — basta para o compose de uma réplica do CRM. Se um
 * dia rodar mais de uma réplica do `app`, trocar por Redis/tabela.
 */
export class NoncesUsados {
  private vistos = new Map<string, number>();

  /** true = primeira vez (aceita); false = replay. */
  usar(nonce: string, expS: number, agoraS = Math.floor(Date.now() / 1000)): boolean {
    for (const [n, e] of this.vistos) if (e + FOLGA_DE_RELOGIO_S < agoraS) this.vistos.delete(n);
    if (this.vistos.has(nonce)) return false;
    this.vistos.set(nonce, expS);
    return true;
  }
}

/** Papel no OS → papel no CRM (viewer < agent < manager < admin). */
export function papelNoCrm(papelNoOs: string, padraoDeMembro: string | undefined): string {
  if (papelNoOs === "owner" || papelNoOs === "admin") return "admin";
  const validos = ["viewer", "agent", "manager", "admin"];
  return padraoDeMembro && validos.includes(padraoDeMembro) ? padraoDeMembro : "agent";
}

