/**
 * Análise → Resultados do funil. O funil padrão no período, o que o CRM mandou
 * ao Meta e o que o Meta registrou de fato, lado a lado.
 *
 * `manager`, como Meta Ads: envios e conjunto de dados são da empresa inteira.
 * O token da API de Conversões só é lido na rota da API, nunca aqui.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ResultadosDoFunilClient } from "./_components/ResultadosDoFunilClient";

export const metadata = { title: "Resultados do funil" };
export const dynamic = "force-dynamic";

export default async function ResultadosDoFunilPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Resultados do funil")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Quantos negócios passaram por cada etapa, quantos o CRM avisou ao Meta e quantos o Meta registrou.")}
        </p>
      </header>
      <ResultadosDoFunilClient />
    </div>
  );
}
