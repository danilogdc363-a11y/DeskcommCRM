/**
 * ACELERA (fork): a QUALIFICAÇÃO do negócio — o "3/4" do checklist de perguntas
 * (é o decisor? tem orçamento? precisa da solução? está no momento certo?).
 *
 * Nada novo no banco: cada pergunta é um campo `boolean` do funil que o operador
 * marcou "Conta na qualificação" (`qualificacao: true` em `settings.fields`), e a
 * resposta é o `true`/`false` que já mora em `crm_leads.custom_fields`. As
 * perguntas são DO FUNIL — cada empresa escreve as suas, e nenhuma é fixa no código.
 *
 * Marcado = `true`. Campo sem resposta (nunca tocado) e `false` contam igual: não
 * está qualificado nesse ponto. A diferença entre "não" e "ainda não perguntei"
 * não muda o número, e inventá-la pediria um terceiro estado que o checkbox não tem.
 */

/** O mínimo que a regra precisa de um campo — serve à definição do funil e à do editor. */
export interface CampoDeQualificacao {
  key: string;
  label: string;
  type: string;
  qualificacao?: boolean;
  escopo?: "negocio" | "contato";
}

export interface ItemDaQualificacao {
  chave: string;
  rotulo: string;
  marcado: boolean;
}

export interface QualificacaoDoNegocio {
  marcados: number;
  total: number;
  itens: ItemDaQualificacao[];
}

/** O resumo que viaja no card: só os números (as perguntas o dossiê lê do funil). */
export type QualificacaoNoCard = Pick<QualificacaoDoNegocio, "marcados" | "total">;

/**
 * As perguntas da qualificação: campos `boolean`, do NEGÓCIO (o valor do contato mora
 * em outra tabela), marcados pelo operador — na ordem em que o funil os declara.
 */
export function camposDeQualificacao<T extends CampoDeQualificacao>(campos: readonly T[]): T[] {
  return campos.filter(
    (campo) => campo.qualificacao === true && campo.type === "boolean" && campo.escopo !== "contato",
  );
}

/** `null` = o funil não definiu pergunta nenhuma (a tela não desenha o bloco). */
export function qualificacaoDoNegocio(
  campos: readonly CampoDeQualificacao[],
  valores: Record<string, unknown> | null | undefined,
): QualificacaoDoNegocio | null {
  const perguntas = camposDeQualificacao(campos);
  if (perguntas.length === 0) return null;
  const respostas = valores ?? {};
  const itens = perguntas.map((campo) => ({
    chave: campo.key,
    rotulo: campo.label,
    marcado: respostas[campo.key] === true,
  }));
  return { marcados: itens.filter((item) => item.marcado).length, total: itens.length, itens };
}

/**
 * Anexa a cada negócio do quadro o resumo "marcados/total".
 *
 * PURA como `anexarCamposNoCard`: o `custom_fields` já vem no negócio. Funil sem
 * pergunta marcada devolve os MESMOS objetos, sem chave nova.
 */
export function anexarQualificacao<T extends { custom_fields?: Record<string, unknown> | null }>(
  leads: T[],
  campos: readonly CampoDeQualificacao[],
): Array<T & { qualificacao?: QualificacaoNoCard }> {
  if (camposDeQualificacao(campos).length === 0) return leads;
  return leads.map((lead) => {
    const q = qualificacaoDoNegocio(campos, lead.custom_fields);
    return q ? { ...lead, qualificacao: { marcados: q.marcados, total: q.total } } : lead;
  });
}
