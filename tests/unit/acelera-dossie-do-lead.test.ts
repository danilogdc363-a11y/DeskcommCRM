/**
 * (Acelera) Dossiê do lead: o corpo que o Acelera OS copia para a ficha do
 * cliente quando o lead fecha.
 */
import { describe, expect, it } from "vitest";

import { LIMITE_DE_MENSAGENS, montarDossie } from "@/lib/acelera/dossie-do-lead";
import { isPublicPath } from "@/lib/auth/public-paths";

const LEAD_ID = "11111111-2222-3333-4444-555555555555";

const base = {
  lead: {
    id: LEAD_ID,
    title: "Pizzaria X",
    status: "won",
    value_cents: 250000,
    currency: "BRL",
    created_at: "2026-10-01T10:00:00Z",
    closed_at: "2026-10-20T10:00:00Z",
    source: "webhook",
    source_metadata: { utm_source: "meta" },
    custom_fields: { score: "4.5" },
    tags: ["yay"],
  },
  stageName: "Fechou",
  contact: { id: "c1", name: null, display_name: "Ana", phone_number: "+5511999999999", email: null, tags: [] },
  stageActivities: [{ performed_at: "2026-10-05T10:00:00Z", payload: { to: "Reunião marcada" } }],
  messages: [
    { id: "m1", sent_at: "2026-10-01T10:01:00Z", direction: "outbound", sent_via: "automation", type: "text", body: "Opa" },
    { id: "m2", sent_at: "2026-10-01T10:02:00Z", direction: "inbound", sent_via: "crm", type: "reaction", body: "👍" },
    { id: "m3", sent_at: "2026-10-01T10:03:00Z", direction: "inbound", sent_via: "crm", type: "audio", body: null, media_url: "https://x/a.ogg" },
  ],
};

describe("dossiê do lead", () => {
  it("leva lead, contato, etapas e a conversa sem reações", () => {
    const d = montarDossie(base);
    expect(d.lead).toMatchObject({ stage: "Fechou", value_cents: 250000, custom_fields: { score: "4.5" } });
    expect(d.contact).toMatchObject({ name: "Ana", phone: "+5511999999999" });
    expect(d.stages).toHaveLength(1);
    expect(d.messages.map((m) => m.type)).toEqual(["text", "audio"]);
    expect(d.messages[1]).toMatchObject({ direction: "inbound", media_url: "https://x/a.ogg" });
    expect(d.messages_truncated).toBe(false);
  });

  it("avisa quando a conversa bateu no teto", () => {
    const [primeira] = base.messages;
    if (!primeira) throw new Error("a base do teste precisa de uma mensagem");
    const muitas = Array.from({ length: LIMITE_DE_MENSAGENS }, () => primeira);
    expect(montarDossie({ ...base, messages: muitas }).messages_truncated).toBe(true);
  });

  it("a rota aceita Bearer (proxy não decide) só no caminho do dossiê", () => {
    expect(isPublicPath(`/api/v1/leads/${LEAD_ID}/dossie`)).toBe(true);
    expect(isPublicPath(`/api/v1/leads/${LEAD_ID}/proposals`)).toBe(false);
  });
});
