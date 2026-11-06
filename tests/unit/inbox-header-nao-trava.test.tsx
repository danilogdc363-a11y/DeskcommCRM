import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ConversationHeader } from "@/components/inbox/ConversationHeader";

/**
 * CATRACA: o header do inbox não pode voltar a travar a largura da tela.
 *
 * ## O defeito, medido
 *
 * A barra de ações deste header era `shrink-0`. Como ela não encolhia nem
 * quebrava, o `min-content` do header inteiro era **707px** — e a coluna do
 * meio do inbox é `1fr`, que é `minmax(auto, 1fr)` e não encolhe abaixo do
 * conteúdo. Resultado: o painel de CRM ficava **311px fora da viewport em
 * 1280px**. Em uma resolução de trabalho comum, o atendente não via contexto
 * nenhum do cliente.
 *
 * ## Por que este teste é o que é (e o que ele NÃO é)
 *
 * Este teste olha CLASSE, não pixel — e isso é uma limitação declarada, não um
 * descuido: `min-content`, quebra de flex e resolução de grid são cálculo de
 * layout, e o jsdom não tem engine de layout. Medir largura aqui devolveria
 * zero em tudo e passaria feliz: verde por ausência de motor.
 *
 * A medição de verdade é `tests/sonda-inbox-cabe-na-tela.ts`, que roda num
 * browser e afere as 5 larguras. Esta catraca existe porque aquela sonda não
 * roda no CI, e a regressão específica — alguém devolver `shrink-0` à barra de
 * ações "para os botões não quebrarem" — é textual e barata de pegar.
 *
 * Se um dia o CI ganhar um passo de browser, este arquivo pode morrer em favor
 * da sonda. Enquanto isso, ele é a única coisa entre a regressão e a main.
 */

vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useCloseConversation", () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenConversation: () => ({ mutate: vi.fn(), isPending: false }),
  // O header passou a importar `useArchiveConversation` do MESMO módulo (issue
  // #923). Um dublê fechado que não acompanha a nova exportação não falha com
  // "faltou mock": falha com "useArchiveConversation is not a function", que
  // não fala nada do que este arquivo vigia.
  useArchiveConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useReleaseConversation", () => ({
  useReleaseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
// O nome do módulo importa: a primeira versão deste arquivo mockava
// "useResumeAi", que NÃO EXISTE — o real é `useResumeAiAttendance`. O teste
// passou assim mesmo (o hook verdadeiro rodou sob o provider), ou seja, o mock
// não mockava nada e ninguém era avisado. Mock de caminho inexistente é ruído
// que parece cobertura.
vi.mock("@/hooks/inbox/useResumeAiAttendance", () => ({
  useResumeAiAttendance: () => ({ mutate: vi.fn(), isPending: false }),
}));
// ACELERA: os botões do comercial (#9) moram em AcoesComerciaisDaConversa, que
// lê react-query (agendados, funil). Aqui só a largura importa: sem o mock o
// componente exigiria um provider que este arquivo não precisa para nada.
vi.mock("@/components/inbox/AcoesComerciaisDaConversa", () => ({
  DialogosComerciais: () => null,
  MensagensAgendadasDaConversa: () => null,
}));
// O header monta o discador (`DialButton`), que exige o `VoiceCallProvider` do
// shell autenticado. Aqui só a largura importa: o discador fica fora da conta.
vi.mock("@/components/voice/DialButton", () => ({ DialButton: () => null }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  usePermission: () => true,
  useAuth: () => ({ user: { id: "u-1" }, activeOrg: { orgId: "org-1", role: "manager" } }),
}));

const conversation = {
  id: "cv-1",
  organization_id: "org-1",
  contact_id: "ct-1",
  status: "open",
  assigned_to_user_id: null,
  assignee_kind: "ai",
  snooze_until: null,
  tags: [],
  contacts: { id: "ct-1", display_name: "Fulana", name: null, phone_number: "5511999" },
} as unknown as React.ComponentProps<typeof ConversationHeader>["conversation"];

function renderHeader(conv = conversation) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationHeader conversation={conv} />
    </QueryClientProvider>,
  );
}

