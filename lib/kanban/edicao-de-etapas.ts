/**
 * (Acelera) As contas da edição de etapas direto no quadro: mover a coluna,
 * encaixar a etapa nova e oferecer o destino de quem está numa etapa que sai.
 *
 * Só funções puras sobre a lista de etapas VIVAS, na ordem do quadro. Quem grava
 * é a rota de etapas (`PATCH/POST/DELETE /api/v1/pipelines/:id/stages`), que
 * repete as regras de verdade (`lib/leads/stage-operations.ts`); aqui é só o que
 * a tela precisa para montar o pedido certo.
 */

/** O mínimo de uma etapa que estas contas leem. */
export interface EtapaNaOrdem {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
}

export type Direcao = "esquerda" | "direita";

/**
 * O `depois_de` que leva a etapa uma coluna para o lado pedido, ou `undefined`
 * quando ela já está na ponta. `depois_de` é o vizinho da ESQUERDA na ordem nova
 * (`null` = vira a primeira coluna), o mesmo contrato da rota.
 */
export function depoisDeParaMover(
  etapas: readonly EtapaNaOrdem[],
  etapaId: string,
  direcao: Direcao,
): string | null | undefined {
  const i = etapas.findIndex((e) => e.id === etapaId);
  if (i < 0) return undefined;
  if (direcao === "esquerda") {
    if (i === 0) return undefined;
    return i >= 2 ? (etapas[i - 2]?.id ?? null) : null;
  }
  return etapas[i + 1]?.id;
}

/**
 * Onde a etapa nova deve ficar: logo depois da última etapa ABERTA (nem de
 * fechamento nem de perda). A rota cria sempre no fim do funil, e o fim
 * costuma ser "Ganho"/"Perdido"; uma etapa de trabalho nascendo depois delas
 * obrigaria a pessoa a arrastá-la de volta toda vez.
 *
 * Devolve `undefined` quando o fim já é o lugar certo (não há etapa de
 * fechamento/perda depois da última aberta) e `null` quando todas as etapas são
 * de fechamento/perda (a nova vira a primeira coluna).
 */
export function depoisDeParaEtapaNova(etapas: readonly EtapaNaOrdem[]): string | null | undefined {
  const aberta = (e: EtapaNaOrdem) => !e.is_won && !e.is_lost;
  const ultimaAberta = etapas.findLastIndex(aberta);
  if (ultimaAberta === etapas.length - 1) return undefined;
  return ultimaAberta >= 0 ? (etapas[ultimaAberta]?.id ?? null) : null;
}

/** A etapa que apareceu na lista nova e não estava na antiga. */
export function etapaQueNasceu<T extends { id: string }>(
  antes: readonly { id: string }[],
  depois: readonly T[],
): T | undefined {
  const conhecidas = new Set(antes.map((e) => e.id));
  return depois.find((e) => !conhecidas.has(e.id));
}

/**
 * As etapas para onde os negócios de uma etapa arquivada podem ir: todas as
 * outras vivas, na ordem do quadro. Fechamento e perda entram — mandar para
 * "Perdido" é uma escolha legítima de quem está limpando o funil.
 */
export function destinosAoArquivar<T extends EtapaNaOrdem>(
  etapas: readonly T[],
  etapaId: string,
): T[] {
  return etapas.filter((e) => e.id !== etapaId);
}

/**
 * Lê as etapas do corpo que a rota de etapas devolve (`{ data: { etapas } }`).
 * Corpo fora do formato vira lista vazia: quem chama trata como "não sei qual
 * nasceu" e não reposiciona nada.
 */
export function etapasDaResposta(corpo: unknown): { id: string }[] {
  const dados = (corpo as { data?: { etapas?: unknown } } | null)?.data;
  const etapas = dados?.etapas;
  if (!Array.isArray(etapas)) return [];
  return etapas.filter(
    (e): e is { id: string } => typeof (e as { id?: unknown })?.id === "string",
  );
}
