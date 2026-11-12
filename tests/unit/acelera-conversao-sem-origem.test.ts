/** (Acelera) Lead sem origem de anúncio é reportado quando a organização liga a opção. */
import { describe, expect, it } from "vitest";

import { lerAtribuicao } from "@/lib/conversoes/leitura-da-atribuicao";

const adminCom = (settings: unknown, contato: Record<string, unknown>) => ({
  from: (tabela: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: tabela === "contacts" ? contato : { settings },
        error: null,
      }),
    };
    return q;
  },
});

const contato = { phone_number: "+5511999999999", email: " a@b.com ", source_metadata: {} };
const ligada = { conversions: { meta_report_without_origin: true } };

describe("conversão sem origem", () => {
  it("desligada, segue sem atribuição", async () => {
    const r = await lerAtribuicao(adminCom({}, contato) as never, "o", "c");
    expect(r).toEqual({ temAtribuicao: false, motivo: "sem_atribuicao" });
  });

  it("ligada, sai para a Meta sem clique, com telefone e e-mail", async () => {
    const r = await lerAtribuicao(adminCom(ligada, contato) as never, "o", "c");
    expect(r).toEqual({
      temAtribuicao: true,
      atribuicao: {
        plataforma: "meta_ads",
        cliqueDeOrigem: "",
        telefone: "5511999999999",
        email: "a@b.com",
      },
    });
  });

  it("ligada, sem telefone nem e-mail não há como reconhecer", async () => {
    const r = await lerAtribuicao(
      adminCom(ligada, { phone_number: null, email: null, source_metadata: {} }) as never,
      "o",
      "c",
    );
    expect(r).toEqual({ temAtribuicao: false, motivo: "sem_atribuicao" });
  });
});
