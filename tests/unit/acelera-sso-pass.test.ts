// @vitest-environment node
// ACELERA (fork) — passe de login único vindo do Acelera OS. Ver ACELERA.md.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { configAcelera, destinoSemLoginProprio } from "@/lib/acelera-sso/config";
import {
  assinarPasseDeTeste,
  conferirPasse,
  NoncesUsados,
  papelNoCrm,
} from "@/lib/acelera-sso/pass";

const CHAVE = "segredo-de-teste";
const AGORA = 1_700_000_000;
const DADOS = {
  sub: "00000000-0000-0000-0000-000000000001",
  email: "Ana@Acelera.com",
  name: "Ana",
  role: "admin",
  org: "acelera",
  exp: AGORA + 60,
  nonce: "nonce-fixo",
};

/** Monta o passe exatamente como o Acelera OS (`lib/crm-comercial/pass.ts`). */
function passeDoOs(payload: object, chave = CHAVE, prefixo = "crm1"): string {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const corpo = `${prefixo}.${p}`;
  return `${corpo}.${createHmac("sha256", chave).update(corpo).digest("base64url")}`;
}

describe("conferirPasse", () => {
  it("aceita o passe no formato do OS e normaliza o e-mail", () => {
    const r = conferirPasse(passeDoOs({ ...DADOS, aud: "crm-comercial" }), CHAVE, AGORA);
    expect(r.ok && r.passe.email).toBe("ana@acelera.com");
  });

  it("recusa expirado", () => {
    const r = conferirPasse(assinarPasseDeTeste(DADOS, CHAVE), CHAVE, AGORA + 200);
    expect(r).toEqual({ ok: false, motivo: "expirado" });
  });

  it("recusa assinatura errada", () => {
    const r = conferirPasse(assinarPasseDeTeste(DADOS, "outra"), CHAVE, AGORA);
    expect(r).toEqual({ ok: false, motivo: "assinatura" });
  });

  it("recusa o passe do Escritório Virtual (prefixo v1), mesmo com a mesma chave", () => {
    const escritorio = passeDoOs(
      { email: "ana@acelera.com", name: "Ana", admin: true, exp: AGORA + 60, nonce: "n" },
      CHAVE,
      "v1",
    );
    expect(conferirPasse(escritorio, CHAVE, AGORA)).toEqual({ ok: false, motivo: "formato" });
  });

  it("recusa audiência diferente", () => {
    const r = conferirPasse(passeDoOs({ ...DADOS, aud: "outro" }), CHAVE, AGORA);
    expect(r).toEqual({ ok: false, motivo: "audiencia" });
  });

  it("recusa lixo", () => {
    expect(conferirPasse("", CHAVE, AGORA).ok).toBe(false);
    expect(conferirPasse("a.b", CHAVE, AGORA).ok).toBe(false);
  });
});

describe("anti-replay", () => {
  it("o mesmo nonce só passa uma vez", () => {
    const n = new NoncesUsados();
    expect(n.usar("x", AGORA + 60, AGORA)).toBe(true);
    expect(n.usar("x", AGORA + 60, AGORA + 1)).toBe(false);
    expect(n.usar("y", AGORA + 60, AGORA + 1)).toBe(true);
  });
});

describe("papel e configuração", () => {
  it("dono/admin viram admin; membro segue o padrão", () => {
    expect(papelNoCrm("owner", undefined)).toBe("admin");
    expect(papelNoCrm("member", undefined)).toBe("agent");
    expect(papelNoCrm("member", "manager")).toBe("manager");
    expect(papelNoCrm("member", "superuser")).toBe("agent");
  });

  it("ACELERA_SSO_ONLY manda /login para o OS, com saída de emergência", () => {
    const cfg = configAcelera({
      ACELERA_SSO_ONLY: "true",
      ACELERA_OS_LOGIN_URL: "https://os.exemplo.test/login",
    });
    const p = new URLSearchParams();
    expect(destinoSemLoginProprio("/login", p, cfg)).toBe("https://os.exemplo.test/login");
    expect(destinoSemLoginProprio("/signup", p, cfg)).toBe("https://os.exemplo.test/login");
    expect(destinoSemLoginProprio("/login/mfa", p, cfg)).toBeNull();
    expect(destinoSemLoginProprio("/login", new URLSearchParams("acesso_local=1"), cfg)).toBeNull();
    expect(destinoSemLoginProprio("/app", p, cfg)).toBeNull();
    expect(destinoSemLoginProprio("/login", p, configAcelera({}))).toBeNull();
  });
});
