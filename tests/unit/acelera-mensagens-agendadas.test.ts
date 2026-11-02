/**
 * (Acelera) Mensagem agendada: a trava contra envio duplo e os bloqueios.
 * O banco é um dublê que honra o UPDATE condicional, que é o que a trava usa.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  instanteDoAgendamento,
  motivoParaNaoEnviar,
  recusaDoInstante,
  rodarMensagensAgendadas,
  type ConversaParaEnvio,
  type EnviarAgendada,
} from "@/lib/acelera/mensagens-agendadas";
import { ApiError } from "@/lib/api/types";

const AGORA = new Date("2026-11-02T15:00:00.000Z");

type Linha = Record<string, unknown>;

function bancoFalso(linhas: Linha[], conversa: Partial<ConversaParaEnvio> | null = {}, membro = true) {
  const conversaFinal = conversa && {
    status: "open",
    last_inbound_at: null,
    contacts: { is_blocked: false, is_personal: false },
    channel_sessions: { provider: "waha" },
    ...conversa,
  };
  const tabelas: Record<string, Linha[]> = { mensagens_agendadas: linhas };
  const consulta = (tabela: string) => {
    let patch: Linha | null = null;
    const filtros: Array<(l: Linha) => boolean> = [];
    const executar = () => {
      if (tabela === "user_organizations") return { data: membro ? { user_id: "u1" } : null, error: null };
      if (tabela === "conversations") return { data: conversaFinal, error: null };
      const achadas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      if (patch) for (const l of achadas) Object.assign(l, patch);
      // Devolve cópia, como o banco: mudar a linha depois não muda o que já foi lido.
      return { data: achadas.map((l) => ({ ...l })), error: null };
    };
    const q = {
      select: () => q,
      update: (p: Linha) => ((patch = p), q),
      eq: (coluna: string, valor: unknown) => {
        if (!coluna.includes(".")) filtros.push((l) => l[coluna] === valor);
        return q;
      },
      is: () => q,
      lt: (coluna: string, valor: string) => {
        filtros.push((l) => typeof l[coluna] === "string" && (l[coluna] as string) < valor);
        return q;
      },
      lte: (coluna: string, valor: string) => {
        filtros.push((l) => (l[coluna] as string) <= valor);
        return q;
      },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const r = executar();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
      },
      then: (ok: (r: unknown) => unknown) => Promise.resolve(executar()).then(ok),
    };
    return q;
  };
  return { from: (t: string) => consulta(t) } as unknown as SupabaseClient;
}

const pendente = (extra: Linha = {}): Linha => ({
  id: "a1",
  organization_id: "o1",
  conversation_id: "c1",
  corpo: "oi",
  criado_por: "u1",
  status: "pendente",
  enviar_em: "2026-11-02T14:59:00.000Z",
  travada_em: null,
  organizations: { status: "active" },
  ...extra,
});

const enviou = (): EnviarAgendada =>
  vi.fn(async (e) => ({ id: e.agendamentoId, status: "sent" }));

describe("trava contra envio duplo", () => {
  it("duas rodadas simultâneas enviam uma vez só", async () => {
    const linha = pendente();
    const admin = bancoFalso([linha]);
    const enviar = enviou();
    const [a, b] = await Promise.all([
      rodarMensagensAgendadas(admin, AGORA, enviar),
      rodarMensagensAgendadas(admin, AGORA, enviar),
    ]);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(a.enviadas + b.enviadas).toBe(1);
    expect(linha.status).toBe("enviada");
    expect(linha.message_id).toBe("a1");
  });

  it("a rodada seguinte não reenvia o que já saiu", async () => {
    const admin = bancoFalso([pendente()]);
    const enviar = enviou();
    await rodarMensagensAgendadas(admin, AGORA, enviar);
    await rodarMensagensAgendadas(admin, AGORA, enviar);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("cancelada ou futura não sai", async () => {
    const admin = bancoFalso([
      pendente({ status: "cancelada" }),
      pendente({ id: "a2", enviar_em: "2026-11-02T16:00:00.000Z" }),
    ]);
    const enviar = enviou();
    await rodarMensagensAgendadas(admin, AGORA, enviar);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("presa em `enviando` vira falhou e nunca volta a sair", async () => {
    const presa = pendente({ status: "enviando", travada_em: "2026-11-02T14:00:00.000Z" });
    const enviar = enviou();
    const r = await rodarMensagensAgendadas(bancoFalso([presa]), AGORA, enviar);
    expect(r.destravadas).toBe(1);
    expect(presa.status).toBe("falhou");
    expect(presa.motivo_falha).toMatch(/pode ou não ter saído/);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("em andamento há pouco não é destravada", async () => {
    const recente = pendente({ status: "enviando", travada_em: "2026-11-02T14:58:00.000Z" });
    await rodarMensagensAgendadas(bancoFalso([recente]), AGORA, enviou());
    expect(recente.status).toBe("enviando");
  });

  it("o id da mensagem é o id do agendamento, e a falha não é retentada", async () => {
    const linha = pendente();
    const enviar: EnviarAgendada = vi.fn(async () => {
      throw new ApiError(403, "forbidden", undefined, "r", "Contato bloqueou o atendimento.");
    });
    const admin = bancoFalso([linha]);
    await rodarMensagensAgendadas(admin, AGORA, enviar);
    await rodarMensagensAgendadas(admin, AGORA, enviar);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(linha.status).toBe("falhou");
    expect(linha.motivo_falha).toBe("Contato bloqueou o atendimento.");
  });

  it("mensagem devolvida como failed ou queued não conta como enviada", async () => {
    for (const [status, motivo] of [["failed", "canal caiu"], ["queued", null]] as const) {
      const linha = pendente();
      const enviar: EnviarAgendada = async (e) => ({
        id: e.agendamentoId,
        status,
        error_message: motivo,
      });
      await rodarMensagensAgendadas(bancoFalso([linha]), AGORA, enviar);
      expect(linha.status).toBe("falhou");
      expect(linha.motivo_falha).toBeTruthy();
    }
  });
});

describe("bloqueios registram o motivo e não enviam", () => {
  it.each([
    ["encerrada", { status: "closed" }, /encerrada/],
    ["arquivada", { status: "archived" }, /encerrada/],
    ["bloqueado", { contacts: { is_blocked: true, is_personal: false } }, /bloqueado/],
    ["pessoal", { contacts: { is_blocked: false, is_personal: true } }, /pessoal/],
    ["janela fechada", { channel_sessions: { provider: "meta_cloud" }, last_inbound_at: "2026-11-01T14:00:00.000Z" }, /24 horas/],
  ] as const)("%s", async (_nome, conversa, motivo) => {
    const linha = pendente();
    const enviar = enviou();
    await rodarMensagensAgendadas(bancoFalso([linha], conversa as Partial<ConversaParaEnvio>), AGORA, enviar);
    expect(enviar).not.toHaveBeenCalled();
    expect(linha.status).toBe("falhou");
    expect(linha.motivo_falha).toMatch(motivo);
  });

  it("conversa que sumiu e autor removido", async () => {
    const a = pendente();
    await rodarMensagensAgendadas(bancoFalso([a], null), AGORA, enviou());
    expect(a.motivo_falha).toMatch(/não existe/);
    const b = pendente();
    await rodarMensagensAgendadas(bancoFalso([b], {}, false), AGORA, enviou());
    expect(b.motivo_falha).toMatch(/não faz mais parte/);
  });

  it("janela aberta na API oficial e canal sem janela enviam", () => {
    const base: ConversaParaEnvio = {
      status: "open",
      last_inbound_at: "2026-11-02T14:00:00.000Z",
      contacts: { is_blocked: false, is_personal: false },
      channel_sessions: { provider: "meta_cloud" },
    };
    expect(motivoParaNaoEnviar(base, AGORA)).toBeNull();
    expect(
      motivoParaNaoEnviar({ ...base, last_inbound_at: null, channel_sessions: { provider: "waha" } }, AGORA),
    ).toBeNull();
  });
});

describe("dia e hora em São Paulo", () => {
  it("converte para o instante certo (UTC-3)", () => {
    expect(instanteDoAgendamento("2026-11-03", "14:30")?.toISOString()).toBe("2026-11-03T17:30:00.000Z");
  });
  it("recusa data inexistente, passado e longe demais", () => {
    expect(instanteDoAgendamento("2026-02-31", "10:00")).toBeNull();
    expect(recusaDoInstante(null, AGORA)).toBeTruthy();
    expect(recusaDoInstante(new Date("2026-11-02T14:00:00Z"), AGORA)).toMatch(/futuro/);
    expect(recusaDoInstante(new Date("2027-06-01T14:00:00Z"), AGORA)).toMatch(/90 dias/);
    expect(recusaDoInstante(new Date("2026-11-03T14:00:00Z"), AGORA)).toBeNull();
  });
});

describe("migration", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261102000001_acelera_0004_mensagens_agendadas.sql"),
    "utf8",
  );
  it("nasce com RLS por organização e a tela só cancela", () => {
    expect(sql).toContain("enable row level security");
    expect(sql.match(/fn_user_org_ids/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/with check \(organization_id in .* and status = 'cancelada'\)/);
    expect(sql).not.toMatch(/grant update \([^)]*corpo/);
  });
  it("o relógio agenda a rota", () => {
    const crontab = readFileSync(resolve(process.cwd(), "docker/scheduler/entrypoint.sh"), "utf8");
    expect(crontab).toContain("* * * * *|55|api/v1/cron/mensagens-agendadas");
  });
});
