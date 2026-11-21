/**
 * Quanto a conta de anúncios PADRÃO gastou, semana a semana — para o Raio-X
 * de Resultados do funil. Reusa a leitura de Meta Ads (`lerInsights`, token de
 * leitura no header, nunca na URL); não abre credencial nova.
 *
 * As datas vão como dias de calendário; a Graph os corta no fuso da conta de
 * anúncios. Gasto sem imposto (é o que a Graph informa).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { gastoEmCentavos } from "@/lib/reports/raio-x";

import { lerInsights } from "./insights";

export type LeituraDeInvestimento =
  | { ok: true; contaId: string; porSemana: number[] }
  | {
      ok: false;
      motivo: "sem_conexao" | "cifra_indisponivel" | "sem_conta_padrao" | "recusado_pelo_meta";
    };

export async function lerInvestimentoPorSemana(
  admin: SupabaseClient,
  organizationId: string,
  semanas: Array<{ de: string; ate: string }>,
): Promise<LeituraDeInvestimento> {
  const cred = await lerCredencialDeLeitura(admin, organizationId, "meta_ads");
  if (!cred.ok) return { ok: false, motivo: cred.motivo };
  const contaId = cred.credencial.contaPadrao;
  if (!contaId) return { ok: false, motivo: "sem_conta_padrao" };

  const leituras = await Promise.all(
    semanas.map((s) => lerInsights(cred.credencial.accessToken, contaId, s.de, s.ate)),
  );
  const falha = leituras.find((l) => !l.ok);
  if (falha && !falha.ok) {
    logger.warn("[ads.meta.investimento] leitura recusada", { falha: falha.falha });
    return { ok: false, motivo: "recusado_pelo_meta" };
  }
  return {
    ok: true,
    contaId,
    porSemana: leituras.map((l) => (l.ok ? gastoEmCentavos(l.dados) : 0)),
  };
}
