/**
 * Junta o que o CRM sabe da pessoa para a Meta reconhecê-la (EMQ).
 *
 * Três fontes, todas já gravadas por outros caminhos — este arquivo só LÊ:
 *
 *  1. o contato: id (vira `external_id`), nome, e-mail, e a cidade/estado que a
 *     importação e o formulário põem em `source_metadata` (`Cidade`, `Estado`);
 *  2. o negócio: o formulário do OS grava em `custom_fields` o navegador de
 *     quem preencheu (`meta_fbc`, `meta_fbp`, `meta_ip`, `meta_user_agent`) e o
 *     `fbclid` — é o mesmo dado que faz o formulário tirar EMQ alta;
 *  3. o clique do link rastreável (`meta_ads_click_refs` casado com o contato):
 *     o `fbclid` da URL do anúncio e o instante do clique, de onde sai o `fbc`.
 *
 * ⚠️ Enriquecer NUNCA impede o envio: qualquer falha de leitura devolve o que
 * já se tem (ou nada) e o evento sai como antes, só com o telefone. Perder um
 * campo de match custa pouco; perder o evento custa a otimização.
 *
 * ⚠️ `organization_id` em toda consulta: o client é service-role e bypassa RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import {
  fbcDoClique,
  fbcValido,
  type IdentidadeParaMeta,
} from "@/lib/plataformas-de-anuncio/meta/user-data";

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Lê a primeira chave presente, aceitando a grafia da importação (`Cidade`). */
function campo(obj: Record<string, unknown>, ...chaves: string[]): string | null {
  for (const c of chaves) {
    const v = texto(obj[c]);
    if (v) return v;
  }
  return null;
}

const comoObjeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export interface DadosBrutosDaIdentidade {
  contato: {
    id: string;
    phone_number?: string | null;
    name: string | null;
    display_name: string | null;
    email: string | null;
    source_metadata: unknown;
  } | null;
  camposDoLead: unknown;
  cliqueDoLink: {
    utm: unknown;
    created_at: string;
    client_ip_address?: string | null;
    client_user_agent?: string | null;
    fbp?: string | null;
  } | null;
}

/** Pura: decide, das três fontes, o valor de cada campo. */
export function identidadeDosDados(d: DadosBrutosDaIdentidade): IdentidadeParaMeta {
  const meta = comoObjeto(d.contato?.source_metadata);
  const lead = comoObjeto(d.camposDoLead);
  const utmDoClique = comoObjeto(d.cliqueDoLink?.utm);

  // O `fbc` mais confiável é o cookie que o pixel gravou no navegador (vem do
  // formulário). Na falta, monta-se do `fbclid` com o instante do clique — o
  // do link rastreável primeiro (carimbado pelo nosso servidor), depois o que
  // a origem do contato guardou junto do momento da captura.
  const fbc =
    fbcValido(texto(lead.meta_fbc)) ??
    fbcDoClique(texto(utmDoClique.fbclid), d.cliqueDoLink?.created_at) ??
    fbcDoClique(campo(meta, "fbclid"), campo(meta, "origem_capturada_em", "ad_captured_at"));

  return {
    // O MESMO `external_id` que o formulário do OS manda: o telefone só em
    // dígitos, com DDI. Assim a Meta liga o lead do formulário aos eventos de
    // etapa do CRM da mesma pessoa. Sem telefone, o id do contato ainda
    // identifica a pessoa entre os eventos do próprio CRM.
    externalId: d.contato?.phone_number?.replace(/\D/g, "") || d.contato?.id || null,
    email: texto(d.contato?.email),
    // `name` é o que alguém digitou; `display_name` pode ser o apelido do
    // WhatsApp — ainda serve, mas só na falta do primeiro.
    nome: texto(d.contato?.name) ?? texto(d.contato?.display_name),
    cidade: campo(meta, "Cidade", "cidade", "city"),
    estado: campo(meta, "Estado", "estado", "state"),
    cep: campo(meta, "CEP", "cep", "zip"),
    fbc,
    // O navegador do formulário vence; na falta, o do clique no link.
    fbp: texto(lead.meta_fbp) ?? texto(d.cliqueDoLink?.fbp),
    ip: texto(lead.meta_ip) ?? texto(d.cliqueDoLink?.client_ip_address),
    userAgent: texto(lead.meta_user_agent) ?? texto(d.cliqueDoLink?.client_user_agent),
  };
}

export async function lerIdentidadeParaMeta(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string,
  contactId: string | null,
): Promise<IdentidadeParaMeta> {
  try {
    const [contato, lead, clique] = await Promise.all([
      contactId
        ? admin
            .from("contacts")
            .select("id, phone_number, name, display_name, email, source_metadata, is_anonymized")
            .eq("organization_id", organizationId)
            .eq("id", contactId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from("crm_leads")
        .select("custom_fields")
        .eq("organization_id", organizationId)
        .eq("id", leadId)
        .maybeSingle(),
      contactId
        ? admin
            .from("meta_ads_click_refs")
            // `*` e não os nomes: antes da acelera_0006 as colunas do navegador não
            // existem, e pedi-las por nome derrubaria a leitura inteira (e o `fbc`).
            .select("*")
            .eq("organization_id", organizationId)
            .eq("contact_id", contactId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const c = contato.data as
      (DadosBrutosDaIdentidade["contato"] & { is_anonymized?: boolean }) | null;
    // Anonimizado (LGPD) não sai identificado para fora, nem em hash.
    if (c?.is_anonymized) return {};
    return identidadeDosDados({
      contato: contato.error ? null : c,
      camposDoLead: lead.error
        ? null
        : (lead.data as { custom_fields?: unknown } | null)?.custom_fields,
      cliqueDoLink: clique.error ? null : (clique.data as DadosBrutosDaIdentidade["cliqueDoLink"]),
    });
  } catch (erro) {
    logger.warn("[conversoes.meta] identidade indisponível; envio segue só com o telefone", {
      organizationId,
      leadId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return {};
  }
}
