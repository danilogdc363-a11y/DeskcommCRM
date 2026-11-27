/**
 * (Acelera) Venda parada por falta de valor sai sozinha quando o valor chega.
 *
 * O caso real (18/11/2026): negócio ganho com o valor em branco, compra pulada
 * por `sem_valor`, valor preenchido seis horas depois — e ninguém clicou em
 * reprocessar. A migration acelera_0012 põe um gatilho em `crm_leads.value_cents`
 * que pede o reenvio pela mesma porta do botão.
 *
 * Em Postgres de verdade porque a regra inteira mora no banco (gatilho, `when`
 * e a porta `fn_solicitar_reenvio_conversao`): não há TypeScript para imitar.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GOV_ORG, GOV_LEAD, seedGov, sql } from "./gov-helpers";

beforeAll(seedGov);

const pendencia = (status: string, reason: string) => `
 insert into public.ad_conversion_dispatches (organization_id, lead_id, platform, event_name, status, reason)
 values ('${GOV_ORG}', '${GOV_LEAD}', 'meta_ads', 'Purchase', '${status}', '${reason}')
 on conflict (organization_id,lead_id,event_name) do update set status='${status}', reason='${reason}';`;

const ganhoSemValor = `begin;
 update public.crm_leads set status='won', closed_at=now(), value_cents=null where id='${GOV_LEAD}';`;

const pedidosDeReenvio = `select count(*) from public.event_log
  where organization_id='${GOV_ORG}' and entity_id='${GOV_LEAD}'
    and event_type='ad_conversion.retry_requested' and payload->>'event_name'='Purchase';`;

const motivo = `select reason from public.ad_conversion_dispatches
  where organization_id='${GOV_ORG}' and lead_id='${GOV_LEAD}' and event_name='Purchase';`;

describe("(Acelera) valor preenchido depois do fechamento", () => {
  it("pede o reenvio da venda parada por falta de valor, uma vez só", () => {
    const out = sql(`${ganhoSemValor}${pendencia("skipped", "sem_valor")}
      update public.crm_leads set value_cents=250000 where id='${GOV_LEAD}';
      ${pedidosDeReenvio}
      ${motivo}
      update public.crm_leads set value_cents=300000 where id='${GOV_LEAD}';
      ${pedidosDeReenvio}
      rollback;`);
    // Corrigir o valor de novo não empilha outro pedido: o gatilho só dispara
    // quando o valor SAI de vazio, e a pendência já deixou de ser `sem_valor`.
    // O `UPDATE 1` é a linha que o psql imprime para a segunda edição.
    expect(out).toContain("1\nreprocessamento_solicitado\nUPDATE 1\n1\nROLLBACK");
  });

  it("o pedido nasce pendente — é comando, e o envio da venda o consome", () => {
    const out = sql(`${ganhoSemValor}${pendencia("skipped", "sem_valor")}
      update public.crm_leads set value_cents=250000 where id='${GOV_LEAD}';
      select status from public.event_log
        where organization_id='${GOV_ORG}' and entity_id='${GOV_LEAD}'
          and event_type='ad_conversion.retry_requested';
      rollback;`);
    expect(out).toContain("pending");
  });

  it("venda recusada pela plataforma não é reenviada por uma edição de valor", () => {
    const out = sql(`${ganhoSemValor}${pendencia("error", "recusado_pela_plataforma")}
      update public.crm_leads set value_cents=250000 where id='${GOV_LEAD}';
      ${pedidosDeReenvio}
      rollback;`);
    // Ancorado no fim: o `INSERT 0 1` do psql também contém "0".
    expect(out.endsWith("\n0\nROLLBACK")).toBe(true);
  });

  it("negócio que não é ganho não pede nada", () => {
    const out = sql(`begin;
      update public.crm_leads set value_cents=null where id='${GOV_LEAD}';
      ${pendencia("skipped", "sem_valor")}
      update public.crm_leads set value_cents=250000 where id='${GOV_LEAD}';
      ${pedidosDeReenvio}
      rollback;`);
    // Ancorado no fim: o `INSERT 0 1` do psql também contém "0".
    expect(out.endsWith("\n0\nROLLBACK")).toBe(true);
  });

  it("a função do gatilho não é executável pelos papéis do navegador", () => {
    expect(
      sql(`select has_function_privilege('anon','public.fn_valor_preenchido_reenvia_a_venda()','execute'),
      has_function_privilege('authenticated','public.fn_valor_preenchido_reenvia_a_venda()','execute');`),
    ).toBe("f|f");
  });
});
