/**
 * ACELERA (fork) — regras puras da tela "Unificar fichas".
 */

/** Sugere o principal: o negócio ganho mais antigo; sem ganho, o mais antigo. */
export function sugerirPrincipal(
  leads: ReadonlyArray<{ id: string; created_at: string; status: string }>,
): string | null {
  if (leads.length === 0) return null;
  const porIdade = [...leads].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  return (porIdade.find((l) => l.status === "won") ?? porIdade[0])?.id ?? null;
}

const ROTULOS: Record<string, string> = {
  "crm_lead_activities.lead_id": "atividade(s) e histórico de etapas",
  "crm_tasks.lead_id": "tarefa(s)",
  "crm_proposals.lead_id": "proposta(s)",
  "ad_conversion_dispatches.lead_id": "envio(s) de conversão para anúncios",
  "lead_notes.lead_id": "anotação(ões)",
  "crm_lead_links.lead_id": "vínculo(s)",
};

/** `tabela.coluna` → texto para quem opera. Desconhecido vira "registro(s) de <tabela>". */
export function rotuloDoRepontado(chave: string): string {
  return ROTULOS[chave] ?? `registro(s) de ${(chave.split(".")[0] ?? chave).replace(/_/g, " ")}`;
}

export function formatarReais(centavos: number | null): string {
  if (centavos == null) return "sem valor";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Status do negócio em texto de tela (nunca o valor cru do banco). */
export function rotuloDoStatus(status: string): string {
  if (status === "won") return "ganho";
  if (status === "lost") return "perdido";
  return "aberto";
}
