/**
 * CSV de leads com a origem do anúncio (o "relatório de conversas" do Tintim).
 *
 * A leitura filtra pela organização da sessão. O telefone e o nome são dado
 * pessoal: quem chama é a rota de admin, que audita o download.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import { celulaCsv } from "./exportar-csv";
import { inicioDoPeriodo, type Periodo } from "./historico";

export const CABECALHO_DO_CSV_DE_LEADS = [
  "criado_em",
  "negocio",
  "nome_do_contato",
  "telefone",
  "etapa",
  "situacao",
  "valor",
  "moeda",
  "plataforma",
  "campanha",
  "conjunto",
  "anuncio",
  "origem",
  "lead_id",
] as const;

export interface LinhaDeLead {
  id: string;
  criadoEm: string;
  titulo: string;
  nomeDoContato: string | null;
  telefone: string | null;
  etapa: string | null;
  situacao: string;
  valorCentavos: number | null;
  moeda: string | null;
  plataforma: string | null;
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  origem: string | null;
}

type Meta = Record<string, unknown>;
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const objeto = (v: unknown): Meta => (v && typeof v === "object" ? (v as Meta) : {});
const primeiro = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** Origem do anúncio: o que o contato trouxe, e o que o próprio lead guardou. */
export function origemDoLead(contato: unknown, lead: unknown) {
  const c = objeto(contato);
  const l = objeto(lead);
  const pega = (chave: string) => texto(c[chave]) ?? texto(l[chave]);
  return {
    plataforma: pega("ad_platform"),
    campanha: pega("utm_campaign"),
    conjunto: pega("utm_adset"),
    anuncio: pega("utm_ad"),
    origem: pega("utm_source"),
  };
}

interface ContatoLido {
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  source_metadata: unknown;
}

export async function lerLeadsParaExportar(
  admin: SupabaseClient,
  organizationId: string,
  periodo: Periodo,
  pagina: number,
  tamanho: number,
  agora: Date = new Date(),
): Promise<{ linhas: LinhaDeLead[]; total: number }> {
  let q = admin
    .from("crm_leads")
    .select(
      "id, title, status, value_cents, currency, created_at, source_metadata, crm_stages!crm_leads_stage_id_fkey(name), contacts(name, display_name, phone_number, source_metadata)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId);
  const inicio = inicioDoPeriodo(periodo, agora);
  if (inicio) q = q.gte("created_at", inicio);

  const de = (pagina - 1) * tamanho;
  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(de, de + tamanho - 1);
  if (error) throw new Error("Não foi possível ler os leads.");

  const linhas = ((data ?? []) as unknown[]).map((bruto) => {
    const l = bruto as {
      id: string;
      title: string;
      status: string;
      value_cents: number | null;
      currency: string | null;
      created_at: string;
      source_metadata: unknown;
      crm_stages: { name: string } | Array<{ name: string }> | null;
      contacts: ContatoLido | ContatoLido[] | null;
    };
    const contato = primeiro(l.contacts);
    return {
      id: l.id,
      criadoEm: l.created_at,
      titulo: l.title,
      nomeDoContato: nomeDoContato(contato),
      telefone: contato?.phone_number ?? null,
      etapa: primeiro(l.crm_stages)?.name ?? null,
      situacao: l.status,
      valorCentavos: l.value_cents,
      moeda: l.currency,
      ...origemDoLead(contato?.source_metadata, l.source_metadata),
    };
  });
  return { linhas, total: count ?? linhas.length };
}

export function csvDeLeads(linhas: LinhaDeLead[]): string {
  const corpo = linhas.map((l) =>
    [
      l.criadoEm,
      l.titulo,
      l.nomeDoContato,
      l.telefone,
      l.etapa,
      l.situacao,
      l.valorCentavos === null ? "" : (l.valorCentavos / 100).toFixed(2),
      l.moeda,
      l.plataforma,
      l.campanha,
      l.conjunto,
      l.anuncio,
      l.origem,
      l.id,
    ]
      .map(celulaCsv)
      .join(","),
  );
  return "﻿" + [CABECALHO_DO_CSV_DE_LEADS.join(","), ...corpo].join("\n") + "\n";
}
