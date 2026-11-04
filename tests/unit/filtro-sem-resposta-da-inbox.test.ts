import { describe, expect, it } from "vitest";

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";
import { contagemSoSemResposta } from "@/app/api/v1/conversations/counts/route";
import { listConversationsQuerySchema } from "@/lib/schemas/messaging";
import { filtrosAuxiliaresAtivos } from "@/lib/inbox/filtros-ativos";

/**
 * "AGUARDANDO 1ª RESPOSTA": quem escreveu e a equipe nunca respondeu.
 * Regra: `last_outbound_at IS NULL AND last_inbound_at IS NOT NULL`, fora de grupo.
 * Sem migration: as duas colunas já existem. `awaiting_since` não serve (é
 * recalculado a cada resposta).
 */

interface Chamada {
  tabela: string;
  metodo: string;
  args: unknown[];
}

function fakeSupabase() {
  const chamadas: Chamada[] = [];
  const client = {
    from: (tabela: string) => {
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
            }
            return (...args: unknown[]) => {
              chamadas.push({ tabela, metodo: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  };
  return { client: client as never, chamadas };
}

const ctx = {
  organization_id: "org-1",
  requestId: "req-1",
  actor: { type: "user" as const, id: "user-1" },
} as never;

async function listar(query: Record<string, unknown>) {
  const { client, chamadas } = fakeSupabase();
  await listConversationsHandler(client, ctx, { limit: 50, ...query } as never);
  return chamadas.filter((c) => c.tabela === "conversations").map((c) => `${c.metodo}:${c.args.join(":")}`);
}

describe("filtro sem_resposta", () => {
  it("pede ao banco: nunca respondida, já escreveu, fora de grupo, na consulta da organização", async () => {
    const f = await listar({ sem_resposta: true });
    expect(f).toContain("is:last_outbound_at:");
    expect(f).toContain("not:last_inbound_at:is:");
    expect(f).toContain("eq:is_group:false");
    expect(f).toContain("eq:organization_id:org-1");
  });

  it("CONTROLE: sem o filtro, nenhum desses predicados sai", async () => {
    const f = await listar({});
    // Só predicados: o `select` cita as colunas e não filtra nada.
    const predicados = f.filter((x) => x.startsWith("is:") || x.startsWith("not:") || x.startsWith("eq:"));
    expect(predicados.some((x) => x.includes("last_outbound_at"))).toBe(false);
    expect(predicados.some((x) => x.includes("last_inbound_at"))).toBe(false);
    expect(f).not.toContain("eq:is_group:false");
  });

  it("não usa awaiting_since como régua do filtro", async () => {
    const f = await listar({ sem_resposta: true });
    expect(f.filter((x) => x.startsWith("is:") || x.startsWith("not:")).join(" ")).not.toContain("awaiting_since");
  });
});

describe("contrato do parâmetro", () => {
  it("o schema aceita sem_resposta=true e ignora ausente", () => {
    const base = { limit: "10" };
    expect(listConversationsQuerySchema.parse({ ...base, sem_resposta: "true" }).sem_resposta).toBe(true);
    expect(listConversationsQuerySchema.parse(base).sem_resposta).toBeUndefined();
  });

  it("a contagem (badge) lê o mesmo parâmetro", () => {
    expect(contagemSoSemResposta(new URLSearchParams("sem_resposta=true"))).toBe(true);
    expect(contagemSoSemResposta(new URLSearchParams(""))).toBe(false);
  });

  it("a tela nomeia o filtro ligado", () => {
    expect(filtrosAuxiliaresAtivos({ sem_resposta: true } as never)).toContain("Sem resposta");
  });
});
