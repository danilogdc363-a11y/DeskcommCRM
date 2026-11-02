/** (Acelera) Qual etapa envia cada evento, e quando o botão fica fechado. */
import { describe, expect, it } from "vitest";

import {
  FUNIL_DE_ORCAMENTOS_ID,
  leadDaConversa,
  opcoesDeEvento,
  type EtapaDoFunil,
} from "@/lib/acelera/eventos-da-conversa";
import type { RegraDeConversaoMeta } from "@/lib/conversoes/regras-meta";

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const etapa = (n: number, name: string, extra: Partial<EtapaDoFunil> = {}): EtapaDoFunil => ({
  id: U(n),
  name,
  position: n,
  is_won: false,
  is_lost: false,
  ...extra,
});
const etapas = [
  etapa(1, "Pedido novo"),
  etapa(2, "Em atendimento"),
  etapa(3, "Reunião marcada"),
  etapa(4, "Reunião feita"),
  etapa(5, "Fechou", { is_won: true }),
];
const regra = (n: number, metaEvent: RegraDeConversaoMeta["metaEvent"], enabled = true): RegraDeConversaoMeta => ({
  id: `r${n}`,
  stageId: U(n),
  eventName: `MetaEtapa:${U(n)}`,
  metaEvent,
  enabled,
  configuredAt: "2026-11-01T00:00:00Z",
});
const regras = [regra(2, "Respondidos"), regra(3, "Schedule"), regra(4, "QualifiedLead")];
const opcoes = (extra = {}) =>
  opcoesDeEvento({ etapas, etapaAtualId: U(1), regras, registros: [], origem: "meta", ...extra });
const de = (lista: ReturnType<typeof opcoes>, chave: string) => lista.find((o) => o.chave === chave)!;

describe("opcoesDeEvento", () => {
  it("acha a etapa pela regra ligada, e Fechou pela etapa de ganho", () => {
    const l = opcoes();
    expect(l.map((o) => o.stageId)).toEqual([U(2), U(3), U(4), U(5)]);
    expect(l.every((o) => o.bloqueio === null)).toBe(true);
  });
  it("regra desligada não conta", () => {
    expect(de(opcoes({ regras: [regra(2, "Respondidos", false)] }), "respondidos").bloqueio).toMatch(/Nenhuma etapa/);
  });
  it("respeita a idempotência: já enviado não dispara de novo", () => {
    const registros = [
      { event_name: `MetaEtapa:${U(3)}`, status: "sent", reason: null, detail: null, attempted_at: null },
    ];
    expect(de(opcoes({ registros }), "reuniao_marcada").bloqueio).toMatch(/já foi enviado/);
  });
  it("não anda para trás nem repete a etapa atual", () => {
    const l = opcoes({ etapaAtualId: U(3) });
    expect(de(l, "respondidos").bloqueio).toMatch(/já passou/);
    expect(de(l, "reuniao_marcada").bloqueio).toMatch(/já está/);
    expect(de(l, "reuniao_feita").bloqueio).toBeNull();
  });
  it("sem origem da Meta avisa antes de mover o card", () => {
    expect(de(opcoes({ origem: "nenhuma" }), "fechou").bloqueio).toMatch(/origem/);
    const outra = opcoes({ origem: "outra" });
    expect(de(outra, "respondidos").bloqueio).toMatch(/origem/);
    expect(de(outra, "fechou").bloqueio).toBeNull();
  });
});

describe("leadDaConversa", () => {
  it("prefere o funil de Orçamentos, senão o primeiro, senão nenhum", () => {
    const a = { pipeline_id: "outro" };
    const b = { pipeline_id: FUNIL_DE_ORCAMENTOS_ID };
    expect(leadDaConversa([a, b])).toBe(b);
    expect(leadDaConversa([a])).toBe(a);
    expect(leadDaConversa([])).toBeNull();
  });
});
