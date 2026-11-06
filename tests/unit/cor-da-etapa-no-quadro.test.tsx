// COR DA ETAPA NO QUADRO.
// Quem pode editar (mesmo corte do renomear) abre a paleta pela bolinha e
// escolhe; a etapa sem cor já aparece colorida pela posição; hex inválido não
// sai da tela.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DragDropContext } from "@hello-pangea/dnd";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/kanban/KanbanCard", () => ({ KanbanCard: () => null }));

import { StageColumn } from "@/components/kanban/StageColumn";
import { corPadraoDaPosicao } from "@/lib/kanban/cores-de-etapa";
import type { Stage } from "@/lib/kanban/types";

const etapa = (color: string | null) =>
  ({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    pipeline_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Proposta",
    position: 1,
    color,
    is_won: false,
    is_lost: false,
  }) as unknown as Stage;

function montar(opts: { color?: string | null; pode: boolean; posicao?: number }) {
  const onMudarCor = vi.fn();
  const stage = etapa(opts.color ?? null);
  const { container } = render(
    <DragDropContext onDragEnd={() => {}}>
      <StageColumn
        stage={stage}
        leads={[]}
        pipelineId={stage.pipeline_id}
        podeRenomear={opts.pode}
        onRenomear={() => {}}
        posicao={opts.posicao ?? 0}
        onMudarCor={onMudarCor}
      />
    </DragDropContext>,
  );
  return { onMudarCor, coluna: container.querySelector("[data-etapa-do-quadro]") as HTMLElement };
}

describe("cor da etapa no quadro", () => {
  it("etapa sem cor nasce colorida pela posição", () => {
    const { coluna } = montar({ pode: false, posicao: 2 });
    expect(coluna.dataset.corDaEtapa).toBe(
      corPadraoDaPosicao(2, { is_won: false, is_lost: false }),
    );
  });

  it("a cor escolhida manda na coluna", () => {
    const { coluna } = montar({ color: "#3E63DD", pode: false });
    expect(coluna.dataset.corDaEtapa).toBe("#3E63DD");
  });

  it("quem não pode editar não tem botão de cor", () => {
    montar({ pode: false });
    expect(screen.queryByRole("button", { name: /Cor da etapa/ })).toBeNull();
  });

  it("escolher na paleta manda o hex e fecha", async () => {
    const { onMudarCor } = montar({ pode: true });
    await userEvent.click(screen.getByRole("button", { name: /Cor da etapa/ }));
    await userEvent.click(screen.getByRole("button", { name: "Violeta" }));
    expect(onMudarCor).toHaveBeenCalledExactlyOnceWith("#8E4EC6");
  });

  it("cor livre: aceita sem #, recusa hex quebrado", async () => {
    const { onMudarCor } = montar({ pode: true });
    await userEvent.click(screen.getByRole("button", { name: /Cor da etapa/ }));
    const campo = screen.getByLabelText("Outra cor (hex)");
    await userEvent.type(campo, "12ab");
    expect((screen.getByRole("button", { name: "Usar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Use o formato #RRGGBB.")).toBeTruthy();
    await userEvent.clear(campo);
    await userEvent.type(campo, "12ab9f{Enter}");
    expect(onMudarCor).toHaveBeenCalledExactlyOnceWith("#12AB9F");
  });

  it("'Voltar à cor padrão' só aparece quando há cor escolhida e manda null", async () => {
    const { onMudarCor } = montar({ color: "#3E63DD", pode: true });
    await userEvent.click(screen.getByRole("button", { name: /Cor da etapa/ }));
    await userEvent.click(screen.getByText("Voltar à cor padrão"));
    expect(onMudarCor).toHaveBeenCalledExactlyOnceWith(null);
  });
});
