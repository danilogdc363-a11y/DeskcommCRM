import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * ACELERA (fork) — `fn_mesclar_negocios` ("Unificar fichas", migration acelera 0008).
 *
 * Prova: (1) tudo que aponta para o absorvido vai para o principal; (2) o
 * absorvido vira lápide (não some) e sai do funil vivo; (3) o principal manda
 * nos campos; (4) a prévia não escreve; (5) contatos diferentes são juntados
 * junto; (6) org vizinha não alcança.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});

const ORG = "a0080000-0000-4000-8000-000000000001";
const ORG_VIZINHA = "a0080000-0000-4000-8000-0000000000f0";
const FUNIL = "a0080000-0000-4000-8000-000000000003";
const ABERTA = "a0080000-0000-4000-8000-000000000004";
const GANHA = "a0080000-0000-4000-8000-000000000005";
const PERDA = "a0080000-0000-4000-8000-000000000006";

let seq = 0;
const uid = (bloco: string) =>
  `a008${bloco}-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

async function contato(telefone: string): Promise<string> {
  const id = uid("c000");
  await pool.query(
    "insert into contacts (id, organization_id, name, phone_number) values ($1, $2, 'Jeferson', $3)",
    [id, ORG, telefone],
  );
  return id;
}

async function negocio(campos: {
  titulo: string;
  contato?: string | null;
  etapa?: string;
  valor?: number | null;
  tags?: string[];
  custom?: Record<string, unknown>;
  quando?: string;
}): Promise<string> {
  const id = uid("1000");
  await pool.query(
    `insert into crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id,
                            value_cents, tags, custom_fields, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))`,
    [
      id,
      ORG,
      FUNIL,
      campos.etapa ?? ABERTA,
      campos.titulo,
      campos.contato ?? null,
      campos.valor ?? null,
      campos.tags ?? [],
      JSON.stringify(campos.custom ?? {}),
      campos.quando ?? null,
    ],
  );
  return id;
}

async function atividade(lead: string) {
  await pool.query(
    `insert into crm_lead_activities (organization_id, lead_id, source_module, type)
     values ($1, $2, 'crm', 'note')`,
    [ORG, lead],
  );
}

async function unificar(principal: string, secundarios: string[], previa = false, org = ORG) {
  const { rows } = await pool.query<{ r: Record<string, unknown> }>(
    "select public.fn_mesclar_negocios($1, $2, $3, $4) as r",
    [org, principal, secundarios, previa],
  );
  return rows[0]!.r;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-a008', 'Unificar LTDA', 'Unificar'), ($2, 'org-a008-viz', 'Viz LTDA', 'Viz')
     on conflict (id) do nothing`,
    [ORG, ORG_VIZINHA],
  );
  await pool.query(
    `insert into crm_pipelines (id, organization_id, name, slug)
     values ($1, $2, 'Orçamento', 'orcamento-a008') on conflict (id) do nothing`,
    [FUNIL, ORG],
  );
  await pool.query(
    `insert into crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won, is_lost)
     values ($1, $4, $5, 'Pedido novo', 'pedido-novo', 1, false, false),
            ($2, $4, $5, 'Fechou', 'fechou', 2, true, false),
            ($3, $4, $5, 'Não fechou', 'nao-fechou', 3, false, true)
     on conflict (id) do nothing`,
    [ABERTA, GANHA, PERDA, ORG, FUNIL],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id in ($1, $2)", [ORG, ORG_VIZINHA]);
  await pool.end();
});

