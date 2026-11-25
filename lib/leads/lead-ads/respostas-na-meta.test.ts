/**
 * A LEITURA DO LEAD NA GRAPH — a única peça do recebimento que usa rede.
 *
 * Mede o CONTRATO: que URL monta, onde vai o token (cabeçalho, nunca a URL), o
 * que devolve quando a Meta não coopera, e que a releitura sem os nomes do
 * anúncio acontece quando o token não vê a conta de anúncio.
 * O `fetch` é injetado: dublar o global mediria o dublê do ambiente.
 */
import { describe, expect, it, vi } from "vitest";

import { baseDaGraphDeAnuncio } from "@/lib/plataformas-de-anuncio/meta/graph-base";
import { leadSoComIds } from "./receber";
import { buscarRespostasDoLead, leadComOrigem, TEMPO_LIMITE_DA_BUSCA_MS } from "./respostas-na-meta";

const LEADGEN = "1122334455667788";
const TOKEN = "token-da-pagina-que-le-leads-".padEnd(40, "x");

function fetchQue(...respostas: { corpo: unknown; status?: number }[]) {
  let i = 0;
  const espiao = vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = respostas[Math.min(i++, respostas.length - 1)]!;
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  });
  return { espiao, fetch: espiao as unknown as typeof fetch };
}

const BOM = {
  id: LEADGEN,
  created_time: "2026-11-24T12:00:00+0000",
  form_id: "555",
  ad_id: "111",
  ad_name: "Anúncio Black",
  adset_id: "222",
  adset_name: "Conjunto SP",
  campaign_id: "333",
  campaign_name: "Campanha Delivery",
  platform: "ig",
  field_data: [
    { name: "full_name", values: ["Maria Souza"] },
    { name: "phone_number", values: ["+5511988887777"] },
  ],
};

describe("buscarRespostasDoLead", () => {
  it("devolve as respostas e a origem do anúncio, com os NOMES", async () => {
    const { fetch } = fetchQue({ corpo: BOM });
    const r = await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: fetch });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.respostas).toEqual([
      { campo: "full_name", valor: "Maria Souza" },
      { campo: "phone_number", valor: "+5511988887777" },
    ]);
    expect(r.origem).toMatchObject({
      adNome: "Anúncio Black",
      adsetNome: "Conjunto SP",
      campaignNome: "Campanha Delivery",
      campaignId: "333",
      plataforma: "ig",
    });
  });

  it("manda o token no cabeçalho e NUNCA na URL", async () => {
    const { espiao, fetch } = fetchQue({ corpo: BOM });
    await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: fetch });
    const [url, init] = espiao.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url.startsWith(`${baseDaGraphDeAnuncio()}/${LEADGEN}?`)).toBe(true);
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain("access_token");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("relê SEM os nomes quando a Meta recusa o pedido com nomes (o lead entra com os ids)", async () => {
    const semNomes = { ...BOM, ad_name: undefined, adset_name: undefined, campaign_name: undefined };
    const { espiao, fetch } = fetchQue(
      { corpo: { error: { code: 200, message: "(#200) ads" } }, status: 403 },
      { corpo: semNomes },
    );
    const r = await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: fetch });
    expect(espiao).toHaveBeenCalledTimes(2);
    expect(String(espiao.mock.calls[1]![0])).not.toContain("campaign_name");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.origem.campaignNome).toBeNull();
  });

  it("recusa da Meta vira falha nomeada COM frase em português", async () => {
    const { fetch } = fetchQue({ corpo: { error: { code: 190, message: "expired" } }, status: 401 });
    const r = await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: fetch });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("recusada_pela_meta");
    expect(r.detalhe).toBe("http_401_codigo_190");
    expect(r.erro?.codigo).toBe("login_vencido");
  });

  it("sem token, sem leadgen, sem respostas e rede fora: cada um tem o seu motivo, nenhum inventa dado", async () => {
    expect((await buscarRespostasDoLead({ leadgenId: LEADGEN, token: "  " })).ok).toBe(false);
    const semResposta = fetchQue({ corpo: { field_data: [] } });
    const a = await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: semResposta.fetch });
    expect(a).toMatchObject({ ok: false, motivo: "sem_respostas" });
    const semCampo = fetchQue({ corpo: { id: "1" } });
    const b = await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: semCampo.fetch });
    expect(b).toMatchObject({ ok: false, motivo: "resposta_ilegivel" });
    const caiu = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const c = await buscarRespostasDoLead({ leadgenId: LEADGEN, token: TOKEN }, { fetchImpl: caiu });
    expect(c).toMatchObject({ ok: false, motivo: "tempo_esgotado" });
  });

  it("o teto de tempo é curto: quem espera é o webhook da Meta", () => {
    expect(TEMPO_LIMITE_DA_BUSCA_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("leadComOrigem", () => {
  it("o que o aviso já trouxe vence; os nomes vêm da leitura", () => {
    const base = leadSoComIds(LEADGEN, "9", { adId: "AVISO" });
    const lead = leadComOrigem(base, {
      adId: "OUTRO",
      adNome: "Anúncio",
      adsetId: "2",
      adsetNome: "Conjunto",
      campaignId: "3",
      campaignNome: "Campanha",
      formId: "5",
      plataforma: "fb",
      criadoEm: 100,
    });
    expect(lead.adId).toBe("AVISO");
    expect(lead.campaignNome).toBe("Campanha");
    expect(lead.formId).toBe("5");
  });
});
