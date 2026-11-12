/**
 * A qualidade de correspondência (EMQ) dos eventos do CRM na Meta.
 *
 * Os modos de falha que este arquivo vigia:
 *  - evento saindo só com o telefone quando o CRM sabe mais (a EMQ 2,5 medida
 *    em 12/11/2026);
 *  - dado pessoal saindo EM CLARO (e-mail, nome, cidade, id do contato);
 *  - `fbc`/`fbp`/IP/user agent saindo EM HASH — a Meta não casa hash ali;
 *  - hash de string vazia, que casaria todo mundo sem o campo;
 *  - `fbc` carimbado com a hora do envio em vez da do clique;
 *  - o clique-para-WhatsApp perdendo `ctwa_clid`, `action_source` ou a página;
 *  - o `event_id` de deduplicação mudando por causa do enriquecimento.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { identidadeDosDados } from "@/lib/conversoes/identidade-para-meta";
import { transporteMeta } from "@/lib/plataformas-de-anuncio/meta/conversions";
import {
  fbcDoClique,
  montarUserData,
  normalizarCidade,
  normalizarEstado,
  partesDoNome,
} from "@/lib/plataformas-de-anuncio/meta/user-data";
import type { ConversaoOffline, CredencialDeConversao } from "@/lib/plataformas-de-anuncio/types";

const h = (v: string) => createHash("sha256").update(v).digest("hex");

const FBCLID = "IwAR2abcDEF_123-xyz";
const CLIQUE_EM = "2026-11-10T15:00:00.000Z";

describe("montarUserData", () => {
  it("manda em hash o que é pessoal e em claro o que é do navegador", () => {
    const ud = montarUserData({
      telefone: "5511988887777",
      identidade: {
        externalId: "contato-1",
        email: "  Joao@Exemplo.COM ",
        nome: "João da Silva",
        cidade: "São José dos Campos",
        estado: "São Paulo",
        fbc: `fb.1.1731250800000.${FBCLID}`,
        fbp: "fb.1.1731250800000.1234567890",
        ip: "177.10.20.30",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
    });
    expect(ud).toEqual({
      ph: [h("5511988887777")],
      em: [h("joao@exemplo.com")],
      fn: [h("joão")],
      ln: [h("silva")],
      ct: [h("saojosedoscampos")],
      st: [h("sp")],
      country: [h("br")],
      external_id: [h("contato-1")],
      fbc: `fb.1.1731250800000.${FBCLID}`,
      fbp: "fb.1.1731250800000.1234567890",
      client_ip_address: "177.10.20.30",
      client_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
  });

  it("não manda campo ausente nem lixo — nunca hash de vazio", () => {
    const ud = montarUserData({
      telefone: null,
      identidade: {
        email: "sem-arroba",
        nome: "🍕 12",
        cidade: " ",
        estado: "Narnia",
        ip: "abc",
        fbc: "x",
      },
    });
    expect(ud).toEqual({});
  });

  it("clique-para-WhatsApp leva ctwa_clid e a página (a WABA só na falta dela)", () => {
    expect(
      montarUserData({
        telefone: "5511988887777",
        clique: { ctwaClid: "ARclid", pageId: "pg1", whatsappBusinessAccountId: "waba1" },
      }),
    ).toMatchObject({ ctwa_clid: "ARclid", page_id: "pg1" });
    const soWaba = montarUserData({
      telefone: null,
      clique: { ctwaClid: "ARclid", pageId: null, whatsappBusinessAccountId: "waba1" },
    });
    expect(soWaba).toEqual({ ctwa_clid: "ARclid", whatsapp_business_account_id: "waba1" });
  });
});

describe("normalizações", () => {
  it("nome de uma palavra só não inventa sobrenome", () => {
    expect(partesDoNome("Maria")).toEqual({ fn: "maria", ln: null });
    expect(partesDoNome("  Ana  Paula  Souza ")).toEqual({ fn: "ana", ln: "souza" });
  });
  it("estado por sigla, por extenso e em inglês", () => {
    expect(normalizarEstado("SP")).toBe("sp");
    expect(normalizarEstado("Rio Grande do Sul")).toBe("rs");
    expect(normalizarEstado("Federal District")).toBe("df");
    expect(normalizarEstado("Paraíba")).toBe("pb");
  });
  it("cidade sem acento, espaço nem pontuação", () => {
    expect(normalizarCidade("Ribeirão Preto")).toBe("ribeiraopreto");
  });
  it("fbc carimbado com o instante do clique, em ms", () => {
    expect(fbcDoClique(FBCLID, CLIQUE_EM)).toBe(`fb.1.${Date.parse(CLIQUE_EM)}.${FBCLID}`);
    expect(fbcDoClique(FBCLID, null)).toBeNull();
    expect(fbcDoClique("curto", CLIQUE_EM)).toBeNull();
  });
});

describe("identidadeDosDados — de onde vem cada campo", () => {
  const contato = {
    id: "contato-1",
    phone_number: "+5581999990000",
    name: null,
    display_name: "Zé Pizzaria",
    email: null,
    source_metadata: {
      Cidade: "Recife",
      Estado: "Pernambuco",
      fbclid: "IwAR_do_contato_1",
      origem_capturada_em: "2026-11-01T10:00:00Z",
    },
  };

  it("o cookie do formulário vence; o navegador vem do negócio", () => {
    const i = identidadeDosDados({
      contato,
      camposDoLead: {
        meta_fbc: `fb.1.1731250800000.${FBCLID}`,
        meta_fbp: "fb.1.1731250800000.99",
        meta_ip: "1.2.3.4",
        meta_user_agent: "Mozilla/5.0 teste",
      },
      cliqueDoLink: { utm: { fbclid: "IwAR_do_link_123" }, created_at: CLIQUE_EM },
    });
    expect(i).toMatchObject({
      // igual ao do formulário do OS: telefone em dígitos com DDI
      externalId: "5581999990000",
      nome: "Zé Pizzaria",
      cidade: "Recife",
      estado: "Pernambuco",
      fbc: `fb.1.1731250800000.${FBCLID}`,
      fbp: "fb.1.1731250800000.99",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0 teste",
    });
  });

  it("sem cookie, o fbclid do link rastreável com a hora do clique", () => {
    const i = identidadeDosDados({
      contato,
      camposDoLead: {},
      cliqueDoLink: { utm: { fbclid: "IwAR_do_link_123" }, created_at: CLIQUE_EM },
    });
    expect(i.fbc).toBe(`fb.1.${Date.parse(CLIQUE_EM)}.IwAR_do_link_123`);
  });

  it("sem telefone, o external_id é o id do contato", () => {
    const i = identidadeDosDados({
      contato: { ...contato, phone_number: null },
      camposDoLead: null,
      cliqueDoLink: null,
    });
    expect(i.externalId).toBe("contato-1");
  });

  it("sem link, o fbclid da origem do contato", () => {
    const i = identidadeDosDados({ contato, camposDoLead: null, cliqueDoLink: null });
    expect(i.fbc).toBe(`fb.1.${Date.parse("2026-11-01T10:00:00Z")}.IwAR_do_contato_1`);
  });
});

describe("o fio do transporte", () => {
  afterEach(() => vi.unstubAllGlobals());

  const credencial = {
    datasetId: "991921003166325",
    accessToken: "token-de-teste",
    testEventCode: null,
    meta: { pageId: "pagina-1", whatsappBusinessAccountId: null },
  } as unknown as CredencialDeConversao;

  const base: ConversaoOffline = {
    organizationId: "org",
    leadId: "lead-1",
    evento: "QualifiedLead",
    eventoId: "lead-1:MetaEtapa:etapa-1",
    ocorridoEm: new Date(),
    cliqueDeOrigem: "",
    telefone: "5581999990000",
    valorCentavos: null,
    moeda: "BRL",
    eventoNaPlataforma: "Schedule",
    identidade: {
      externalId: "contato-1",
      nome: "Zé",
      cidade: "Recife",
      fbc: `fb.1.1731250800000.${FBCLID}`,
    },
  };

  async function corpoEnviado(conversao: ConversaoOffline) {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 })));
    vi.stubGlobal("fetch", fetchFalso);
    const resultado = await transporteMeta.enviar(credencial, conversao);
    expect(resultado).toEqual({ tipo: "ok" });
    const init = (fetchFalso.mock.calls[0] as unknown as [string, RequestInit])[1];
    return JSON.parse(String(init.body)).data[0] as Record<string, unknown>;
  }

  it("evento de etapa pela página: system_generated, event_id intacto, user_data rico", async () => {
    const ev = await corpoEnviado(base);
    expect(ev.event_name).toBe("Schedule");
    expect(ev.event_id).toBe("lead-1:MetaEtapa:etapa-1");
    expect(ev.action_source).toBe("system_generated");
    expect(ev.user_data).toEqual({
      ph: [h("5581999990000")],
      fn: [h("zé")],
      ct: [h("recife")],
      country: [h("br")],
      external_id: [h("contato-1")],
      fbc: `fb.1.1731250800000.${FBCLID}`,
    });
  });

  it("clique-para-WhatsApp: business_messaging + ctwa_clid + página, e o resto junto", async () => {
    const ev = await corpoEnviado({ ...base, cliqueDeOrigem: "ARctwa123" });
    expect(ev.action_source).toBe("business_messaging");
    expect(ev.messaging_channel).toBe("whatsapp");
    expect(ev.user_data).toMatchObject({
      ctwa_clid: "ARctwa123",
      page_id: "pagina-1",
      external_id: [h("contato-1")],
    });
  });

  it("sem identidade, sai como antes: só o telefone", async () => {
    const ev = await corpoEnviado({ ...base, identidade: undefined });
    expect(ev.user_data).toEqual({ ph: [h("5581999990000")], country: [h("br")] });
  });
});

describe("o navegador do clique no link rastreável", () => {
  it("é lido da requisição e validado", async () => {
    const { navegadorDoClique } = await import("@/lib/plataformas-de-anuncio/pagina-de-captura");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      "https://crm.test/api/v1/rastreio/x?fbp=fb.1.1731250800000.42&fbclid=IwAR_x1234567",
      {
        headers: { "user-agent": "Mozilla/5.0 (Android 14)", "x-forwarded-for": "200.100.50.25" },
      },
    );
    const n = navegadorDoClique(req);
    expect(n.client_user_agent).toBe("Mozilla/5.0 (Android 14)");
    expect(n.fbp).toBe("fb.1.1731250800000.42");
    expect(n.client_ip_address === null || n.client_ip_address === "200.100.50.25").toBe(true);
    const lixo = navegadorDoClique(new NextRequest("https://crm.test/x?fbp=<script>"));
    expect(lixo).toEqual({ client_ip_address: null, client_user_agent: null, fbp: null });
  });

  it("vira IP/navegador/fbp do evento quando o formulário não trouxe", () => {
    const i = identidadeDosDados({
      contato: null,
      camposDoLead: {},
      cliqueDoLink: {
        utm: { fbclid: "IwAR_do_link_123" },
        created_at: CLIQUE_EM,
        client_ip_address: "200.100.50.25",
        client_user_agent: "Mozilla/5.0 (Android 14)",
        fbp: "fb.1.1731250800000.42",
      },
    });
    expect(i).toMatchObject({
      ip: "200.100.50.25",
      userAgent: "Mozilla/5.0 (Android 14)",
      fbp: "fb.1.1731250800000.42",
    });
  });

  it("banco sem a acelera_0006: o clique é gravado sem o navegador, não perdido", async () => {
    const { criarClickRef } = await import("@/lib/plataformas-de-anuncio/captura-de-clique");
    const inserts: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        insert: async (linha: Record<string, unknown>) => {
          inserts.push(linha);
          return "fbp" in linha
            ? { error: { code: "PGRST204", message: "column not found" } }
            : { error: null };
        },
      }),
    };
    const criado = await criarClickRef(admin as never, "meta_ads_click_refs", "org", {
      utm: { utm_source: "meta" },
      client_ip_address: "1.2.3.4",
      client_user_agent: "Mozilla/5.0 teste",
      fbp: null,
    });
    expect(criado).not.toBeNull();
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("client_ip_address");
    expect(inserts[1]).toMatchObject({ utm: { utm_source: "meta" } });
  });
});
