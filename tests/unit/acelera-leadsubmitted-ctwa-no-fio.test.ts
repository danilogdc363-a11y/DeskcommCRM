/**
 * (Acelera) O LeadSubmitted por clique CTWA, do handler até o corpo que sai
 * para a Meta, passando pelo transporte DE VERDADE (só o `fetch` é falso).
 *
 * Vigia o que o teste do handler não alcança: que o evento sai como conversa
 * de WhatsApp (`business_messaging` + `ctwa_clid`), com o `event_id` próprio do
 * clique, o telefone em hash e nenhum `lead_id` de card — e que o código de
 * teste do conjunto vai junto e não marca o clique como enviado.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conversaoDeCliqueMetaHandler } from "@/lib/conversoes/clique-meta.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: vi.fn() }));

const h = (v: string) => createHash("sha256").update(v).digest("hex");
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIQUE = "33333333-3333-4333-8333-000000000001";
const MENSAGEM = "33333333-3333-4333-8333-000000000101";
const ATIVACAO = "2026-11-12T10:00:00.000001Z";

function banco() {
  const clique = {
    id: CLIQUE,
    contact_id: "22222222-2222-4222-8222-222222222222",
    first_message_id: MENSAGEM,
    ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO",
    captured_at: "2026-11-12T10:05:00.000001Z",
    activation_at_capture: ATIVACAO,
    status: "pending",
    event_id: `${CLIQUE}:LeadSubmitted`,
  };
  const rpc = vi.fn(async (nome: string, args: Record<string, unknown>) => {
    if (nome === "fn_claim_meta_ctwa_click")
      return { data: { acquired: true, token: "tok", status: "processing" }, error: null };
    if (nome === "fn_settle_meta_ctwa_click") {
      clique.status = String(args.p_status);
      return { data: true, error: null };
    }
    return { data: null, error: { message: nome } };
  });
  const from = vi.fn((tabela: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => {
        if (tabela === "meta_ctwa_click_dispatches") return { data: clique, error: null };
        if (tabela === "organizations")
          return { data: { meta_lead_birth_enabled_at: ATIVACAO }, error: null };
        if (tabela === "contacts") return { data: { phone_number: "5581999990000" }, error: null };
        return { data: null, error: { message: tabela } };
      },
    };
    return q;
  });
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);
  return { clique, rpc };
}

const evento: EventRow = {
  id: "evento-1",
  organization_id: ORG,
  event_type: "message.received",
  entity_kind: "message",
  entity_id: MENSAGEM,
  payload: { message_id: MENSAGEM },
  metadata: {},
  consumed_by: [],
  attempts: 0,
};

function credencial(testEventCode: string | null) {
  vi.mocked(lerCredencial).mockResolvedValue({
    ok: true,
    credencial: {
      datasetId: "991921003166325",
      accessToken: "token-de-teste",
      testEventCode,
      meta: { pageId: "pagina-1", whatsappBusinessAccountId: null },
    },
  } as never);
}

let fetchFalso: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchFalso = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 })));
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => vi.unstubAllGlobals());

function corpo() {
  const init = (fetchFalso.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(String(init.body)) as {
    data: Array<Record<string, unknown>>;
    test_event_code?: string;
  };
}

describe("LeadSubmitted CTWA no fio da Meta", () => {
  it("sai como conversa de WhatsApp, com ctwa_clid, event_id do clique e telefone em hash", async () => {
    const { clique } = banco();
    credencial(null);
    const r = await conversaoDeCliqueMetaHandler.handle(evento);
    expect(r.status).toBe("ok");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const ev = corpo().data[0]!;
    expect(ev.event_name).toBe("LeadSubmitted");
    expect(ev.event_id).toBe(`${CLIQUE}:LeadSubmitted`);
    expect(ev.action_source).toBe("business_messaging");
    expect(ev.messaging_channel).toBe("whatsapp");
    expect(ev.event_time).toBe(Math.floor(Date.parse(clique.captured_at) / 1000));
    const ud = ev.user_data as Record<string, unknown>;
    expect(ud.ctwa_clid).toBe(clique.ctwa_clid);
    expect(ud.page_id).toBe("pagina-1");
    expect(ud.ph).toEqual([h("5581999990000")]);
    expect(ud).not.toHaveProperty("lead_id");
    expect(ev).not.toHaveProperty("custom_data");
    expect(clique.status).toBe("sent");
  });

  it("com código de teste do conjunto, o evento leva o código e o clique não vira 'enviado'", async () => {
    const { clique } = banco();
    credencial("TEST12345");
    const r = await conversaoDeCliqueMetaHandler.handle(evento);
    expect(r).toMatchObject({ status: "skipped", detail: "evento_de_teste" });
    expect(corpo().test_event_code).toBe("TEST12345");
    expect(clique.status).toBe("skipped");
  });
});
