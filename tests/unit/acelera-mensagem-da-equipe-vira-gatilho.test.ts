/**
 * (Acelera) `message.team_sent` — a frase-código do vendedor como gatilho.
 *
 * O que este arquivo cobra é o PAR que faz a regra rodar de verdade: o tipo está
 * no vocabulário do motor (senão o handler não o assina), tem rótulo e campo de
 * texto na tela (senão ninguém monta a regra), e a migration o emite só para a
 * fala humana e FORA da lista de registro (senão nasce `done` e nada roda).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TRIGGER_LABELS } from "@/app/app/webhooks/_components/labels";
import { CURATED_FIELDS } from "@/app/app/webhooks/_components/RuleEditor";
import { automationRulesHandler } from "@/lib/automation/engine.handler";
import { evaluateConditions } from "@/lib/automation/conditions";
import { ENTIDADE_ESPERADA_POR_GATILHO, TRIGGER_EVENTS } from "@/lib/schemas/webhooks";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261101000001_acelera_0001_mensagem_da_equipe_vira_gatilho.sql",
  ),
  "utf8",
);

describe("message.team_sent", () => {
  it("é gatilho de mensagem e o motor de automações o assina", () => {
    expect(TRIGGER_EVENTS).toContain("message.team_sent");
    expect(ENTIDADE_ESPERADA_POR_GATILHO["message.team_sent"]).toBe("message");
    expect(automationRulesHandler.events).toContain("message.team_sent");
  });

  it("aparece na tela com o filtro pelo texto da mensagem", () => {
    expect(TRIGGER_LABELS["message.team_sent"]).toMatch(/equipe/);
    expect(CURATED_FIELDS["message.team_sent"].map((f) => f.value)).toContain("event.body_preview");
  });

  it("a frase-código casa pelo texto, sem diferença de caixa", () => {
    const ctx = { event: { body_preview: "Parabéns pela sua decisão! Seja bem-vindo" } };
    const cond = [{ field: "event.body_preview", op: "contains", value: "parabéns pela sua decisão" }];
    expect(evaluateConditions(cond as never, ctx)).toBe(true);
    expect(evaluateConditions(cond as never, { event: { body_preview: "Oi, tudo bem?" } })).toBe(false);
  });

  it("a migration só emite fala humana de saída e não mexe na lista de registro", () => {
    expect(migration).toMatch(/new\.direction = 'outbound'/);
    expect(migration).toMatch(/new\.sent_via in \('user', 'crm', 'external_device'\)/);
    expect(migration).toMatch(/'message\.team_sent'/);
    expect(migration).toMatch(/c\.is_group/);
    expect(migration).not.toMatch(/function public.fn_event_log_e_registro/);
  });
});
