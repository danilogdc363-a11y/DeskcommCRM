/**
 * ACELERA (fork) — GET /sso?pass=... — login único vindo do Acelera OS.
 *
 * Código só do fork (ver `ACELERA.md`). Fluxo:
 *  1. confere o passe (`lib/acelera-sso/pass.ts`): prefixo `crm1`, HMAC com
 *     `ACELERA_SSO_SECRET`, `aud`, validade (60 s) e nonce de uso único;
 *  2. acha ou cria o usuário no Supabase do CRM pelo E-MAIL (admin API);
 *  3. garante o vínculo dele na organização `ACELERA_SSO_ORG_ID` com o papel
 *     mapeado (dono/admin do OS → admin; membro → `ACELERA_SSO_MEMBER_ROLE`,
 *     padrão `agent`). Vínculo revogado no CRM continua revogado;
 *  4. abre a sessão pelo mecanismo nativo do GoTrue: `generateLink`
 *     (magiclink, só no servidor, nada é enviado por e-mail) + `verifyOtp`
 *     com o `token_hash` — o mesmo `verifyOtp` que `/auth/confirm` usa, e que
 *     grava o cookie de sessão `sb-deskcomm-auth`;
 *  5. segue para `/app` pela PONTE (`respostaDePonte`), porque a chegada é
 *     navegação vinda de outro site e o cookie é SameSite=Strict (issue #1646).
 */
import { NextResponse, type NextRequest } from "next/server";

import { configAcelera } from "@/lib/acelera-sso/config";
import { conferirPasse, NoncesUsados, papelNoCrm } from "@/lib/acelera-sso/pass";
import { audit } from "@/lib/audit";
import { respostaDePonte } from "@/lib/auth/ponte-de-volta";
import { marcaDaSaida } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const nonces = new NoncesUsados();

export async function GET(request: NextRequest) {
  const cfg = configAcelera();
  const voltar = (motivo: string) => {
    // Sem passe válido: de volta para o login do OS (ou o próprio, se não houver).
    const destino = cfg.urlDeLoginDoOs
      ? cfg.urlDeLoginDoOs
      : new URL(`/login?error=sso_${motivo}`, env.NEXT_PUBLIC_APP_URL).toString();
    const r = NextResponse.redirect(destino, 303);
    r.headers.set("Cache-Control", "no-store");
    r.headers.set("Referrer-Policy", "no-referrer");
    return r;
  };

  // Login único desligado (faltou env): a rota não existe.
  if (!cfg.segredo || !cfg.organizacaoId) {
    return new NextResponse("Not found", { status: 404 });
  }

  const conferido = conferirPasse(request.nextUrl.searchParams.get("pass") ?? "", cfg.segredo);
  if (!conferido.ok) return voltar(conferido.motivo);
  const passe = conferido.passe;
  if (!nonces.usar(passe.nonce, passe.exp)) return voltar("replay");

  const admin = createAdminClient();

  // 2. Usuário: cria se não existir (e-mail já confirmado — quem garante o
  // e-mail é o OS). "Já existe" não é erro: é a conta de quem já usava o CRM.
  const criado = await admin.auth.admin.createUser({
    email: passe.email,
    email_confirm: true,
    user_metadata: { full_name: passe.name, origem: "acelera-os" },
  });
  if (criado.error && !/already|exist|registered/i.test(criado.error.message)) {
    return voltar("usuario");
  }

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: passe.email });
  const usuarioId = link.data?.user?.id;
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !usuarioId || !tokenHash) return voltar("link");

  // 3. Vínculo na organização da Acelera, com o papel mapeado.
  const papel = papelNoCrm(passe.role, cfg.papelDeMembro);
  const { data: vinculo, error: erroVinculo } = await admin
    .from("user_organizations")
    .select("id, role, revoked_at")
    .eq("user_id", usuarioId)
    .eq("organization_id", cfg.organizacaoId)
    .maybeSingle();
  if (erroVinculo) return voltar("vinculo");
  if (vinculo?.revoked_at) return voltar("revogado");
  if (!vinculo) {
    const { error } = await admin.from("user_organizations").insert({
      user_id: usuarioId,
      organization_id: cfg.organizacaoId,
      role: papel,
      accepted_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") return voltar("vinculo");
  } else if (vinculo.role !== papel) {
    await admin.from("user_organizations").update({ role: papel }).eq("id", vinculo.id);
  }

  // 4. Sessão: o cookie é gravado pelo client SSR desta requisição.
  const supabase = await createClient();
  const { error: erroSessao } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (erroSessao) return voltar("sessao");

  void audit({
    action: "auth.login_success",
    actorUserId: usuarioId,
    organizationId: cfg.organizacaoId,
    metadata: { provider: "acelera-os", papel },
    requestId: request.headers.get("x-request-id"),
  });

  // 5. Ponte same-origin até a tela autenticada.
  const marca = await marcaDaSaida(null);
  return respostaDePonte("/app", marca.nome, "Entrando no CRM…");
}
