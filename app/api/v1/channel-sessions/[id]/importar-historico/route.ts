/**
 * (Acelera) POST: importa o acervo do canal para os contatos que têm negócio.
 *
 * Roda em lotes para caber no tempo de uma requisição: `contato_inicial` é o
 * `proximo` da resposta anterior. `contact_id` restringe a um contato, para
 * conferir antes de importar tudo. LGPD: nenhum corpo de mensagem vai para log.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { importarHistoricoDoContato } from "@/lib/acelera/importar-historico";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { lerGuardarHistorico } from "@/lib/channels/acervo-do-historico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const Corpo = z.object({
  contact_id: z.uuid().optional(),
  contato_inicial: z.uuid().optional(),
  limite: z.number().int().min(1).max(50).default(10),
});

export async function POST(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions" });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", "Canal inválido.", 422, { requestId });
  const corpo = Corpo.safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return fail("validation_failed", "Pedido inválido.", 422, { requestId });

  const db = createAdminClient();
  const organizationId = auth.org.orgId;
  const { data: canal } = await db
    .from("channel_sessions")
    .select("metadata, waha_session_name")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!canal?.waha_session_name) return fail("not_found", "Canal não encontrado.", 404, { requestId });
  if (!lerGuardarHistorico(canal.metadata)) {
    return fail("conflict", "Ligue o acervo do histórico nesta conexão antes de importar.", 409, { requestId });
  }
  const waha = getWahaClient();
  if (!waha) return fail("unavailable", "Canal indisponível.", 503, { requestId });

  // Quem tem negócio, em ordem estável para o cursor andar.
  let busca = db
    .from("contacts")
    .select("id, phone_number, crm_leads!inner(id)")
    .eq("organization_id", organizationId)
    .order("id", { ascending: true })
    .limit(corpo.data.limite);
  if (corpo.data.contact_id) busca = busca.eq("id", corpo.data.contact_id);
  else if (corpo.data.contato_inicial) busca = busca.gt("id", corpo.data.contato_inicial);
  const { data: contatos, error } = await busca;
  if (error) return fail("internal_error", "Não consegui ler os contatos.", 500, { requestId });

  const sessao = { organizationId, canalId: id, nomeDaSessao: canal.waha_session_name as string };
  const total = { contatos: 0, importadas: 0, repetidas: 0, sem_whatsapp: 0, conversas_criadas: 0 };
  const lista = contatos ?? [];
  for (const contato of lista) {
    const r = await importarHistoricoDoContato(db, waha, sessao, contato);
    total.contatos += 1;
    total.importadas += r.importadas;
    total.repetidas += r.repetidas;
    if (r.sem_whatsapp) total.sem_whatsapp += 1;
    if (r.conversa_criada) total.conversas_criadas += 1;
  }

  void audit({
    action: "channel.historico_importado",
    actorUserId: auth.user.id,
    organizationId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: total,
  });
  const proximo =
    !corpo.data.contact_id && lista.length === corpo.data.limite ? lista[lista.length - 1]?.id : null;
  return ok({ ...total, proximo }, { requestId });
}
