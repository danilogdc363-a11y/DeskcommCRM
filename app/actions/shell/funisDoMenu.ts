"use server";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export interface FunilDoMenu {
  id: string;
  name: string;
}

/**
 * Os funis vivos da organização ativa, na ordem da tela de Funis — viram atalhos
 * logo abaixo de "Funis" na barra lateral (um clique abre o quadro).
 *
 * Mesma leitura do Server Component de `/app/kanban` (aberta a qualquer papel),
 * e não `GET /api/v1/pipelines`, que exige `manager`.
 */
export async function funisDoMenu(): Promise<FunilDoMenu[]> {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");
  return (data ?? []) as FunilDoMenu[];
}
