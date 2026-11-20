/**
 * O consumidor do PÓS-VENDA que vai à Meta: o mês de cliente ativo
 * (`ClienteAtivo`) e o cancelamento. As regras puras e o porquê de cada chave
 * moram em `pos-venda.ts`; o envio é o MESMO de todo evento de conversão
 * (`processarConversao`), com o mesmo livro-razão, a mesma atribuição e a
 * mesma tela de pendências.
 *
 * Só sai para quem veio de anúncio da Meta (a atribuição do contato), e só do
 * funil `is_client_pipeline`: a reunião de um ORÇAMENTO não é sinal de cliente
 * que fica, e a perda de um orçamento não é cancelamento de contrato.
 *
 * As travas do `ClienteAtivo`, na ordem:
 *  - a reunião está realizada (o compromisso relido, não só o evento) e tem
 *    contato;
 *  - o contato tem negócio ABERTO no funil de clientes — cliente que cancelou
 *    não é cliente ativo;
 *  - o mês é o do relógio da organização, e o valor (a mensalidade) é lido na
 *    primeira tentativa e GRAVADO no livro-razão: uma nova tentativa manda o
 *    mesmo valor mesmo que a mensalidade mude no meio;
 *  - o que já foi enviado no mês não sai de novo.
 *
 * Fora do escopo desta entrega: o reenvio MANUAL pela tela de Histórico
 * (`fn_solicitar_reenvio_conversao` só aceita os nomes de antes). A nova
 * tentativa automática de falha transitória funciona, porque é o próprio
 * consumidor que reagenda a linha.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { fusoDaOrganizacao } from "@/lib/automation/cron-de-data";
import { negocioAbertoDoContato } from "@/lib/leads/negocio-aberto-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehFunilDeClientes, processarConversao } from "./envio.handler";
import {
  EVENTO_DE_CANCELAMENTO,
  EVENTO_DE_CLIENTE_ATIVO,
  eventoDeClienteAtivo,
  mesDaInteracao,
  valorDoMesAtivo,
} from "./pos-venda";
import { lerRegistro } from "./registro-de-envio";

const KEY = "conversoes.pos_venda";
const ESPERA_MS = 5 * 60 * 1000;

type Admin = ReturnType<typeof createAdminClient>;

const ignorar = (detail: string): HandlerResult => ({ consumer_key: KEY, status: "skipped", detail });

/** Lê uma linha e LANÇA em erro de leitura: o consumidor reagenda, nunca decide no escuro. */
async function linha<T>(
  consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  oQue: string,
): Promise<T | null> {
  const { data, error } = await consulta;
  if (error) throw new Error(`leitura ${oQue} falhou: ${error.message}`);
  return (data as T | null) ?? null;
}

/** O funil de clientes ativo da organização, ou `null` quando ela não tem um. */
async function funilDeClientes(admin: Admin, organizationId: string): Promise<string | null> {
  const funil = await linha<{ id: string }>(
    admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_client_pipeline", true)
      .eq("is_archived", false)
      .limit(1)
      .maybeSingle(),
    "do funil de clientes",
  );
  return funil?.id ?? null;
}

