import { describe, expect, it } from "vitest";

import { lerTudo } from "./ler-tudo";

describe("lerTudo", () => {
  it("lê páginas até uma vir incompleta", async () => {
    const linhas = Array.from({ length: 5 }, (_, i) => i);
    const pedidos: Array<[number, number]> = [];
    const r = await lerTudo<number>(async (de, ate) => {
      pedidos.push([de, ate]);
      return { data: linhas.slice(de, ate + 1), error: null };
    }, 2);
    expect(r).toEqual(linhas);
    expect(pedidos).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("erro do banco sobe", async () => {
    await expect(
      lerTudo(async () => ({ data: null, error: { message: "permission denied" } })),
    ).rejects.toThrow("permission denied");
  });
});
