/**
 * ACELERA (fork): endereço da tela "Novo cliente" do Acelera OS para um lead
 * ganho. A base vem de `ACELERA_OS_NOVO_CLIENTE_URL`, com o workspace já no
 * caminho (`https://os.../app/<slug>/empresas/novo`): o CRM não conhece o slug.
 */
export function urlDoNovoCliente(base: string | null | undefined, leadId: string): string | null {
  const limpa = base?.trim();
  if (!limpa) return null;
  try {
    const url = new URL(limpa);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.searchParams.set("crmLead", leadId);
    return url.toString();
  } catch {
    return null;
  }
}
