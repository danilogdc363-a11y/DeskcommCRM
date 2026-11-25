/**
 * As contas do resumo do card: "chegou há N dias", "último contato há N dias" e a
 * próxima tarefa com data.
 *
 * PURAS de propósito: o card passa o relógio (`agora`) e o servidor passa as
 * linhas, então a regra é testável sem tela nem banco. O relógio não mora aqui
 * dentro para que dois cards do mesmo quadro nunca discordem do "hoje".
 */

const MS_POR_DIA = 86_400_000;

/**
 * Dias INTEIROS desde `iso` até `agora`. `null` quando não há data (ou ela não
 * é uma data): o card não escreve "há 0 dias" sobre o que não sabe — "sem
 * contato" e "contato hoje" são coisas diferentes.
 *
 * Data no futuro (relógio do cliente atrasado, importação) vira 0, nunca
 * negativo.
 */
export function diasDesde(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null;
  const quando = new Date(iso).getTime();
  if (Number.isNaN(quando)) return null;
  return Math.max(0, Math.floor((agora.getTime() - quando) / MS_POR_DIA));
}

/** A tarefa que o card cita: a de prazo mais próximo entre as EM ABERTO. */
export interface ProximaTarefa {
  titulo: string;
  /** ISO-8601; `null` = sem prazo (só é citada quando nenhuma outra tem prazo). */
  due_date: string | null;
}

/**
 * Escolhe a próxima tarefa a citar no card.
 *
 * Regra: a de prazo mais cedo; as sem prazo só entram se NENHUMA tem prazo
 * (uma tarefa "sem data" não é "a próxima"). Empate no prazo: a de título menor
 * na ordem alfabética, para o card não trocar de tarefa entre dois refetches.
 * Atrasada conta como a mais próxima de todas — é a que pede ação agora.
 */
export function escolherProximaTarefa(
  tarefas: ReadonlyArray<{ title?: string | null; due_date: string | null }>,
): ProximaTarefa | undefined {
  let melhor: { titulo: string; due_date: string | null; ts: number } | undefined;
  for (const tarefa of tarefas) {
    const titulo = tarefa.title?.trim();
    if (!titulo) continue;
    const ts = tarefa.due_date ? new Date(tarefa.due_date).getTime() : Number.POSITIVE_INFINITY;
    const valido = Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
    if (
      !melhor ||
      valido < melhor.ts ||
      (valido === melhor.ts && titulo.localeCompare(melhor.titulo, "pt-BR") < 0)
    ) {
      melhor = { titulo, due_date: tarefa.due_date, ts: valido };
    }
  }
  return melhor ? { titulo: melhor.titulo, due_date: melhor.due_date } : undefined;
}

/** `dd/MM` no relógio de quem olha — o "25/11" do "Fazer follow up 25/11". */
export function diaEMes(iso: string): string | null {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}
