/**
 * Cor de cada etapa do funil.
 *
 * A coluna `crm_stages.color` já existe no banco (`#RRGGBB` ou nula, com CHECK
 * `crm_stages_color_format`). Este módulo só decide: quais cores o gestor
 * escolhe, qual cor uma etapa SEM cor usa (por posição, para já nascer
 * colorida) e se um hex digitado é aceitável.
 *
 * Função pura, sem React: a mesma conta serve ao quadro, à API e aos testes.
 */

/** `#RRGGBB`, igual ao CHECK do banco (maiúscula ou minúscula). */
const HEX_COMPLETO = /^#[0-9a-fA-F]{6}$/;

export interface CorDaPaleta {
  /** Chave estável; o rótulo visível é traduzido na tela, não aqui. */
  chave: string;
  hex: string;
}

/**
 * 10 cores de meio-tom: legíveis como bolinha e borda tanto no tema claro
 * quanto no escuro. Sem o verde do WhatsApp: o verde (`#16A34A`, mais fechado)
 * existe só para etapa de ganho.
 */
export const PALETA_DE_ETAPA: readonly CorDaPaleta[] = [
  { chave: "laranja", hex: "#FF7300" },
  { chave: "ambar", hex: "#D99A00" },
  { chave: "vermelho", hex: "#E5484D" },
  { chave: "rosa", hex: "#D6409F" },
  { chave: "violeta", hex: "#8E4EC6" },
  { chave: "azul", hex: "#3E63DD" },
  { chave: "ciano", hex: "#0090B8" },
  { chave: "turquesa", hex: "#12A594" },
  { chave: "verde", hex: "#16A34A" },
  { chave: "cinza", hex: "#6B7280" },
];

const HEX_DA = (chave: string): string => PALETA_DE_ETAPA.find((c) => c.chave === chave)!.hex;

/** Ordem das etapas comuns sem cor: sem verde (é do ganho) nem vermelho (é da perda). */
const CICLO_PADRAO: readonly string[] = [
  HEX_DA("azul"),
  HEX_DA("violeta"),
  HEX_DA("ciano"),
  HEX_DA("turquesa"),
  HEX_DA("ambar"),
  HEX_DA("laranja"),
  HEX_DA("rosa"),
];

export function hexValido(valor: string): boolean {
  return HEX_COMPLETO.test(valor);
}

/**
 * Aceita o que a pessoa digita ("ff7300", "#FF7300", " #ff7300 ") e devolve
 * `#RRGGBB` em maiúscula, ou `null` se não for uma cor completa. Atalho de 3
 * dígitos não é aceito: o banco exige 6.
 */
export function normalizarHex(entrada: string): string | null {
  const limpo = entrada.trim();
  const comHash = limpo.startsWith("#") ? limpo : `#${limpo}`;
  return hexValido(comHash) ? comHash.toUpperCase() : null;
}

interface EtapaParaCor {
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
}

/** Cor padrão de uma etapa sem cor definida, pela posição (0 = primeira). */
export function corPadraoDaPosicao(posicao: number, etapa?: Pick<EtapaParaCor, "is_won" | "is_lost">): string {
  if (etapa?.is_won) return HEX_DA("verde");
  if (etapa?.is_lost) return HEX_DA("vermelho");
  const i = ((Math.trunc(posicao) % CICLO_PADRAO.length) + CICLO_PADRAO.length) % CICLO_PADRAO.length;
  return CICLO_PADRAO[i]!;
}

/** A cor que a etapa MOSTRA: a escolhida, ou a padrão da posição. */
export function corDaEtapa(etapa: EtapaParaCor, posicao: number): string {
  return etapa.color && hexValido(etapa.color) ? etapa.color : corPadraoDaPosicao(posicao, etapa);
}

/** Preto ou branco, o que contrastar mais com `hex` (luminância WCAG). */
export function corDoTextoSobre(hex: string): "#000000" | "#FFFFFF" {
  const canais = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminancia = 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
  // Ponto de virada onde preto e branco têm o mesmo contraste: ~0.179.
  return luminancia > 0.179 ? "#000000" : "#FFFFFF";
}
