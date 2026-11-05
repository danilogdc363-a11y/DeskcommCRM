import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { countAs, sql } from "./gov-helpers";

/**
 * (Acelera) `mensagens_agendadas` (migration acelera_0004): quem atende lê só as
 * agendas da própria organização, cria só em nome próprio e só cancela linha
 * pendente; conversa de outra organização é recusada pela policy de insert.
 */
const orgA = randomUUID(), orgB = randomUUID();
const sessA = randomUUID(), sessB = randomUUID();
const userA = randomUUID(), userB = randomUUID();
const ctA = randomUUID(), ctB = randomUUID();
const convA = randomUUID(), convB = randomUUID();
const agA = randomUUID(), agB = randomUUID();

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${userA}', 'ag-a@invariant.test'), ('${userB}', 'ag-b@invariant.test');`);
  for (const [org, sess, user, ct, conv, ag] of [
    [orgA, sessA, userA, ctA, convA, agA],
    [orgB, sessB, userB, ctB, convB, agB],
  ] as const) {
    sql(`insert into organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Ag', 'Ag');
      insert into user_organizations (user_id, organization_id, role, accepted_at) values ('${user}', '${org}', 'agent', now());
      insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values ('${sess}', '${org}', '${sess}', '\\x00');
      insert into contacts (id, organization_id, display_name) values ('${ct}', '${org}', 'Contato');
      insert into conversations (id, organization_id, contact_id, channel_session_id, status) values ('${conv}', '${org}', '${ct}', '${sess}', 'open');
      insert into mensagens_agendadas (id, organization_id, conversation_id, corpo, enviar_em, criado_por)
        values ('${ag}', '${org}', '${conv}', 'oi', now() + interval '1 hour', '${user}');`);
  }
});

describe("mensagens_agendadas: RLS", () => {
  it("lê a agenda da própria organização e zero da outra, nos dois sentidos", () => {
    expect(countAs(userA, `select count(*) from mensagens_agendadas where id = '${agA}';`)).toBe(1);
    expect(countAs(userA, `select count(*) from mensagens_agendadas where id = '${agB}';`)).toBe(0);
    expect(countAs(userB, `select count(*) from mensagens_agendadas where id = '${agA}';`)).toBe(0);
    expect(countAs(userB, `select count(*) from mensagens_agendadas where id = '${agB}';`)).toBe(1);
  });

  it("não agenda em conversa de outra organização", () => {
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${userA}"}', false);
        insert into mensagens_agendadas (organization_id, conversation_id, corpo, enviar_em, criado_por)
          values ('${orgA}', '${convB}', 'x', now() + interval '1 hour', '${userA}');`),
    ).toThrow(/row-level security/);
  });

  it("cancela a própria linha pendente, mas não a do vizinho nem muda o corpo", () => {
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${userA}"}', false);
        update mensagens_agendadas set corpo = 'trocado' where id = '${agA}';`),
    ).toThrow(/permission denied/);
    expect(
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${userA}"}', false);
        with c as (update mensagens_agendadas set status = 'cancelada', cancelado_por = '${userA}' where id = '${agB}' returning 1)
        select count(*) from c;`).split("\n"),
    ).toContain("0");
  });
});