// A barra é quem segura os botões, não um índice fixo: desde o #1625 o
// `children[1]` do header é a coluna que empilha a barra e o selo do automático.
// ACELERA (layout WhatsApp Web): Transferir/Fechar/Arquivar saíram da barra para
// o menu "⋮". A âncora passou a ser o próprio "⋮" ("Mais opções"), que mora
// SEMPRE na barra — não um botão que depende do estado da conversa.
function barraDeAcoes() {
  const barra = screen.getByRole("button", { name: "Mais opções" }).parentElement;
  expect(barra, "a barra de ações não renderizou").toBeTruthy();
  return barra as HTMLElement;
}

// As ações que moram no menu só existem no DOM com o menu aberto (portal do
// Radix). Abre e devolve o menu, para provar que cada ação continua ao alcance.
async function abrirMenuDaConversa() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Mais opções" }));
  return await screen.findByRole("menu");
}

describe("header do inbox — não trava a largura da tela", () => {
  it("a barra de ações NÃO é shrink-0 — era isso que impunha o piso de 707px", () => {
    const { container } = renderHeader();
    const header = container.firstElementChild as HTMLElement;
    // Guarda de vacuidade: sem header renderizado, todas as asserções abaixo
    // passariam por não haver o que verificar.
    expect(header, "o header não renderizou").toBeTruthy();

    const coluna = header.children[1] as HTMLElement;
    expect(coluna, "a coluna de ações não renderizou").toBeTruthy();
    for (const el of [coluna, barraDeAcoes()]) {
      expect(
        el.className.split(/\s+/),
        "`shrink-0` de volta na barra de ações: o header volta a travar em 707px e o painel de CRM sai da tela em 1280px",
      ).not.toContain("shrink-0");
      expect(el.className).toContain("min-w-0");
    }
  });

  it("o header pode reorganizar em vez de esconder ação", () => {
    const { container } = renderHeader();
    const header = container.firstElementChild as HTMLElement;
    const acoes = barraDeAcoes();
    // As duas pontas: o container quebra E a barra quebra internamente. Só uma
    // das duas não basta — sem a de dentro, a barra desce inteira e continua
    // pedindo a largura toda.
    expect(header.className).toContain("flex-wrap");
    expect(acoes.className).toContain("flex-wrap");
    expect(acoes.className).toContain("min-w-0");
  });

  it("as ações continuam TODAS ao alcance — reorganizar não é esconder", async () => {
    renderHeader();
    // Assumir fica à vista; Transferir e Fechar moram no menu "⋮" por decisão
    // deliberada da Acelera (layout WhatsApp Web). O que este caso protege não
    // mudou: nenhuma ação de quem atende pode SUMIR do header. Se uma delas
    // deixar de estar na barra OU no menu, reprova.
    expect(screen.getByText("Assumir"), 'a ação "Assumir" sumiu do header').toBeTruthy();
    const menu = await abrirMenuDaConversa();
    for (const rotulo of ["Transferir", "Fechar"]) {
      expect(
        within(menu).getByRole("menuitem", { name: rotulo }),
        `a ação "${rotulo}" sumiu do header (nem na barra, nem no menu)`,
      ).toBeTruthy();
    }
  });

  it("com o selo do automático, nenhuma ação some e o selo não divide linha com nome nem ações (#1625)", async () => {
    // O defeito do #1625: o selo morava na linha do nome, alargava a identidade
    // e jogava a barra inteira para baixo. O conserto aceito tira o selo das duas
    // linhas e NÃO esconde ação de quem atende. (A Acelera tem o menu "⋮" por
    // decisão própria — layout WhatsApp Web —; por isso cada ação abaixo precisa
    // estar na barra OU no menu, e as que o #1625 manteve à vista seguem à vista.)
    renderHeader({
      ...conversation,
      assigned_to_user_id: "u-1",
      assigned_to_user_name: "Eu",
      assignee_kind: "user",
      bot_silenced_until: new Date(Date.now() + 10 * 60_000).toISOString(),
    } as typeof conversation);

    const selo = screen.getByTestId("badge-atendimento-humano");
    expect(selo.textContent).toBe("Automático volta em instantes");

    const barra = barraDeAcoes();
    expect(barra.contains(selo), "o selo voltou para a linha das ações").toBe(false);
    const linhaDoNome = screen.getByRole("heading", { name: "Fulana" }).parentElement as HTMLElement;
    expect(linhaDoNome.contains(selo), "o selo voltou para a linha do nome").toBe(false);

    // À vista na barra (não foram para o menu).
    for (const rotulo of ["Devolver ao automático", "Lembrar"]) {
      const botao = screen.getByRole("button", { name: rotulo });
      expect(barra.contains(botao), `a ação "${rotulo}" saiu da barra`).toBe(true);
    }
    // No menu "⋮": continuam ao alcance, só não ocupam a fileira.
    const menu = await abrirMenuDaConversa();
    for (const rotulo of ["Liberar", "Transferir", "Fechar", "Arquivar"]) {
      expect(
        within(menu).getByRole("menuitem", { name: rotulo }),
        `a ação "${rotulo}" sumiu do header (nem na barra, nem no menu)`,
      ).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Mais ações" }), "ação de quem atende escondida num menu").toBeNull();
  });

  it("no celular a barra é UMA fileira que rola, não três ou quatro que comem a conversa", () => {
    // Relato de quem atende pelo telefone: com ~390px a barra quebrava em várias
    // fileiras e sobrava pouca altura para as mensagens. Abaixo do `md` ela não
    // quebra — rola na horizontal — e nenhum botão encolhe até virar ilegível.
    renderHeader();
    const classes = barraDeAcoes().className.split(/\s+/);
    for (const c of ["max-md:flex-nowrap", "max-md:overflow-x-auto", "max-md:[&>*]:shrink-0"]) {
      expect(classes, `sem \`${c}\` a barra volta a empilhar fileiras no celular`).toContain(c);
    }
  });

  it("no celular Assumir vem primeiro, a fileira mostra que rola e some com o teclado (F2)", () => {
    // Só CSS: a ordem do DOM (a do computador e a do teclado) não muda.
    renderHeader();
    const assumir = screen.getByRole("button", { name: "Assumir" });
    expect(assumir.className.split(/\s+/)).toContain("max-md:order-first");

    const barra = barraDeAcoes();
    expect(barra.className, "sem a máscara nada indica que há botões à direita").toMatch(
      /max-md:\[mask-image:linear-gradient\(/,
    );
    // Com o teclado aberto a coluna das ações sai, e o fio fica com a altura.
    // `max-md:` é obrigatório: no computador encolher a janela não é teclado.
    const coluna = barra.parentElement as HTMLElement;
    expect(coluna.className.split(/\s+/)).toContain("max-md:group-data-[teclado-aberto]/conversa:hidden");
    expect(coluna.className).not.toMatch(/(?:^|\s)group-data-\[teclado-aberto\]/);
  });

  it("no celular o telefone sai do cabeçalho (continua na Ficha)", () => {
    renderHeader();
    const telefone = screen.getByText(/5511999|\+55/).closest("p") as HTMLElement;
    expect(telefone.className.split(/\s+/)).toContain("max-md:hidden");
  });

  it('"Ver contato" continua ao alcance e leva à ficha do contato', async () => {
    renderHeader();
    // ACELERA: "Ver contato" mudou de lugar. Antes era um link na barra que só se
    // calava em `xl:` (onde o painel lateral tem o dele). Agora mora no menu "⋮",
    // que não ocupa fileira nenhuma — a duplicata na barra que o `xl:hidden`
    // evitava deixou de existir. O que não pode acontecer é a ação sumir: quem
    // usa 1024px não tem o painel e esta é a única porta para a ficha completa.
    // A barra se acha ANTES de abrir o menu: aberto, o Radix esconde o resto da
    // página (aria-hidden) e o botão "⋮" deixa de ser achado por papel.
    const barra = barraDeAcoes();
    const menu = await abrirMenuDaConversa();
    const item = within(menu).getByRole("menuitem", { name: /Ver contato/ });
    const link = (item.closest("a") ?? item.querySelector("a")) as HTMLAnchorElement | null;
    expect(link, "o link para o contato sumiu do menu").toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/app/contacts/ct-1");
    expect(barra.textContent ?? "", "a duplicata voltou para a barra").not.toContain("Ver contato");
  });
});
