/**
 * Acelera (fork): Análise › Funil de vendas. Do lead novo ao fechamento, com o
 * quanto o Meta custou em cada degrau. `manager`, como Meta Ads: os números são
 * da empresa inteira. O token do Meta só é lido na rota da API.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { FunilDeVendasClient } from "./_components/FunilDeVendasClient";

export const metadata = { title: "Funil do comercial" };
export const dynamic = "force-dynamic";

export default async function FunilDeVendasPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  return <FunilDeVendasClient />;
}