async function clienteAtivo(admin: Admin, row: EventRow): Promise<HandlerResult> {
  if (!row.entity_id || row.entity_kind !== "calendar_appointment") return ignorar("sem_compromisso");
  if (!row.created_at || !Number.isFinite(Date.parse(row.created_at))) return ignorar("sem_data");

  // ⚠️ Filtro de organização junto do id: o client é service-role e bypassa RLS.
  const compromisso = await linha<{ status: string; contact_id: string | null }>(
    admin
      .from("calendar_appointments")
      .select("status, contact_id")
      .eq("organization_id", row.organization_id)
      .eq("id", row.entity_id)
      .maybeSingle(),
    "do compromisso",
  );
  // Corrigido para falta depois de marcado como realizado: não é reunião.
  if (compromisso?.status !== "completed") return ignorar("reuniao_nao_realizada");
  if (!compromisso.contact_id) return ignorar("sem_contato");

  const funil = await funilDeClientes(admin, row.organization_id);
  if (!funil) return ignorar("sem_funil_de_clientes");
  const negocio = await negocioAbertoDoContato(
    admin,
    row.organization_id,
    compromisso.contact_id,
    funil,
  );
  if (!negocio) return ignorar("nao_e_cliente_ativo");

  const org = await linha<{ timezone: string | null }>(
    admin.from("organizations").select("timezone").eq("id", row.organization_id).maybeSingle(),
    "da organização",
  );
  const evento = eventoDeClienteAtivo(
    mesDaInteracao(new Date(row.created_at), fusoDaOrganizacao(org?.timezone)),
  );

  const registro = await lerRegistro(admin, row.organization_id, negocio.id, evento);
  if (registro?.status === "sent") return ignorar("ja_enviada");

  // Primeira tentativa já gravada: o retrato vence (valor e instante).
  let valorCentavos: number | null;
  let ocorridoEm = row.created_at;
  if (registro?.event_occurred_at) {
    valorCentavos = registro.value_cents ?? null;
    ocorridoEm = registro.event_occurred_at;
  } else {
    const recorrente = await linha<{ recurring_value_cents: number | null }>(
      admin
        .from("crm_leads")
        .select("recurring_value_cents")
        .eq("organization_id", row.organization_id)
        .eq("id", negocio.id)
        .maybeSingle(),
      "da mensalidade",
    );
    valorCentavos = valorDoMesAtivo(recorrente?.recurring_value_cents);
  }

  const resultado = await processarConversao(row, {
    leadId: negocio.id,
    evento,
    ocorridoEm,
    eventoMeta: EVENTO_DE_CLIENTE_ATIVO,
    valorCentavos,
  });
  return { ...resultado, consumer_key: KEY };
}

async function cancelamento(admin: Admin, row: EventRow): Promise<HandlerResult> {
  if (!row.entity_id) return ignorar("sem_entidade");
  if (!row.created_at || !Number.isFinite(Date.parse(row.created_at))) return ignorar("sem_data");

  const registro = await lerRegistro(admin, row.organization_id, row.entity_id, EVENTO_DE_CANCELAMENTO);
  if (registro?.status === "sent") return ignorar("ja_enviada");

  if (!registro?.event_occurred_at) {
    const negocio = await linha<{ pipeline_id: string | null }>(
      admin
        .from("crm_leads")
        .select("pipeline_id")
        .eq("organization_id", row.organization_id)
        .eq("id", row.entity_id)
        .maybeSingle(),
      "do negócio",
    );
    if (!negocio) return ignorar("lead_inexistente");
    if (!(await ehFunilDeClientes(admin, row.organization_id, negocio.pipeline_id)))
      return ignorar("fora_do_funil_de_clientes");
  }

  const resultado = await processarConversao(row, {
    evento: EVENTO_DE_CANCELAMENTO,
    ocorridoEm: registro?.event_occurred_at ?? row.created_at,
    eventoMeta: EVENTO_DE_CANCELAMENTO,
  });
  return { ...resultado, consumer_key: KEY };
}

async function handle(row: EventRow): Promise<HandlerResult> {
  if (row.event_type !== "appointment.completed" && row.event_type !== "lead.lost")
    return ignorar("outro_evento");
  const admin = createAdminClient();
  try {
    return row.event_type === "lead.lost"
      ? await cancelamento(admin, row)
      : await clienteAtivo(admin, row);
  } catch {
    return {
      consumer_key: KEY,
      status: "retry",
      retry_at: new Date(Date.now() + ESPERA_MS).toISOString(),
      detail: "Não foi possível processar o evento de pós-venda. Nova tentativa agendada.",
    };
  }
}

export const conversaoDePosVendaHandler: EventHandler = {
  key: KEY,
  naOrgParada: "pula",
  events: ["appointment.completed", "lead.lost"],
  handle,
};
