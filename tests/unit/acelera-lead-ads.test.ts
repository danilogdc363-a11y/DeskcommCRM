/** (Acelera) Formulário nativo da Meta entrando pela captação. */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  assinaturaDaMetaConfere,
  corpoDaCaptacao,
  idsDeLeadDoAviso,
  importarLeadDaMeta,
} from "@/lib/acelera/lead-ads";

const env = { ACELERA_LEADS_PAGE_TOKEN: "t", ACELERA_LEADS_INBOUND_URL: "https://crm/in/x" };
const lead = {
  id: "123",
  ad_id: "9",
  platform: "ig",
  field_data: [
    { name: "full_name", values: ["Ana"] },
    { name: "phone_number", values: ["+5511999999999"] },
  ],
};

describe("lead ads", () => {
  it("confere a assinatura da Meta", () => {
    const sig = `sha256=${createHmac("sha256", "s").update("{}").digest("hex")}`;
    expect(assinaturaDaMetaConfere("{}", sig, "s")).toBe(true);
    expect(assinaturaDaMetaConfere("{}", sig, "outro")).toBe(false);
    expect(assinaturaDaMetaConfere("{}", null, "s")).toBe(false);
  });

  it("lê só avisos leadgen, sem repetir", () => {
    const ids = idsDeLeadDoAviso({
      entry: [
        {
          changes: [
            { field: "leadgen", value: { leadgen_id: "1" } },
            { field: "leadgen", value: { leadgen_id: "1" } },
            { field: "feed", value: { leadgen_id: "2" } },
          ],
        },
      ],
    });
    expect(ids).toEqual(["1"]);
  });

  it("monta o corpo com id para deduplicar e origem do anúncio", () => {
    expect(corpoDaCaptacao(lead)).toMatchObject({
      external_id: "meta_lead:123",
      meta_lead_id: "123",
      utm_source: "instagram",
      utm_ad: "9",
      full_name: "Ana",
      phone_number: "+5511999999999",
    });
  });

  it("falha transitória da captação lança, recusa não", async () => {
    const com = (status: number) =>
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(lead)))
        .mockResolvedValueOnce(new Response(null, { status }));
    await expect(importarLeadDaMeta("123", { fetch: com(500), env })).rejects.toThrow("captacao_500");
    await expect(importarLeadDaMeta("123", { fetch: com(422), env })).resolves.toBeUndefined();
  });
});
