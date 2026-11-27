// @vitest-environment node
// ACELERA (fork) — regras de entrada multi-organização do login único. Ver ACELERA.md.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { planejarEntrada, workspacePodeCriarOrganizacao } from "@/lib/acelera-sso/entrada";
import { configAcelera } from "@/lib/acelera-sso/config";
import { conferirPasse } from "@/lib/acelera-sso/pass";

const CHAVE = "k";
const AGORA = 1_700_000_000;

function passe(org: { id: string; slug: string; name: string }, role: string) {
  const p = Buffer.from(
    JSON.stringify({
      sub: "u1",
      email: "ana@x.com",
      name: "Ana",
      role,
      org,
      aud: "crm-comercial",
      exp: AGORA + 60,
      nonce: `${org.id}-${role}`,
    }),
  ).toString("base64url");
  const corpo = `crm1.${p}`;
  const r = conferirPasse(
    `${corpo}.${createHmac("sha256", CHAVE).update(corpo).digest("base64url")}`,
    CHAVE,
    AGORA,
  );
  if (!r.ok) throw new Error(r.motivo);
  return r.passe;
}

const ORG_A = { id: "aaaa", slug: "agencia-a", name: "Agência A" };
const ORG_B = { id: "bbbb", slug: "agencia-b", name: "Agência B" };

describe("planejarEntrada", () => {
  it("duas orgs do OS viram duas organizações distintas, cada uma com seu dono admin", () => {
    const a = passe(ORG_A, "owner");
    const b = passe(ORG_B, "admin");
    expect(a.org.id).not.toBe(b.org.id);
    expect(planejarEntrada(a, null, null, undefined, true)).toEqual({
      tipo: "entrar",
      criarOrganizacao: true,
      vinculo: "criar",
      papel: "admin",
    });
    expect(planejarEntrada(b, null, null, undefined, true)).toMatchObject({
      criarOrganizacao: true,
      papel: "admin",
    });
  });

  it("organização já ligada é reaproveitada (não cria outra)", () => {
    const p = passe(ORG_A, "admin");
    expect(planejarEntrada(p, { id: "crm-a" }, null, undefined)).toEqual({
      tipo: "entrar",
      criarOrganizacao: false,
      vinculo: "criar",
      papel: "admin",
    });
  });

  it("vínculo existente com o mesmo papel é mantido; papel diferente é realinhado", () => {
    const p = passe(ORG_A, "member");
    const org = { id: "crm-a" };
    expect(
      planejarEntrada(p, org, { id: "v1", role: "agent", revogado: false }, undefined),
    ).toMatchObject({ vinculo: "manter", papel: "agent" });
    expect(
      planejarEntrada(p, org, { id: "v1", role: "viewer", revogado: false }, "manager"),
    ).toMatchObject({ vinculo: "atualizar", papel: "manager" });
  });

  it("membro não abre organização que ainda não existe no CRM", () => {
    expect(planejarEntrada(passe(ORG_B, "member"), null, null, undefined, true)).toEqual({
      tipo: "recusar",
      motivo: "org_sem_dono",
    });
  });

  it("vínculo revogado no CRM continua revogado", () => {
    expect(
      planejarEntrada(
        passe(ORG_A, "owner"),
        { id: "crm-a" },
        { id: "v1", role: "admin", revogado: true },
        undefined,
      ),
    ).toEqual({ tipo: "recusar", motivo: "revogado" });
  });

  it("(Acelera) workspace fora da lista não abre organização nova, mesmo sendo dono", () => {
    expect(planejarEntrada(passe(ORG_A, "owner"), null, null, undefined)).toEqual({
      tipo: "recusar",
      motivo: "org_nao_autorizada",
    });
    expect(planejarEntrada(passe(ORG_A, "owner"), null, null, undefined, false)).toEqual({
      tipo: "recusar",
      motivo: "org_nao_autorizada",
    });
  });

  it("(Acelera) a lista não barra quem já tem organização ligada", () => {
    expect(
      planejarEntrada(passe(ORG_A, "member"), { id: "crm-a" }, null, undefined, false),
    ).toMatchObject({
      tipo: "entrar",
      criarOrganizacao: false,
    });
  });

  it("(Acelera) a lista aceita o id ou o slug do workspace; vazia não libera ninguém", () => {
    const lista = configAcelera({
      ACELERA_SSO_ORGS_PERMITIDAS: " aaaa , agencia-b ,,",
    }).workspacesQueCriamOrganizacao;
    expect(workspacePodeCriarOrganizacao(ORG_A, lista)).toBe(true);
    expect(workspacePodeCriarOrganizacao(ORG_B, lista)).toBe(true);
    expect(workspacePodeCriarOrganizacao({ id: "cccc", slug: "" }, lista)).toBe(false);
    expect(workspacePodeCriarOrganizacao({ id: "cccc", slug: "" }, new Set([""]))).toBe(false);
    const vazia = configAcelera({}).workspacesQueCriamOrganizacao;
    expect(workspacePodeCriarOrganizacao(ORG_A, vazia)).toBe(false);
  });

  it("passe sem org.id é recusado", () => {
    const p = Buffer.from(
      JSON.stringify({
        sub: "u",
        email: "a@b.co",
        aud: "crm-comercial",
        exp: AGORA + 60,
        nonce: "n",
      }),
    ).toString("base64url");
    const corpo = `crm1.${p}`;
    const t = `${corpo}.${createHmac("sha256", CHAVE).update(corpo).digest("base64url")}`;
    expect(conferirPasse(t, CHAVE, AGORA)).toEqual({ ok: false, motivo: "campos" });
  });
});
