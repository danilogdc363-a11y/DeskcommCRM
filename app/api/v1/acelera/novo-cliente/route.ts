/**
 * ACELERA (fork): base da tela "Novo cliente" do OS, lida em runtime porque a
 * imagem é genérica (NEXT_PUBLIC_* sai com placeholder no build).
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  return ok({ base: process.env.ACELERA_OS_NOVO_CLIENTE_URL?.trim() || null }, { requestId });
}