describe("fn_mesclar_negocios", () => {
  it("caso Bizzio: três cards do mesmo contato viram um, sem apagar nada", async () => {
    const jef = await contato("+5521964222408");
    const bizzio = await negocio({
      titulo: "@bizziopizza",
      contato: jef,
      etapa: GANHA,
      valor: 250000,
      tags: ["yay"],
      custom: { cidade: "Duque de Caxias" },
      quando: "2026-07-04T03:43:49Z",
    });
    const ganhoDup = await negocio({
      titulo: "Jeferson",
      contato: jef,
      etapa: GANHA,
      valor: 250000,
      custom: { cidade: "outra", origem: "automacao" },
    });
    const abertoDup = await negocio({ titulo: "Jeferson", contato: jef, tags: ["whatsapp"] });
    for (const l of [bizzio, bizzio, ganhoDup, abertoDup]) await atividade(l);

    const r = await unificar(bizzio, [ganhoDup, abertoDup]);
    expect(r).toMatchObject({
      previa: false,
      negocio_id: bizzio,
      repontado: expect.objectContaining({ "crm_lead_activities.lead_id": 2 }),
    });

    const { rows: ativ } = await pool.query<{ lead_id: string; n: string }>(
      `select lead_id, count(*)::text n from crm_lead_activities
        where lead_id = any($1) and type = 'note' group by lead_id`,
      [[bizzio, ganhoDup, abertoDup]],
    );
    expect(ativ).toEqual([{ lead_id: bizzio, n: "4" }]);

    const { rows: [p] } = await pool.query(
      "select tags, custom_fields, status, stage_id from crm_leads where id = $1",
      [bizzio],
    );
    expect([...p.tags].sort()).toEqual(["whatsapp", "yay"]);
    // O principal manda: "cidade" fica a dele; "origem" vem do absorvido.
    expect(p.custom_fields).toEqual({ cidade: "Duque de Caxias", origem: "automacao" });
    expect(p.status).toBe("won");

    const { rows: lapides } = await pool.query(
      `select id, merged_into_lead_id, merged_at, status, stage_id, lost_reason
         from crm_leads where id = any($1) order by id`,
      [[ganhoDup, abertoDup]],
    );
    expect(lapides).toHaveLength(2);
    for (const l of lapides) {
      expect(l.merged_into_lead_id).toBe(bizzio);
      expect(l.merged_at).not.toBeNull();
      expect(l.status).toBe("lost");
      expect(l.stage_id).toBe(PERDA);
      expect(l.lost_reason).toBe("other");
    }

    const { rows: rastro } = await pool.query(
      "select count(*)::int n from crm_lead_activities where lead_id = $1 and type = 'leads_merged'",
      [bizzio],
    );
    expect(rastro[0].n).toBe(1);
  });

  it("prévia conta e não escreve", async () => {
    const c = await contato("+5521900000001");
    const a = await negocio({ titulo: "A", contato: c });
    const b = await negocio({ titulo: "B", contato: c, tags: ["nova"], custom: { x: 1 } });
    await atividade(b);

    const r = await unificar(a, [b], true);
    expect(r).toMatchObject({
      previa: true,
      repontado: { "crm_lead_activities.lead_id": 1 },
      tags_novas: ["nova"],
      campos_novos: ["x"],
    });

    const { rows } = await pool.query(
      "select merged_into_lead_id, status from crm_leads where id = $1",
      [b],
    );
    expect(rows[0]).toEqual({ merged_into_lead_id: null, status: "open" });
    const { rows: at } = await pool.query(
      "select count(*)::int n from crm_lead_activities where lead_id = $1",
      [b],
    );
    expect(at[0].n).toBe(1);
  });

  it("contatos diferentes: junta os contatos também (mensagens moram no contato)", async () => {
    const c1 = await contato("+5521900000002");
    const c2 = await contato("+5521900000003");
    const a = await negocio({ titulo: "A", contato: c1 });
    const b = await negocio({ titulo: "B", contato: c2 });

    await unificar(a, [b]);

    const { rows } = await pool.query("select is_merged_into from contacts where id = $1", [c2]);
    expect(rows[0].is_merged_into).toBe(c1);
    const { rows: lb } = await pool.query("select contact_id from crm_leads where id = $1", [b]);
    expect(lb[0].contact_id).toBe(c1);
  });

  it("absorvido já unificado não entra de novo", async () => {
    const a = await negocio({ titulo: "A" });
    const b = await negocio({ titulo: "B" });
    const c = await negocio({ titulo: "C" });
    await unificar(a, [b]);
    await expect(unificar(c, [b])).rejects.toThrow(/negocio_secundario_indisponivel/);
  });

  it("org vizinha não alcança negócio desta org", async () => {
    const a = await negocio({ titulo: "A" });
    const b = await negocio({ titulo: "B" });
    await expect(unificar(a, [b], false, ORG_VIZINHA)).rejects.toThrow(
      /negocio_principal_indisponivel/,
    );
  });

  it("principal entre os absorvidos é recusado", async () => {
    const a = await negocio({ titulo: "A" });
    await expect(unificar(a, [a])).rejects.toThrow(/selecao_de_mesclagem_invalida/);
  });
});
