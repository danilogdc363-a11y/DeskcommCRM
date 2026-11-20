/**
 * Pós-venda para a Meta: o mês de cliente ativo e o cancelamento do contrato.
 *
 * Os modos de falha que este arquivo vigia:
 *  - o cliente faz a reunião do mês e NADA sai, ou sai sem a mensalidade;
 *  - três reuniões no mesmo mês contando três vezes (o valor inflaria o LTV);
 *  - o mês contado pelo relógio do servidor em vez do da organização;
 *  - reunião de quem não é cliente ativo, ou que virou falta, contando;
 *  - o clone no funil de clientes mandando um segundo `Purchase` da venda inicial;
 *  - a perda de um ORÇAMENTO virando "cancelamento de contrato".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversaoDeVendaHandler } from "@/lib/conversoes/envio.handler";
import { conversaoDePosVendaHandler } from "@/lib/conversoes/pos-venda.handler";
import { mesDaInteracao, valorDoMesAtivo } from "@/lib/conversoes/pos-venda";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const CONTATO = "33333333-3333-3333-3333-333333333333";
const COMPROMISSO = "44444444-4444-4444-8444-444444444444";
const FUNIL = "55555555-5555-4555-8555-555555555555";
const EVENTO_ID = "66666666-6666-4666-8666-666666666666";

/** Agora, para o evento caber na janela de 7 dias da Meta. */
const AGORA = new Date().toISOString();
const MES = mesDaInteracao(new Date(AGORA), "America/Sao_Paulo");

let tabelas: Record<string, unknown>;
/** O livro-razão por `event_name` — a chave única de verdade da tabela. */
let livro: Record<string, Record<string, unknown>>;

/** Banco de mentira: uma linha por tabela, e o livro-razão relido pela chave. */
function fakeAdmin() {
  return {
    from(tabela: string) {
      let eventName: string | null = null;
      const construtor = {
        select: () => construtor,
        eq: (coluna: string, valor: unknown) => {
          if (coluna === "event_name") eventName = String(valor);
          return construtor;
        },
        neq: () => construtor,
        in: () => construtor,
        order: () => construtor,
        limit: () => construtor,
        maybeSingle: async () => {
          if (tabela === "ad_conversion_dispatches")
            return { data: (eventName && livro[eventName]) ?? null, error: null };
          return { data: tabelas[tabela] ?? null, error: null };
        },
        upsert: async (valores: Record<string, unknown>) => {
          if (tabela === "ad_conversion_dispatches") {
            const nome = String(valores.event_name);
            livro[nome] = { ...(livro[nome] ?? {}), ...valores };
          }
          return { error: null };
        },
      };
      return construtor;
    },
    rpc: async () => ({ data: "token-decifrado", error: null }),
  };
}

