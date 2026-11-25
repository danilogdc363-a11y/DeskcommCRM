import { estaEncerrada, resumoDasTarefas, type SituacaoDaTarefa, type Tarefa } from "@/lib/tarefas/tipos";
import type { Lead } from "@/lib/types/leads";

import { escolherProximaTarefa } from "./resumo-do-card";

/** A linha de `crm_tasks` como o quadro a lê — só as colunas que esta regra usa. */
export interface LinhaDaTarefaNoQuadro {
  lead_id: string | null;
  due_date: string | null;
  status: SituacaoDaTarefa;
  /** ACELERA (fork): o título, para o card citar a próxima tarefa. Opcional. */
  title?: string | null;
}

/**
 * Anexa a cada negócio do quadro o resumo das tarefas presas a ele — o selo do
 * card ("3 tarefas · 1 atrasada").
 *
 * PURA de propósito, como `anexarDadosDoContato`: a rota do quadro faz UMA
 * leitura de `crm_tasks` para o quadro inteiro e entrega as linhas aqui. A
 * regra fica testável sem banco, já que um `route.ts` do Next só pode exportar
 * os métodos HTTP.
 *
 * A contagem é a de `resumoDasTarefas`, a MESMA régua da lista do dossiê: o
 * selo nunca pode dizer "1 atrasada" sobre um negócio cuja lista não mostra
 * nenhuma. Por isso as linhas encerradas podem vir junto sem estragar nada —
 * quem decide o que conta é a régua, não o filtro de quem consultou.
 *
 * Nenhuma tarefa em aberto não vira campo: o card não mostra selo de zero, e o
 * payload do quadro não engorda com `{ abertas: 0 }` em todo negócio. Negócio
 * sem tarefa passa intacto.
 */
export function anexarTarefasAosNegocios(
  leads: Lead[],
  linhas: readonly LinhaDaTarefaNoQuadro[],
  agora: Date = new Date(),
): Lead[] {
  const porNegocio = new Map<string, Array<Pick<Tarefa, "due_date" | "status"> & { title?: string | null }>>();
  for (const linha of linhas) {
    if (!linha.lead_id) continue;
    const doNegocio = porNegocio.get(linha.lead_id);
    if (doNegocio) doNegocio.push(linha);
    else porNegocio.set(linha.lead_id, [linha]);
  }
  if (porNegocio.size === 0) return leads;

  return leads.map((lead) => {
    const tarefas = porNegocio.get(lead.id);
    if (!tarefas) return lead;
    const resumo = resumoDasTarefas(tarefas, agora);
    if (resumo.abertas === 0) return lead;
    // ACELERA (fork): a próxima tarefa só entra entre as EM ABERTO (a mesma
    // régua do selo) e só quando a linha trouxe o título.
    const proxima = escolherProximaTarefa(tarefas.filter((t) => !estaEncerrada(t)));
    return { ...lead, tarefas: proxima ? { ...resumo, proxima } : resumo };
  });
}
