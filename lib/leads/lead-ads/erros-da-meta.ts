/**
 * (Acelera) O erro da Meta em português que a empresa entende, dizendo O QUE
 * FAZER. Função pura: recebe o que `graph.ts` devolveu e escolhe a frase.
 *
 * Nunca devolve o texto cru da Meta (em inglês, técnico, às vezes com ids).
 * O código numérico vai no fim, curto, para a Acelera conseguir investigar.
 *
 * A ORDEM importa: "acesso a leads" e "permissão não aprovada" também chegam
 * como erro 100/200, então o texto da mensagem é olhado ANTES do número.
 */
import type { RespostaDaGraph } from "./graph";

export type CodigoDoErroDaMeta =
  | "login_vencido"
  | "acesso_a_leads"
  | "permissao_nao_aprovada"
  | "sem_permissao_na_pagina"
  | "limite_da_meta"
  | "meta_fora_do_ar"
  | "erro_da_meta";

export interface ErroEmPortugues {
  codigo: CodigoDoErroDaMeta;
  mensagem: string;
  /**
   * O texto ORIGINAL da Meta (curto, só para quem administra), para a Acelera
   * diagnosticar quando a frase em português não basta. Nunca vai para a
   * empresa-cliente em tela pública: só em respostas das rotas de admin.
   */
  detalheTecnico: string | null;
}

type Falha = Extract<RespostaDaGraph<never>, { ok: false }>;

const PERMISSOES = [
  "leads_retrieval",
  "pages_manage_metadata",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "ads_management",
];

/** Nomes de permissão que a própria mensagem da Meta cita (ex.: pages_manage_ads). */
function permissoesCitadas(texto: string): string[] {
  return [...new Set(texto.match(/\b(?:pages|leads|ads|business|instagram)_[a-z_]+\b/g) ?? [])];
}

function fraseDoErro(falha: Falha): Omit<ErroEmPortugues, "detalheTecnico"> {
  if (falha.motivo === "rede") {
    return {
      codigo: "meta_fora_do_ar",
      mensagem: "A Meta não respondeu agora. Espere um pouco e tente de novo.",
    };
  }
  const codigo = falha.erro?.codigo ?? null;
  const sub = falha.erro?.subcodigo ?? null;
  const texto = (falha.erro?.mensagem ?? "").toLowerCase();
  const citadas = permissoesCitadas(texto);
  const sufixo = codigo !== null ? ` (código ${codigo}${sub !== null ? `.${sub}` : ""})` : ` (status ${falha.status ?? "?"})`;

  // 1. "Acesso a leads" (Lead Access Manager): a Página precisa liberar o app.
  if (
    texto.includes("lead access") ||
    texto.includes("leads access") ||
    (texto.includes("leadgen") && texto.includes("crm")) ||
    (texto.includes("leads_retrieval") && texto.includes("access"))
  ) {
    return {
      codigo: "acesso_a_leads",
      mensagem:
        "A Página ainda não liberou o acesso a leads para este app. Na Meta: Configurações do portfólio → Integrações → Acesso a leads → escolha a Página → CRMs → adicione o app. Depois volte aqui e tente de novo." +
        sufixo,
    };
  }

  // 2. Login vencido, cancelado ou senha trocada.
  if (codigo === 190 || falha.status === 401) {
    return {
      codigo: "login_vencido",
      mensagem:
        "O acesso ao Facebook venceu ou foi cancelado. Clique em “Conectar formulários” de novo para entrar outra vez." +
        sufixo,
    };
  }

  // 3. Permissão que a Meta ainda não aprovou para o app (só quem tem função no app consegue).
  if (PERMISSOES.some((p) => texto.includes(p)) || texto.includes("advanced access") || texto.includes("feature unavailable")) {
    return {
      codigo: "permissao_nao_aprovada",
      mensagem:
        `A Meta pediu uma permissão que este login não tem${citadas.length > 0 ? ` (${citadas.join(", ")})` : ""}. ` +
        "Se ela ainda não foi aprovada pela Meta para o app, só quem tem função no app (administrador, desenvolvedor ou testador) consegue. Peça à Acelera para conferir as permissões do app e depois clique em “Reconectar formulários”." +
        sufixo,
    };
  }

  // 4. Limite de chamadas.
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613 || falha.status === 429) {
    return {
      codigo: "limite_da_meta",
      mensagem: "A Meta pediu para esperar um pouco antes de tentar de novo. Tente em alguns minutos." + sufixo,
    };
  }

  // 5. Sem poder sobre a Página.
  if (codigo === 10 || codigo === 200 || codigo === 100 || falha.status === 403) {
    return {
      codigo: "sem_permissao_na_pagina",
      mensagem:
        "Sua conta do Facebook não tem permissão suficiente nesta Página. É preciso ser administrador da Página (ou ter acesso total a ela) para ligar os formulários." +
        sufixo,
    };
  }

  if (falha.status !== null && falha.status >= 500) {
    return { codigo: "meta_fora_do_ar", mensagem: "A Meta está com problema agora. Tente de novo em instantes." + sufixo };
  }
  return {
    codigo: "erro_da_meta",
    mensagem: "A Meta recusou o pedido. Tente de novo; se repetir, avise a Acelera com este código." + sufixo,
  };
}

export function traduzirErroDaMeta(falha: Falha): ErroEmPortugues {
  return { ...fraseDoErro(falha), detalheTecnico: falha.erro?.mensagem ?? null };
}
