/** (Acelera) O acervo do WhatsApp entrando como histórico, nunca como atendimento. */
import { describe, expect, it, vi } from "vitest";

import { importarHistoricoDoContato, linhaDoHistorico } from "@/lib/acelera/importar-historico";

const destino = { organizationId: "o", canalId: "c", contatoId: "k", conversaId: "v" };
const sessao = { organizationId: "o", canalId: "c", nomeDaSessao: "s" };
const entrada = { id: "false_55@c.us_AAA", timestamp: 1000, fromMe: false, body: "oi", hasMedia: false };

describe("linhaDoHistorico", () => {
  it("marca o histórico e usa a data original", () => {
    expect(linhaDoHistorico(entrada, destino)).toMatchObject({
      external_id: "false_55@c.us_AAA",
      direction: "inbound",
      created_at: new Date(1_000_000).toISOString(),
      metadata: { historico_importado: true },
    });
  });

  it("grava a saída com a cauda do id, como o webhook", () => {
    const linha = linhaDoHistorico({ ...entrada, id: "true_55@c.us_BBB", fromMe: true }, destino);
    expect(linha).toMatchObject({ external_id: "BBB", direction: "outbound", sent_via: "external_device" });
  });

  it("avisa da mídia e ignora mensagem vazia", () => {
    expect(linhaDoHistorico({ ...entrada, body: "", hasMedia: true }, destino)?.body).toContain("Mídia");
    expect(linhaDoHistorico({ ...entrada, body: " " }, destino)).toBeNull();
  });
});

function bancoFalso(erroDoInsert: { code: string } | null = null) {
  const inseridas: unknown[] = [];
  const consulta = (data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data, error: null });
    return q;
  };
  const db = {
    from: (tabela: string) => {
      if (tabela === "conversations") return consulta({ id: "v" });
      return {
        ...consulta({ sent_at: new Date(2_000_000).toISOString() }),
        insert: async (linha: unknown) => {
          inseridas.push(linha);
          return { error: erroDoInsert };
        },
      };
    },
  };
  return { db: db as never, inseridas };
}

const canal = (paginas: (typeof entrada)[][], existe = true) => ({
  checkContactExists: vi.fn().mockResolvedValue({ numberExists: existe, chatId: existe ? "55@c.us" : null }),
  listarMensagensDoChat: vi.fn().mockImplementation(async () => paginas.shift() ?? []),
});
const contato = { id: "k", phone_number: "+55 11 9" };

describe("importarHistoricoDoContato", () => {
  it("só importa o que é anterior à conversa viva", async () => {
    const { db, inseridas } = bancoFalso();
    const r = await importarHistoricoDoContato(
      db,
      canal([[entrada, { ...entrada, id: "false_55@c.us_NOVA", timestamp: 3000 }]]),
      sessao,
      contato,
    );
    expect(r.importadas).toBe(1);
    expect(inseridas).toHaveLength(1);
  });

  it("repetir conta como repetida, sem falhar", async () => {
    const { db } = bancoFalso({ code: "23505" });
    const r = await importarHistoricoDoContato(db, canal([[entrada]]), sessao, contato);
    expect(r).toMatchObject({ importadas: 0, repetidas: 1 });
  });

  it("número fora do WhatsApp não consulta mensagens", async () => {
    const { db } = bancoFalso();
    const c = canal([], false);
    const r = await importarHistoricoDoContato(db, c, sessao, contato);
    expect(r.sem_whatsapp).toBe(true);
    expect(c.listarMensagensDoChat).not.toHaveBeenCalled();
  });
});
