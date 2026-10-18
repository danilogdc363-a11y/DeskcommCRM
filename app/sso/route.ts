/**
 * ACELERA (fork) — GET /sso?pass=... — login único vindo do Acelera OS.
 *
 * Código só do fork (ver `ACELERA.md`). Fluxo:
 *  1. confere o passe (`lib/acelera-sso/pass.ts`): prefixo `crm1`, HMAC com
 *     `ACELERA_SSO_SECRET`, `aud`, validade (60 s) e nonce de uso único;
 *  2. acha ou cria o usuário no Supabase do CRM pelo E-MAIL (admin API);
 *  3. MULTI-ORGANIZAÇÃO: acha a organização do CRM ligada ao workspace do OS
 *     (`settings.provisioning` = { integration: "acelera-os", external_id })
 *     ou, se ainda não existe e quem chega é dono/admin, cria com o nome do
 *     workspace e o torna admin. Regras puras em `lib/acelera-sso/entrada.ts`;
 *  4. garante o vínculo com o papel mapeado (vínculo revogado segue revogado);
 *  5. abre a sessão: `generateLink` (magiclink, só no servidor, nenhum e-mail
 *     sai) + `verifyOtp` com o `token_hash` — o mesmo `verifyOtp` de
 *     `/auth/confirm`, que grava o cookie `sb-deskcomm-auth`;
 *  6. grava `active_org` (quem tem várias organizações cai na que veio do OS)
 *     e segue para `/app` pela PONTE (`respostaDePonte`): a chegada vem de
 *     outro site e o cookie é SameSite=Strict (issue #1646).
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { configAcelera } from "@/lib/acelera-sso/config";
import { INTEGRACAO_ACELERA_OS, planejarEntrada } from "@/lib/acelera-sso/entrada";
import { conferirPasse, NoncesUsados } from "@/lib/acelera-sso/pass";
import { audit } from "@/lib/audit";
import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { slugDoProvisionamento } from "@/lib/auth/provision";
import { marcaDaSaida } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const nonces = new NoncesUsados();

type Admin = ReturnType<typeof createAdminClient>;

async function acharOrganizacao(admin: Admin, osOrgId: string): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("settings->provisioning->>integration", INTEGRACAO_ACELERA_OS)
    .eq("settings->provisioning->>external_id", osOrgId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`sso: busca da organização falhou: ${error.message}`);
  return data ? { id: data.id as string } : null;
}

async function criarOrganizacao(
  admin: Admin,
  osOrg: { id: string; name: string },
  donoId: string,
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("organizations")
    .insert({
      slug: slugDoProvisionamento(INTEGRACAO_ACELERA_OS, osOrg.id),
      display_name: osOrg.name,
      legal_name: osOrg.name,
      status: "active",
      created_by: donoId,
      settings: { provisioning: { integration: INTEGRACAO_ACELERA_OS, external_id: osOrg.id } },
    })
    .select("id")
    .single();
  if (data) return { id: data.id as string };
  // Corrida (dois admins no mesmo segundo): relê pelo marcador.
  if (error?.code === "23505") {
    const outra = await acharOrganizacao(admin, osOrg.id);
    if (outra) return outra;
  }
  throw new Error(`sso: criar organização falhou: ${error?.message ?? "sem dados"}`);
}

export async function GET(request: NextRequest) {
  const cfg = configAcelera();
  const requestId = request.headers.get("x-request-id");
  const voltar = (motivo: string) => {
    const destino = cfg.urlDeLoginDoOs
      ? cfg.urlDeLoginDoOs
      : new URL(`/login?error=sso_${motivo}`, env.NEXT_PUBLIC_APP_URL).toString();
    const r = NextResponse.redirect(destino, 303);
    r.headers.set("Cache-Control", "no-store");
    r.headers.set("Referrer-Policy", "no-referrer");
    return r;
  };

  // Login único desligado (faltou a chave): a rota não existe.
  if (!cfg.segredo) return new NextResponse("Not found", { status: 404 });

  const conferido = conferirPasse(request.nextUrl.searchParams.get("pass") ?? "", cfg.segredo);
  if (!conferido.ok) return voltar(conferido.motivo);
  const passe = conferido.passe;
  if (!nonces.usar(passe.nonce, passe.exp)) return voltar("replay");

  const admin = createAdminClient();

  try {
    // Usuário: cria se não existir (e-mail confirmado — quem garante é o OS).
    const criado = await admin.auth.admin.createUser({
      email: passe.email,
      email_confirm: true,
      user_metadata: { full_name: passe.name, origem: INTEGRACAO_ACELERA_OS },
    });
    const jaExiste =
      criado.error?.code === "email_exists" ||
      /already|exist|registered/i.test(criado.error?.message ?? "");
    if (criado.error && !jaExiste) return voltar("usuario");

    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: passe.email });
    const usuarioId = link.data?.user?.id;
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !usuarioId || !tokenHash) return voltar("link");

    // Organização + vínculo.
    let org = await acharOrganizacao(admin, passe.org.id);
    let vinculo: { id: string; role: string; revogado: boolean } | null = null;
    if (org) {
      const { data, error } = await admin
        .from("user_organizations")
        .select("id, role, revoked_at")
        .eq("user_id", usuarioId)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (error) return voltar("vinculo");
      if (data) {
        vinculo = { id: data.id as string, role: data.role as string, revogado: Boolean(data.revoked_at) };
      }
    }

    const plano = planejarEntrada(passe, org, vinculo, cfg.papelDeMembro);
    if (plano.tipo === "recusar") return voltar(plano.motivo);

    if (plano.criarOrganizacao) {
      org = await criarOrganizacao(admin, passe.org, usuarioId);
      void audit({
        action: "tenant.created_by_provisioning",
        actorUserId: null,
        organizationId: org.id,
        resourceType: "organization",
        resourceId: org.id,
        requestId,
        bypassedRls: true,
        metadata: { integration: INTEGRACAO_ACELERA_OS, external_id: passe.org.id },
      });
    }
    if (!org) return voltar("organizacao");

    if (plano.vinculo === "criar") {
      const { error } = await admin.from("user_organizations").insert({
        user_id: usuarioId,
        organization_id: org.id,
        role: plano.papel,
        accepted_at: new Date().toISOString(),
      });
      if (error && error.code !== "23505") return voltar("vinculo");
    } else if (plano.vinculo === "atualizar" && vinculo) {
      await admin.from("user_organizations").update({ role: plano.papel }).eq("id", vinculo.id);
    }

    // Sessão: o cookie é gravado pelo client SSR desta requisição.
    const supabase = await createClient();
    const { error: erroSessao } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (erroSessao) return voltar("sessao");

    // Mesmo cookie e mesmas opções de `lib/auth/aplicar-convite.ts`.
    (await cookies()).set("active_org", org.id, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    void audit({
      action: "auth.login_success",
      actorUserId: usuarioId,
      organizationId: org.id,
      metadata: { provider: INTEGRACAO_ACELERA_OS, papel: plano.papel },
      requestId,
    });

    const marca = await marcaDaSaida(null);
    return respostaDePonte("/app", marca.nome, "Entrando no CRM…");
  } catch {
    return voltar("erro");
  }
}
