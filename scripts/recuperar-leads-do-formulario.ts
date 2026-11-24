/**
 * (Acelera) Traz para o CRM os leads do formulário nativo da Meta que foram
 * preenchidos antes de o aviso `leadgen` estar ligado.
 *
 * Usa a MESMA importação do webhook (`importarLeadDaMeta`): lead entra com
 * origem instagram/facebook · lead_ads e o nome da campanha, conjunto e anúncio.
 * A captação deduplica por `external_id` (`meta_lead:<id>`), então rodar duas
 * vezes não duplica. NÃO avisa o comercial no WhatsApp (lead antigo).
 *
 * Precisa das variáveis do CRM: ACELERA_LEADS_PAGE_TOKEN e ACELERA_LEADS_INBOUND_URL.
 * Rodar no servidor do CRM (console do serviço no EasyPanel), onde elas existem.
 *
 *   # só conta quantos leads a Meta tem desde a data (não grava nada)
 *   npx tsx scripts/recuperar-leads-do-formulario.ts --desde 2026-11-01
 *
 *   # importa de verdade
 *   npx tsx scripts/recuperar-leads-do-formulario.ts --desde 2026-11-01 --aplicar
 */
import { idsDeLeadDosFormulariosDesde, importarLeadDaMeta } from "../lib/acelera/lead-ads";

function lerArgumentos(argv: string[]): { desde: Date; aplicar: boolean } {
  const posicao = argv.indexOf("--desde");
  const texto = posicao >= 0 ? argv[posicao + 1] : undefined;
  if (!texto || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw new Error("Informe a data inicial: --desde AAAA-MM-DD");
  }
  // Meia-noite de Brasília.
  return { desde: new Date(`${texto}T00:00:00-03:00`), aplicar: argv.includes("--aplicar") };
}

async function main(): Promise<void> {
  const { desde, aplicar } = lerArgumentos(process.argv.slice(2));
  const ids = await idsDeLeadDosFormulariosDesde(desde);
  console.info(`A Meta tem ${ids.length} lead(s) de formulário desde ${desde.toISOString()}.`);
  if (!aplicar) {
    console.info("Nada foi gravado. Rode de novo com --aplicar para importar.");
    return;
  }

  const falhas: { id: string; motivo: string }[] = [];
  for (const id of ids) {
    try {
      await importarLeadDaMeta(id, { avisar: false });
    } catch (erro) {
      falhas.push({ id, motivo: erro instanceof Error ? erro.message : "desconhecido" });
    }
  }
  console.info(`Importados: ${ids.length - falhas.length}. Falharam: ${falhas.length}.`);
  for (const falha of falhas) console.info(`  ${falha.id}: ${falha.motivo}`);
  console.info(
    'Os já existentes e os recusados (ex.: sem telefone) aparecem em "Leads recebidos".',
  );
  if (falhas.length > 0) process.exitCode = 1;
}

void main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
