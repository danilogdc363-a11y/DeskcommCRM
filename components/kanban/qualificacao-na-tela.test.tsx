import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QualificacaoNoDossie } from "./QualificacaoNoDossie";
import { ResumoNoCard } from "./ResumoNoCard";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

const PERGUNTAS = [
  { key: "decisor", label: "É o decisor?", type: "boolean", qualificacao: true },
  { key: "orcamento", label: "Tem orçamento?", type: "boolean", qualificacao: true },
  { key: "solucao", label: "Precisa da nossa solução?", type: "boolean", qualificacao: true },
  { key: "momento", label: "Está no momento certo?", type: "boolean", qualificacao: true },
];

describe("QualificacaoNoDossie", () => {
  it("mostra o 3/4 e a resposta de cada pergunta", () => {
    render(
      <QualificacaoNoDossie
        campos={PERGUNTAS}
        valores={{ decisor: true, orcamento: true, solucao: true, momento: false }}
      />,
    );
    expect(screen.getByText("3/4")).toBeTruthy();
    expect(screen.getByTestId("qualificacao-item-decisor").getAttribute("data-marcado")).toBe("true");
    expect(screen.getByTestId("qualificacao-item-momento").getAttribute("data-marcado")).toBe("false");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("3");
  });

  it("funil sem pergunta marcada não desenha nada", () => {
    const { container } = render(
      <QualificacaoNoDossie campos={[{ key: "x", label: "X", type: "boolean" }]} valores={{ x: true }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("ResumoNoCard — qualificação", () => {
  const base = { created_at: "2026-11-20T12:00:00", conversa: null, tarefas: undefined, campos_no_card: undefined };

  it("mostra 'Qualificação 2/4' no card", () => {
    render(<ResumoNoCard lead={{ ...base, qualificacao: { marcados: 2, total: 4 } }} agora={new Date("2026-11-25T12:00:00")} />);
    expect(screen.getByTestId("resumo-qualificacao").textContent).toBe("Qualificação 2/4");
  });

  it("sem qualificação no negócio, o card não ganha linha nenhuma", () => {
    render(<ResumoNoCard lead={{ ...base }} agora={new Date("2026-11-25T12:00:00")} />);
    expect(screen.queryByTestId("resumo-qualificacao")).toBeNull();
  });
});
