/**
 * As regras PURAS do pós-venda que vai às plataformas de anúncio.
 *
 * O `Purchase` inicial ensina à Meta quem FECHA. Para ela aprender quem FICA
 * (LTV), o cliente ativo precisa continuar gerando sinal depois da venda. O
 * contrato é mensal — não há "renovação" para marcar —, então o sinal é a
 * interação forte de quem está ativo: a reunião com o cliente REALIZADA.
 *
 * Onde o cliente ativo mora: num negócio ABERTO do funil `is_client_pipeline`
 * (0262), com a mensalidade em `crm_leads.recurring_value_cents`. Os gatilhos
 * são eventos que o banco já emite — nenhum trigger novo:
 *  - `ClienteAtivo` = `appointment.completed` de um contato que tem negócio
 *    aberto no funil de clientes. "Realizada", nunca "agendada": falta não conta;
 *  - `Cancelamento` = o negócio do funil de clientes é PERDIDO (`lead.lost`).
 *
 * Fora, por decisão do dono do produto: clique em link (clicar não prova
 * engajamento — a Meta aprenderia quem clica, não quem fica) e NPS (entra
 * quando o formulário existir, como outro gatilho do mesmo evento).
 *
 * ═══ SEM DUPLA CONTAGEM ═══
 *
 * A Meta descarta a segunda cópia com o mesmo `event_id`, e o livro-razão
 * (`ad_conversion_dispatches`) tem uma linha por (negócio, `event_name`). Por isso:
 *  - a venda inicial continua `Purchase` no negócio do funil de vendas, com
 *    `event_id = <negócio>:Purchase` — nada muda nela;
 *  - o clone no funil de clientes NÃO manda `Purchase` (o consumidor de venda o
 *    pula): é o mesmo dinheiro, contado de novo;
 *  - `ClienteAtivo` é UM por negócio por mês: chave `ClienteAtivo:<AAAA-MM>`.
 *    Três reuniões no mesmo mês contam uma vez, e cada mês ativo soma uma
 *    mensalidade — o valor acumulado na Meta acompanha o LTV;
 *  - o cancelamento é um por negócio: `Cancelamento`.
 */

/** O nome no fio do sinal de cliente ativo (evento personalizado). */
export const EVENTO_DE_CLIENTE_ATIVO = "ClienteAtivo" as const;

/**
 * O nome no fio do cancelamento. Evento personalizado e sem valor: a Meta não
 * aceita reembolso pela API de Conversões. Serve para público de exclusão e
 * leitura.
 */
export const EVENTO_DE_CANCELAMENTO = "Cancelamento" as const;

const PADRAO_DO_CLIENTE_ATIVO = /^ClienteAtivo:\d{4}-(0[1-9]|1[0-2])$/;

/**
 * O mês da interação no relógio da ORGANIZAÇÃO, `AAAA-MM`. Uma reunião às 22h
 * do dia 31 em Brasília é dia 1º em UTC: pelo relógio do servidor ela contaria
 * no mês errado — e poderia somar dois meses ativos num só.
 */
export function mesDaInteracao(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instante);
  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  return `${ano}-${mes}`;
}

/** A chave do cliente ativo no livro-razão, a partir do mês `AAAA-MM`. */
export function eventoDeClienteAtivo(mes: string): `ClienteAtivo:${string}` {
  return `ClienteAtivo:${mes}`;
}

export function ehEventoDeClienteAtivo(nome: unknown): nome is `ClienteAtivo:${string}` {
  return typeof nome === "string" && PADRAO_DO_CLIENTE_ATIVO.test(nome);
}

/** É um evento que o consumidor de pós-venda atende (e nenhum outro deve)? */
export function ehEventoDePosVenda(nome: unknown): boolean {
  return ehEventoDeClienteAtivo(nome) || nome === EVENTO_DE_CANCELAMENTO;
}

/**
 * O valor do mês ativo, em centavos — a mensalidade, ou `null` quando não há o
 * que mandar. Nunca zero: a Meta aceitaria e o otimizador aprenderia que o
 * cliente que fica não vale nada — o mesmo motivo do `sem_valor` da venda.
 */
export function valorDoMesAtivo(recorrenteCentavos: number | null | undefined): number | null {
  return Number.isInteger(recorrenteCentavos) && (recorrenteCentavos as number) > 0
    ? (recorrenteCentavos as number)
    : null;
}
