/**
 * (Acelera) Dossiê do lead — tudo o que a venda produziu, num corpo só.
 *
 * Quem consome é o Acelera OS: quando o lead entra em "Fechou", o OS busca
 * este dossiê e guarda uma CÓPIA na ficha do cliente ("nenhuma informação se
 * perde"). Por isso a leitura é completa: lead, contato, etapas percorridas e
 * todas as mensagens de WhatsApp do contato (sem grupos), em ordem.
 *
 * A org sempre filtra cada consulta: no ramo do token o client é admin (sem
 * RLS), então o filtro por `organization_id` é a cerca.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Teto de mensagens por dossiê. Conversa comercial real fica bem abaixo. */
export const LIMITE_DE_MENSAGENS = 5_000;

export interface MensagemDoDossie {
  at: string;
  direction: "inbound" | "outbound";
  sent_via: string;
  type: string;
  body: string | null;
  media_url: string | null;
}

export interface DossieDoLead {
  lead: {
    id: string;
    title: string | null;
    status: string | null;
    stage: string | null;
    pipeline_id: string | null;
    value_cents: number | null;
    currency: string | null;
    created_at: string;
    closed_at: string | null;
    source: string | null;
    source_metadata: Record<string, unknown>;
    custom_fields: Record<string, unknown>;
    tags: string[];
  };
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    source: string | null;
    source_metadata: Record<string, unknown>;
    tags: string[];
  } | null;
  stages: { at: string; payload: Record<string, unknown> }[];
  messages: MensagemDoDossie[];
  messages_truncated: boolean;
}

type Linha = Record<string, unknown>;

const texto = (v: unknown) => (typeof v === "string" ? v : null);
const objeto = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Monta o dossiê a partir das linhas já lidas. Puro, para testar sem banco. */
export function montarDossie(input: {
  lead: Linha;
  stageName: string | null;
  contact: Linha | null;
  stageActivities: Linha[];
  messages: Linha[];
}): DossieDoLead {
  const { lead, contact } = input;
  const mensagens = input.messages
    .filter((m) => m.type !== "reaction" && m.type !== "system")
    .map((m) => ({
      at: String(m.sent_at),
      direction: m.direction === "outbound" ? ("outbound" as const) : ("inbound" as const),
      sent_via: String(m.sent_via ?? ""),
      type: String(m.type ?? "text"),
      body: texto(m.body),
      media_url: texto(m.media_url),
    }));
  return {
    lead: {
      id: String(lead.id),
      title: texto(lead.title),
      status: texto(lead.status),
      stage: input.stageName,
      pipeline_id: texto(lead.pipeline_id),
      value_cents: typeof lead.value_cents === "number" ? lead.value_cents : null,
      currency: texto(lead.currency),
      created_at: String(lead.created_at),
      closed_at: texto(lead.closed_at),
      source: texto(lead.source),
      source_metadata: objeto(lead.source_metadata),
      custom_fields: objeto(lead.custom_fields),
      tags: lista(lead.tags),
    },
    contact: contact
      ? {
          id: String(contact.id),
          name: texto(contact.name) ?? texto(contact.display_name),
          phone: texto(contact.phone_number),
          email: texto(contact.email),
          source: texto(contact.source),
          source_metadata: objeto(contact.source_metadata),
          tags: lista(contact.tags),
        }
      : null,
    stages: input.stageActivities.map((a) => ({
      at: String(a.performed_at),
      payload: objeto(a.payload),
    })),
    messages: mensagens,
    messages_truncated: input.messages.length >= LIMITE_DE_MENSAGENS,
  };
}

/** Lê o dossiê do banco. `null` = lead não existe nesta org. */
export async function lerDossieDoLead(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<DossieDoLead | null> {
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select(
      "id, title, status, stage_id, pipeline_id, value_cents, currency, created_at, closed_at, source, source_metadata, custom_fields, tags, contact_id",
    )
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!lead) return null;

  const contactId = lead.contact_id as string | null;
  const [stage, contact, atividades, conversas] = await Promise.all([
    lead.stage_id
      ? supabase
          .from("crm_stages")
          .select("name")
          .eq("organization_id", organizationId)
          .eq("id", lead.stage_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contactId
      ? supabase
          .from("contacts")
          .select("id, name, display_name, phone_number, email, source, source_metadata, tags")
          .eq("organization_id", organizationId)
          .eq("id", contactId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("crm_lead_activities")
      .select("performed_at, payload")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .eq("type", "stage_changed")
      .order("performed_at", { ascending: true }),
    contactId
      ? supabase
          .from("conversations")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("contact_id", contactId)
          .eq("is_group", false)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [stage, contact, atividades, conversas]) if (r.error) throw r.error;

  const conversaIds = ((conversas.data ?? []) as Linha[]).map((c) => String(c.id));
  let mensagens: Linha[] = [];
  if (conversaIds.length) {
    const { data, error: errMsg } = await supabase
      .from("messages")
      .select("sent_at, direction, sent_via, type, body, media_url")
      .eq("organization_id", organizationId)
      .in("conversation_id", conversaIds)
      .order("sent_at", { ascending: true })
      .limit(LIMITE_DE_MENSAGENS);
    if (errMsg) throw errMsg;
    mensagens = (data ?? []) as Linha[];
  }

  return montarDossie({
    lead: lead as Linha,
    stageName: texto((stage.data as Linha | null)?.name),
    contact: (contact.data as Linha | null) ?? null,
    stageActivities: (atividades.data ?? []) as Linha[],
    messages: mensagens,
  });
}
