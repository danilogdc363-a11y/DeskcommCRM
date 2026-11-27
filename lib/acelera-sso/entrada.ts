/**
 * ACELERA (fork) — o que fazer com quem chega pelo login único (ver ACELERA.md).
 *
 * MULTI-ORGANIZAÇÃO: cada workspace do Acelera OS vira UMA organização no CRM.
 * O vínculo mora no lugar que o próprio CRM já usa para "organização que nasceu
 * de um sistema de fora": `organizations.settings.provisioning`
 * = { integration: "acelera-os", external_id: <id do workspace no OS> }
 * (mesmo marcador de `provisionExternalTenant` em lib/auth/provision.ts) e o
 * slug determinístico `slugDoProvisionamento("acelera-os", id)`. Sem migration.
 *
 * Módulo puro: a rota `/sso` lê o banco, pede o plano aqui e executa.
 */
import { papelNoCrm, type PasseAcelera } from "./pass";

export const INTEGRACAO_ACELERA_OS = "acelera-os";

export type OrgNoCrm = { id: string } | null;
export type VinculoNoCrm = { id: string; role: string; revogado: boolean } | null;

export type PlanoDeEntrada =
  | { tipo: "recusar"; motivo: "revogado" | "org_sem_dono" | "org_nao_autorizada" }
  | {
      tipo: "entrar";
      /** Organização ainda não existe no CRM: criar com o nome vindo do OS. */
      criarOrganizacao: boolean;
      vinculo: "criar" | "atualizar" | "manter";
      papel: string;
    };

export function ehDonoOuAdmin(papelNoOs: string): boolean {
  return papelNoOs === "owner" || papelNoOs === "admin";
}

export function planejarEntrada(
  passe: Pick<PasseAcelera, "role">,
  org: OrgNoCrm,
  vinculo: VinculoNoCrm,
  papelDeMembro: string | undefined,
  // (Acelera) Organização NOVA só nasce para workspace da lista `ACELERA_SSO_ORGS_PERMITIDAS`.
  // Sem isto, qualquer pessoa que se cadastra no OS e cria um workspace virava admin
  // de uma organização nova no CRM (canais, IA e e-mail da instalação). Fechado por padrão.
  podeCriarOrganizacao = false,
): PlanoDeEntrada {
  const papel = papelNoCrm(passe.role, papelDeMembro);

  if (!org) {
    // Só dono/admin do workspace abre a organização no CRM — e vira admin dela.
    // Membro que chega antes fica de fora, senão a org nasceria sem admin.
    if (!podeCriarOrganizacao) return { tipo: "recusar", motivo: "org_nao_autorizada" };
    if (!ehDonoOuAdmin(passe.role)) return { tipo: "recusar", motivo: "org_sem_dono" };
    return { tipo: "entrar", criarOrganizacao: true, vinculo: "criar", papel: "admin" };
  }

  if (vinculo?.revogado) return { tipo: "recusar", motivo: "revogado" };
  if (!vinculo) return { tipo: "entrar", criarOrganizacao: false, vinculo: "criar", papel };
  if (vinculo.role !== papel) {
    return { tipo: "entrar", criarOrganizacao: false, vinculo: "atualizar", papel };
  }
  return { tipo: "entrar", criarOrganizacao: false, vinculo: "manter", papel };
}

/**
 * (Acelera) O workspace do OS pode abrir organização nova no CRM? Vale o id OU o
 * slug do workspace, como vieram no passe. Lista vazia = ninguém abre (só entra
 * quem já tem organização ligada).
 */
export function workspacePodeCriarOrganizacao(
  org: { id: string; slug: string },
  permitidos: ReadonlySet<string>,
): boolean {
  return permitidos.has(org.id) || (org.slug !== "" && permitidos.has(org.slug));
}
