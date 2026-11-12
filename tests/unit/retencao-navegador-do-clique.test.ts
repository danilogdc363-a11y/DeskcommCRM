/**
 * Retenção do navegador do clique no link rastreável (acelera_0007).
 *
 * Decisão do Danilo (12/11/2026): IP, user agent e `fbp` do clique saem depois
 * de 30 dias e na anonimização do contato. Os modos de falha vigiados:
 *  - o cron diário não chamar a limpeza (o dado fica para sempre);
 *  - a limpeza rodar com menos de 30 dias, ou a função deixar quem chama baixar
 *    o piso;
 *  - a limpeza apagar a LINHA do clique (e com ela a atribuição) em vez de só
 *    zerar as três colunas;
 *  - a função ficar alcançável pela anon key;
 *  - o contato anonimizado manter o navegador dos cliques;
 *  - rodada que limpou não deixar auditoria.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  RETENCAO_NAVEGADOR_DO_CLIQUE_DIAS,
  houveEfeito,
  podarHistorico,
  type PodaDb,
  type ResultadoDaRetencao,
} from "@/app/api/v1/cron/data-retention/route";

vi.mock("@/lib/env", () => ({ env: { INTERNAL_CRON_SECRET: "s", INTERNAL_SECRET: "" } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const MIGRATION = readFileSync(
  "supabase/migrations/20261112150000_acelera_0007_retencao_do_navegador_do_clique.sql",
  "utf8",
);
const BASELINE = readFileSync("supabase/baseline.sql", "utf8");

function dbQueLimpa(limpas: number) {
  const chamadas: { nome: string; dias: number }[] = [];
  const db: PodaDb = {
    async rpc(nome, args) {
      chamadas.push({ nome, dias: args.p_retencao_dias });
      return { data: nome === "fn_limpar_navegador_dos_cliques" ? limpas : 0, error: null };
    },
    async apagarRascunhos() {
      return { data: 0, error: null };
    },
    async enfileirarMidia() {
      return { data: { vencidas: 0, orfas: 0, expurgadas: 0 }, error: null };
    },
  };
  return { db, chamadas };
}

describe("o cron diário limpa o navegador do clique", () => {
  it("chama a função com 30 dias e reporta o que limpou", async () => {
    const { db, chamadas } = dbQueLimpa(7);
    const r = await podarHistorico(db, {});
    expect(RETENCAO_NAVEGADOR_DO_CLIQUE_DIAS).toBe(30);
    expect(chamadas).toContainEqual({ nome: "fn_limpar_navegador_dos_cliques", dias: 30 });
    expect(r.navegador_dos_cliques_limpo).toBe(7);
    expect(r.retencao_navegador_dos_cliques_dias).toBe(30);
    expect(houveEfeito(r)).toBe(true);
  });

  it("rodada que não limpou nada não conta como efeito", async () => {
    const { db } = dbQueLimpa(0);
    const r = await podarHistorico(db, {});
    expect(r.navegador_dos_cliques_limpo).toBe(0);
    expect(houveEfeito(r)).toBe(false);
  });

  it("falha da limpeza é nomeada e não derruba as outras podas", async () => {
    const { db } = dbQueLimpa(0);
    const rpc = db.rpc.bind(db);
    db.rpc = async (nome, args) =>
      nome === "fn_limpar_navegador_dos_cliques"
        ? { data: null, error: { message: "function does not exist" } }
        : rpc(nome, args);
    const r: ResultadoDaRetencao = await podarHistorico(db, {});
    expect(r.falhas.some((f) => f.startsWith("fn_limpar_navegador_dos_cliques"))).toBe(true);
    expect(r.navegador_dos_cliques_limpo).toBe(0);
  });
});

describe("a migration acelera_0007", () => {
  it("o piso de 30 dias mora no corpo da função", () => {
    expect(MIGRATION).toMatch(/greatest\(coalesce\(p_retencao_dias, 30\), 30\)/);
  });

  it("zera as três colunas e nunca apaga a linha do clique", () => {
    expect(MIGRATION).toMatch(/set client_ip_address = null, client_user_agent = null, fbp = null/);
    expect(MIGRATION).not.toMatch(/delete\s+from\s+public\.meta_ads_click_refs/i);
  });

  it("revoga das duas origens de EXECUTE (public e anon)", () => {
    expect(MIGRATION).toMatch(
      /revoke execute on function public\.fn_limpar_navegador_dos_cliques\(integer, integer\) from public, anon, authenticated;/,
    );
    expect(MIGRATION).toMatch(
      /revoke execute on function public\.fn_limpar_navegador_de_contato_anonimizado\(\) from public, anon, authenticated;/,
    );
  });

  it("o gatilho limpa o navegador quando o contato é anonimizado", () => {
    expect(MIGRATION).toMatch(/after update of is_anonymized on public\.contacts/);
    expect(MIGRATION).toMatch(
      /when \(new\.is_anonymized and not coalesce\(old\.is_anonymized, false\)\)/,
    );
    expect(MIGRATION).toMatch(/and contact_id = new\.id/);
    expect(MIGRATION).toMatch(/where organization_id = new\.organization_id/);
  });

  it("está no apêndice do baseline (o que o self-host aplica)", () => {
    expect(BASELINE).toContain(
      "-- ---- retenção do navegador do clique (migration acelera_0007) ----",
    );
    expect(BASELINE).toContain("create trigger trg_limpar_navegador_de_contato_anonimizado");
  });
});
