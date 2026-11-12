/** (Acelera) Formulário nativo da Meta entrando pela captação. */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  assinaturaDaMetaConfere,
  avisarComercial,
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
  const envAviso = { ACELERA_LEADS_AVISO_URL: "https://os/aviso", ACELERA_LEADS_AVISO_SECRET: "s" };

  it("avisa o comercial com assinatura e separa as respostas do contato", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    await avisarComercial(
      { ...lead, field_data: [...lead.field_data, { name: "faturamento", values: ["alto"] }] },
      { fetch: fetch as never, env: envAviso, agora: 1_000_000 },
    );
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    const corpo = init.body as string;
    expect(JSON.parse(corpo)).toEqual({
      nome: "Ana",
      telefone: "+5511999999999",
      plataforma: "instagram",
      respostas: { faturamento: "alto" },
    });
    const v1 = createHmac("sha256", "s").update(`1000.123.${corpo}`).digest("hex");
    expect((init.headers as Record<string, string>)["x-webhook-signature"]).toBe(`t=1000,v1=${v1}`);
  });

  it("falha do aviso não lança, e sem configuração não chama", async () => {
    const falha = vi.fn(async () => {
      throw new Error("rede");
    });
    await expect(avisarComercial(lead, { fetch: falha as never, env: envAviso })).resolves.toBeUndefined();
    const nada = vi.fn();
    await avisarComercial(lead, { fetch: nada as never, env: {} });
    expect(nada).not.toHaveBeenCalled();
  });

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

  it("UTM leva o nome do anúncio e o id fica à parte", () => {
    const corpo = corpoDaCaptacao({
      ...lead,
      ad_name: "Vídeo cardápio",
      adset_id: "8",
      adset_name: "Raio 5km",
      campaign_id: "7",
      campaign_name: "Black Friday",
    });
    expect(corpo).toMatchObject({
      utm_campaign: "Black Friday",
      utm_adset: "Raio 5km",
      utm_ad: "Vídeo cardápio",
      meta_campaign_id: "7",
      meta_adset_id: "8",
      meta_ad_id: "9",
    });
  });

  it("pede os nomes e, se a Meta recusar, relê sem eles", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(lead)))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await importarLeadDaMeta("123", { fetch, env });
    const urls = fetch.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("campaign_name");
    expect(urls[1]).not.toContain("campaign_name");
    const entrega = fetch.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(entrega[1].body as string)).toMatchObject({ utm_ad: "9" });
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