function base(extra: { lead?: Record<string, unknown>; funilDeClientes?: boolean } = {}) {
  livro = {};
  const comFunil = extra.funilDeClientes ?? true;
  tabelas = {
    calendar_appointments: { status: "completed", contact_id: CONTATO },
    // Com funil de clientes, ESTE é ele; sem, a organização não tem nenhum.
    crm_pipelines: comFunil ? { id: FUNIL, is_client_pipeline: true } : null,
    organizations: { timezone: "America/Sao_Paulo" },
    crm_leads: {
      id: LEAD,
      status: "open",
      value_cents: 1_500_00,
      currency: "BRL",
      closed_at: AGORA,
      contact_id: CONTATO,
      pipeline_id: FUNIL,
      recurring_value_cents: 997_00,
      ...extra.lead,
    },
    contacts: {
      phone_number: "5511988887777",
      source_metadata: { ad_platform: "meta_ads", ad_source_id: "ctwa-abc" },
    },
    ad_platform_connections: {
      dataset_id: "123456789012345",
      access_token_encrypted: "\\xdeadbeef",
      test_event_code: null,
      enabled: true,
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);
}

function evento(extra: Partial<EventRow> = {}): EventRow {
  return {
    id: EVENTO_ID,
    organization_id: ORG,
    event_type: "appointment.completed",
    entity_kind: "calendar_appointment",
    entity_id: COMPROMISSO,
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: AGORA,
    ...extra,
  };
}

const doNegocio = (extra: Partial<EventRow> = {}) =>
  evento({ entity_kind: "crm_lead", entity_id: LEAD, ...extra });
const perdido = () => doNegocio({ event_type: "lead.lost" });

interface EventoEnviado {
  event_name: string;
  event_id: string;
  custom_data?: { value?: number; currency?: string };
}

function enviados(spy: ReturnType<typeof vi.spyOn>): EventoEnviado[] {
  return (spy.mock.calls as unknown[][]).map(
    (c) => (JSON.parse(String((c[1] as RequestInit).body)) as { data: EventoEnviado[] }).data[0]!,
  );
}

const aceito = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("as regras puras", () => {
  it("o valor do mês ativo é a mensalidade — e nunca zero", () => {
    expect(valorDoMesAtivo(997_00)).toBe(997_00);
    expect(valorDoMesAtivo(null)).toBeNull();
    expect(valorDoMesAtivo(0)).toBeNull();
    expect(valorDoMesAtivo(-5)).toBeNull();
  });

  it("o mês é o do relógio da organização, não o do servidor", () => {
    // 31/10 às 22h em Brasília já é 1º/11 em UTC.
    const instante = new Date("2026-11-01T01:00:00Z");
    expect(mesDaInteracao(instante, "America/Sao_Paulo")).toBe("2026-10");
    expect(mesDaInteracao(instante, "UTC")).toBe("2026-11");
  });
});

describe("cliente ativo: reunião realizada", () => {
  it("sai como ClienteAtivo e event_id do mês, no negócio do cliente, com a mensalidade no livro-razão", async () => {
    base();
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(evento());

    expect(r).toMatchObject({ consumer_key: "conversoes.pos_venda", status: "ok" });
    const [enviado] = enviados(spy);
    expect(enviado?.event_name).toBe("ClienteAtivo");
    expect(enviado?.event_id).toBe(`${LEAD}:ClienteAtivo:${MES}`);
    expect(livro[`ClienteAtivo:${MES}`]).toMatchObject({ status: "sent", value_cents: 997_00 });
  });

  // ⚠️ DEPENDE DO PR #23 (EMQ, `meta/conversions.ts`): hoje o transporte só põe
  // `custom_data.value` na `Purchase`, e o `ClienteAtivo` sai sem o valor no fio.
  // O #23 faz o valor sair sempre que `valorCentavos !== null`. Quando ele entrar,
  // este caso passa a passar — e o `it.fails` reprova, obrigando a trocá-lo por `it`.
  it.fails("o valor da mensalidade vai no fio (custom_data) — espera o PR #23", async () => {
    base();
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(evento());

    expect(r).toMatchObject({ consumer_key: "conversoes.pos_venda", status: "ok" });
    const [enviado] = enviados(spy);
    expect(enviado?.event_name).toBe("ClienteAtivo");
    expect(enviado?.event_id).toBe(`${LEAD}:ClienteAtivo:${MES}`);
    expect(enviado?.event_id).not.toBe(`${LEAD}:Purchase`);
    expect(enviado?.custom_data).toEqual({ value: 997, currency: "BRL" });
    expect(livro[`ClienteAtivo:${MES}`]).toMatchObject({
      status: "sent",
      value_cents: 997_00,
      lead_id: LEAD,
    });
  });

  it("outra reunião no mesmo mês não conta de novo", async () => {
    base();
    const spy = aceito();

    await conversaoDePosVendaHandler.handle(evento());
    const segunda = await conversaoDePosVendaHandler.handle(
      evento({ id: "88888888-8888-4888-8888-888888888888" }),
    );

    expect(segunda.detail).toBe("ja_enviada");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sem mensalidade não envia e deixa a pendência sem_valor", async () => {
    base({ lead: { recurring_value_cents: null } });
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(evento());

    expect(r.detail).toBe("sem_valor");
    expect(spy).not.toHaveBeenCalled();
    expect(livro[`ClienteAtivo:${MES}`]).toMatchObject({ status: "skipped", reason: "sem_valor" });
  });

  it("reunião corrigida para falta não conta", async () => {
    base();
    tabelas.calendar_appointments = { status: "no_show", contact_id: CONTATO };
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(evento());

    expect(r.detail).toBe("reuniao_nao_realizada");
    expect(spy).not.toHaveBeenCalled();
  });

  it("contato sem negócio aberto no funil de clientes não é cliente ativo", async () => {
    base();
    tabelas.crm_leads = null;
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(evento());

    expect(r.detail).toBe("nao_e_cliente_ativo");
    expect(spy).not.toHaveBeenCalled();
  });

  it("organização sem funil de clientes não manda nada", async () => {
    base({ funilDeClientes: false });
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(evento());

    expect(r.detail).toBe("sem_funil_de_clientes");
    expect(spy).not.toHaveBeenCalled();
  });

  it("o consumidor da venda não trata o mês ativo como a compra do negócio", async () => {
    base({ lead: { status: "won" }, funilDeClientes: false });
    const spy = aceito();

    const r = await conversaoDeVendaHandler.handle(
      doNegocio({
        event_type: "ad_conversion.retry_requested",
        payload: { event_name: `ClienteAtivo:${MES}` },
      }),
    );

    expect(r.detail).toBe("outro_evento");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("cancelamento do contrato", () => {
  it("cliente perdido sai como evento Cancelamento, sem valor, uma vez", async () => {
    base({ lead: { status: "lost" } });
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(perdido());
    const repetido = await conversaoDePosVendaHandler.handle(perdido());

    expect(r).toMatchObject({ status: "ok" });
    expect(repetido.detail).toBe("ja_enviada");
    const [enviado] = enviados(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(enviado?.event_name).toBe("Cancelamento");
    expect(enviado?.event_id).toBe(`${LEAD}:Cancelamento`);
    expect(enviado?.custom_data).toBeUndefined();
  });

  it("orçamento perdido no funil de vendas NÃO é cancelamento de contrato", async () => {
    base({ lead: { status: "lost" }, funilDeClientes: false });
    const spy = aceito();

    const r = await conversaoDePosVendaHandler.handle(perdido());

    expect(r.detail).toBe("fora_do_funil_de_clientes");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sem dupla contagem da venda inicial", () => {
  it("ganho no funil de clientes não manda um segundo Purchase", async () => {
    base({ lead: { status: "won" } });
    const spy = aceito();

    const r = await conversaoDeVendaHandler.handle(doNegocio({ event_type: "lead.won" }));

    expect(r.detail).toBe("funil_de_clientes");
    expect(spy).not.toHaveBeenCalled();
  });

  it("ganho no funil de vendas continua mandando o Purchase de sempre", async () => {
    base({ lead: { status: "won" }, funilDeClientes: false });
    const spy = aceito();

    await conversaoDeVendaHandler.handle(doNegocio({ event_type: "lead.won" }));

    const [enviado] = enviados(spy);
    expect(enviado?.event_name).toBe("Purchase");
    expect(enviado?.event_id).toBe(`${LEAD}:Purchase`);
    expect(enviado?.custom_data).toEqual({ value: 1500, currency: "BRL" });
  });
});
