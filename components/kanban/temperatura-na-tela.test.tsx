import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResumoNoCard } from "./ResumoNoCard";
import { TemperaturaNoDossie } from "./TemperaturaNoDossie";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

const base = { created_at: "2026-11-20T12:00:00", conversa: null, tarefas: undefined, campos_no_card: undefined };
const AGORA = new Date("2026-11-25T12:00:00");

describe("ResumoNoCard — temperatura marcada", () => {
  it("mostra a temperatura marcada à mão", () => {
    render(<ResumoNoCard lead={{ ...base, temperatura_manual: "quente" }} agora={AGORA} />);
    expect(screen.getByTestId("resumo-temperatura").textContent).toBe("Quente");
  });
  it("automático (null) não desenha linha: a da IA tem o medidor próprio", () => {
    render(<ResumoNoCard lead={{ ...base, temperatura_manual: null }} agora={AGORA} />);
    expect(screen.queryByTestId("resumo-temperatura")).toBeNull();
  });
});

describe("TemperaturaNoDossie", () => {
  it("sem como gravar, é só um selo (e nada quando não há marcação)", () => {
    const { container, rerender } = render(<TemperaturaNoDossie valor="morno" />);
    expect(screen.getByTestId("dossie-temperatura").textContent).toBe("Morno");
    rerender(<TemperaturaNoDossie valor={null} />);
    expect(container.firstChild).toBeNull();
  });
  it("com como gravar, mostra o seletor", () => {
    render(<TemperaturaNoDossie valor={null} onMudar={() => {}} />);
    expect(screen.getByTestId("dossie-temperatura-select").textContent).toContain("Temperatura: automática");
  });
});
