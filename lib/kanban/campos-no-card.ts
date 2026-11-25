import type { CustomFieldDef } from "@/lib/schemas/settings";

/**
 * Um campo do funil que o operador marcou "mostrar no card", já com o valor
 * deste negócio.
 *
 * O valor chega CRU (texto, `true`/`false`, lista) em vez de frase pronta: "Sim" e
 * "Não" precisam passar pela tradução no navegador, e o que o servidor sabe
 * resolver sozinho — o RÓTULO da opção, que é dado do operador — já vem
 * resolvido.
 */
export interface CampoNoCard {
  chave: string;
  rotulo: string;
  tipo: CustomFieldDef["type"];
  valor: string | boolean | string[];
}

const TIPOS_QUE_O_CARD_NAO_DESENHA = new Set<CustomFieldDef["type"]>(["file", "textarea"]);

/** Os campos que o card mostra: marcados `no_card`, do NEGÓCIO, e que cabem em uma linha. */
export function camposQueOCardMostra(campos: readonly CustomFieldDef[]): CustomFieldDef[] {
  return campos.filter(
    (campo) =>
      campo.no_card === true &&
      campo.escopo !== "contato" &&
      !TIPOS_QUE_O_CARD_NAO_DESENHA.has(campo.type),
  );
}

function rotuloDaOpcao(campo: CustomFieldDef, valor: string): string {
  return campo.options?.find((opcao) => opcao.value === valor)?.label ?? valor;
}

/** `null` = não há o que mostrar (campo vazio não vira linha no card). */
function valorParaOCard(campo: CustomFieldDef, bruto: unknown): CampoNoCard["valor"] | null {
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto === "boolean") return bruto;
  if (Array.isArray(bruto)) {
    const itens = bruto
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .map((item) => rotuloDaOpcao(campo, item));
    return itens.length > 0 ? itens : null;
  }
  if (typeof bruto === "string") {
    const texto = bruto.trim();
    if (texto === "") return null;
    return campo.type === "select" || campo.type === "searchable_select"
      ? rotuloDaOpcao(campo, texto)
      : texto;
  }
  if (typeof bruto === "number" && Number.isFinite(bruto)) return String(bruto);
  return null;
}

/**
 * Anexa a cada negócio os campos do funil marcados "mostrar no card".
 *
 * PURA como `anexarAnexosAosNegocios`: não lê o banco — o `custom_fields` já vem
 * no negócio do quadro. Funil sem campo marcado devolve os MESMOS objetos, sem
 * chave nova (o payload não engorda e o card de quem não usa não muda). Campo
 * vazio no negócio não vira linha; a ordem é a do editor do funil.
 */
export function anexarCamposNoCard<T extends { custom_fields?: Record<string, unknown> | null }>(
  leads: T[],
  campos: readonly CustomFieldDef[],
): Array<T & { campos_no_card?: CampoNoCard[] }> {
  const marcados = camposQueOCardMostra(campos);
  if (marcados.length === 0) return leads;

  return leads.map((lead) => {
    const valores = lead.custom_fields ?? {};
    const linhas: CampoNoCard[] = [];
    for (const campo of marcados) {
      const valor = valorParaOCard(campo, valores[campo.key]);
      if (valor === null) continue;
      linhas.push({ chave: campo.key, rotulo: campo.label, tipo: campo.type, valor });
    }
    return linhas.length > 0 ? { ...lead, campos_no_card: linhas } : lead;
  });
}
