/**
 * "PRIMEIRA MENSAGEM DA EQUIPE → EM ATENDIMENTO" PRECISA SABER A ETAPA ATUAL.
 *
 * Sem o negócio no contexto da fala da equipe, a regra só consegue dizer "mande
 * para Em atendimento", e `create_or_move_lead` obedece a CADA mensagem: quem já
 * estava em Reunião marcada voltaria para trás. Com `lead.stage_id` na condição,
 * a regra só casa enquanto o card ainda está em Pedido novo — a primeira fala.
 *
 * Mede pelas peças reais: `buildContext` + `evaluateConditions`, e o campo que o
 * `RuleEditor` oferece é lido do próprio arquivo, não digitado aqui.
 *
 *     npx vitest run tests/unit/primeira-mensagem-da-equipe-move-o-card.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateConditions } from "@/lib/automation/conditions";
import { buildContext } from "@/lib/automation/engine";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const CONTATO = "dddddddd-0000-4000-8000-00000000000d";
const PEDIDO_NOVO = "eeeeeeee-0000-4000-8000-000000000001";
const EM_ATENDIMENTO = "eeeeeeee-0000-4000-8000-000000000002";

type Linha = Record<string, unknown>;

/** Banco em memória: `eq` filtra, `order` + `limit` pegam o mais recente. */
function banco(tabelas: Record<string, Linha[]>): SupabaseClient {
  return {
    from: (tabela: string) => ({
      select: () => {
        let linhas = [...(tabelas[tabela] ?? [])];
        const cadeia: Record<string, unknown> = {};
        cadeia.eq = (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return cadeia;
        };
        cadeia.order = (coluna: string, opcoes?: { ascending?: boolean }) => {
          const sinal = opcoes?.ascending === false ? -1 : 1;
          linhas.sort((a, b) => sinal * String(a[coluna]).localeCompare(String(b[coluna])));
          return cadeia;
        };
        cadeia.limit = (n: number) => {
          linhas = linhas.slice(0, n);
          return cadeia;
        };
        cadeia.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
        return cadeia;
      },
    }),
  } as unknown as SupabaseClient;
}

const CONTATO_LINHA: Linha = { id: CONTATO, organization_id: ORG, name: "Cliente" };

function negocio(id: string, etapa: string, criadoEm: string, status = "open"): Linha {
  return {
    id,
    organization_id: ORG,
    contact_id: CONTATO,
    stage_id: etapa,
    status,
    created_at: criadoEm,
  };
}

function evento(tipo: string): EventRow {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    organization_id: ORG,
    event_type: tipo,
    entity_kind: "message",
    entity_id: "22222222-0000-4000-8000-000000000002",
    payload: { contact_id: CONTATO, body_preview: "Olá!" },
  } as unknown as EventRow;
}

const SO_NA_PRIMEIRA = [{ field: "lead.stage_id", op: "eq" as const, value: PEDIDO_NOVO }];

describe("fala da equipe: o negócio entra no contexto", () => {
  it("card ainda em Pedido novo: a condição casa (é a primeira fala)", async () => {
    const db = banco({
      contacts: [CONTATO_LINHA],
      crm_leads: [negocio("l1", PEDIDO_NOVO, "2026-11-04T10:00:00Z")],
    });
    const contexto = await buildContext(db, evento("message.team_sent"));
    expect((contexto.lead as Linha).id).toBe("l1");
    expect(evaluateConditions(SO_NA_PRIMEIRA, contexto)).toBe(true);
  });

  it("card que já avançou: a condição não casa e a regra não puxa ele para trás", async () => {
    const db = banco({
      contacts: [CONTATO_LINHA],
      crm_leads: [negocio("l1", EM_ATENDIMENTO, "2026-11-04T10:00:00Z")],
    });
    const contexto = await buildContext(db, evento("message.team_sent"));
    expect(evaluateConditions(SO_NA_PRIMEIRA, contexto)).toBe(false);
  });

  it("vale o negócio ABERTO mais recente; o fechado não conta", async () => {
    const db = banco({
      contacts: [CONTATO_LINHA],
      crm_leads: [
        negocio("antigo", PEDIDO_NOVO, "2026-10-01T10:00:00Z"),
        negocio("recente", EM_ATENDIMENTO, "2026-11-01T10:00:00Z"),
        negocio("fechado", PEDIDO_NOVO, "2026-11-03T10:00:00Z", "won"),
      ],
    });
    const contexto = await buildContext(db, evento("message.team_sent"));
    expect((contexto.lead as Linha).id).toBe("recente");
  });

  it("contato sem negócio aberto: sem lead, e a condição não casa", async () => {
    const db = banco({ contacts: [CONTATO_LINHA], crm_leads: [] });
    const contexto = await buildContext(db, evento("message.team_sent"));
    expect(contexto.lead).toBeUndefined();
    expect(evaluateConditions(SO_NA_PRIMEIRA, contexto)).toBe(false);
  });

  it("outros gatilhos de mensagem seguem sem `lead` (regras antigas não mudam)", async () => {
    const db = banco({
      contacts: [CONTATO_LINHA],
      crm_leads: [negocio("l1", PEDIDO_NOVO, "2026-11-04T10:00:00Z")],
    });
    const contexto = await buildContext(db, evento("message.received"));
    expect(contexto.lead).toBeUndefined();
  });
});

describe("o editor oferece a condição", () => {
  const fonte = readFileSync(
    path.join(process.cwd(), "app/app/webhooks/_components/RuleEditor.tsx"),
    "utf8",
  );

  it("a fala da equipe oferece 'Etapa atual do negócio' com a lista de etapas", () => {
    expect(fonte).toMatch(/"message\.team_sent":\s*\[\.\.\.MESSAGE_FIELDS,\s*ETAPA_ATUAL_FIELD\]/);
    expect(fonte).toMatch(
      /ETAPA_ATUAL_FIELD[^=]*=\s*\{\s*value:\s*"lead\.stage_id",\s*label:\s*"Etapa atual do negócio",\s*op:\s*"eq",\s*kind:\s*"stage"/s,
    );
  });

  it("a mensagem recebida NÃO oferece o campo (o contexto dela não tem negócio)", () => {
    expect(fonte).toMatch(/"message\.received":\s*MESSAGE_FIELDS,/);
  });
});
