# ACELERA.md — o que este fork muda

Fork de `melgarafael/DeskcommCRM` (MIT) usado como **CRM comercial** pelo Acelera OS
(`comercial.aceleradelivery.com`). Tudo que é só nosso está listado aqui.

**Branch canônica: `acelera/1.100.0`** = tag `v1.100.0` do upstream + os commits do fork
(feita a partir de `acelera/1.98.9` com merge de `acelera/1.84.0` e da `v1.100.0`).
A `acelera/1.84.0` (tag `acelera-pre-1.100`) é a produção anterior e serve de rollback de código.
As migrations `acelera_0001..0004` estão no fim do `supabase/baseline.sql`, depois dos blocos do upstream (a 0001 cria função e por isso fica ANTES da varredura de anon).

## 1. Login único com o Acelera OS (multi-organização)

O **Acelera OS é o dono da identidade**. Os bancos continuam separados: o CRM tem o próprio
Supabase e os próprios usuários; o OS só prova "quem é e de qual workspace" com um passe
assinado. **Qualquer workspace do OS** pode entrar — cada um na SUA organização do CRM.

### Fluxo

1. No OS, a pessoa clica em **CRM comercial** (aparece para dono/admin de qualquer workspace,
   e para membros que o dono/admin liberou na tela de Membros → chave "entrar no CRM comercial").
2. O OS assina um passe de 60 s `crm1.<payload>.<HMAC-SHA256>` com
   `{ sub, email, name, role, org: { id, slug, name }, aud, exp, nonce }` e redireciona para
   `https://<crm>/sso?pass=...`.
3. O CRM (`app/sso/route.ts`) confere prefixo, assinatura, `aud`, validade e nonce (uso único).
4. Acha ou cria o usuário no Supabase do CRM **pelo e-mail** (`auth.admin.createUser` com
   e-mail confirmado; se já existe, usa o existente).
5. **Organização** (`lib/acelera-sso/entrada.ts`): procura a organização do CRM cujo
   `settings.provisioning` é `{ integration: "acelera-os", external_id: <id do workspace no OS> }`
   — o mesmo marcador que o provisionamento por sistema externo do próprio CRM usa
   (`provisionExternalTenant`). **Sem migration.**
   - achou → usa;
   - não achou e quem chega é **dono/admin** no OS → cria a organização com o nome do workspace
     (slug `acelera-os-<hash>`, mesma regra de `slugDoProvisionamento`) e essa pessoa vira `admin`;
   - não achou e quem chega é **membro** → recusado (`org_sem_dono`): o dono/admin entra primeiro.
6. Vínculo em `user_organizations`: dono/admin do OS → `admin`; membro → `ACELERA_SSO_MEMBER_ROLE`
   (padrão `agent`). Papel diferente é realinhado a cada entrada. Vínculo **revogado** no CRM
   continua revogado.
7. Sessão pelo mecanismo nativo do GoTrue: `auth.admin.generateLink({ type: "magiclink" })`
   (só no servidor — nenhum e-mail sai) + `auth.verifyOtp({ token_hash })`, o mesmo `verifyOtp`
   de `/auth/confirm`; grava o cookie `sb-deskcomm-auth`. Grava também `active_org` para cair
   na organização certa quem tem várias.
8. Segue para `/app` pela ponte same-origin (`respostaDePonte`) — cookie `SameSite=Strict`.

Organização nova entra no onboarding do CRM (é o comportamento normal de organização nova).
Quem tem MFA ligado no CRM continua passando pelo segundo fator do CRM.

### Ligar a organização que JÁ existe no CRM ao workspace do OS

A organização da Acelera já existe no CRM com dados. Para o primeiro login cair nela (e não
criar outra), grave o marcador **uma vez**, no banco do CRM:

```sql
update public.organizations
   set settings = coalesce(settings, '{}'::jsonb)
       || jsonb_build_object('provisioning',
            jsonb_build_object('integration', 'acelera-os',
                               'external_id', '<id do workspace da Acelera no OS>'))
 where id = '<id da organização no CRM>'
   and settings->'provisioning' is null;
```

(O `id` do workspace no OS é `organizations.id` no Supabase do OS.)

### Variáveis (no `.env` do compose do CRM, no EasyPanel)

| Variável | Exemplo | Para quê |
|---|---|---|
| `ACELERA_SSO_SECRET` | 64+ caracteres aleatórios | Mesma chave que `CRM_SSO_SECRET` no OS. Sem ela, `/sso` responde 404. |
| `ACELERA_SSO_MEMBER_ROLE` | `agent` | Papel de quem é *membro* no OS (`viewer`/`agent`/`manager`/`admin`). |
| `ACELERA_SSO_ONLY` | `true` | Desliga a tela de login/cadastro própria. |
| `ACELERA_OS_LOGIN_URL` | `https://os.aceleradelivery.com/login` | Para onde vai quem chega sem sessão (com `ACELERA_SSO_ONLY=true`) e quem chega com passe inválido/recusado. |

**Saída de emergência:** com `ACELERA_SSO_ONLY=true`, `/login?acesso_local=1` ainda mostra o
login por senha. `/login/mfa`, `/login/reset`, `/login/recovery`, `/login/forgot` e
`/login/continuar` continuam abertos.

### Quem já tinha conta no CRM

Casa **pelo e-mail**: a conta existente é reaproveitada (mesmo id, mesmos dados; a senha
continua valendo só via `?acesso_local=1`). Se o e-mail no OS for diferente, nasce outra conta —
alinhe os e-mails antes.

### Limites conhecidos

- Anti-replay em memória (uma réplica do `app`). Reiniciar dentro dos 60 s de um passe, ou
  rodar 2+ réplicas, abre uma janela pequena de replay.
- O passe vai na URL (inevitável num redirect entre domínios): 60 s, uso único, `no-store`,
  `Referrer-Policy: no-referrer`.

## 2. Aparência Acelera — por configuração, sem mexer em componente

O CRM já tem white-label nativo (`docs/white-label.md`). **Nenhuma tela foi editada.**

- `.env` (semente): `APP_NAME=Acelera CRM`, `APP_ACCENT_HEX=#FF7300`. Só vale na primeira
  leitura — depois **o banco manda**. Numa instalação que já existe, aplique em **`/admin/marca`**.
- Logo e ícone: a tela aceita **PNG ou JPG até 512 KB** (SVG é recusado). Originais vetoriais em
  `acelera/marca/`; os PNGs prontos para subir estão em `acelera/marca/png/` (`acelera/marca/png/logo-claro.png`,
  `acelera/marca/png/logo-escuro.png`, `acelera/marca/png/icone.png`).
- **Identidade Acelera:** `app/acelera-tema.css` traz a paleta do guia de marca (laranja #FF7300 e
  cinzas neutros), cantos de 5 a 10 px, Inter no texto e Anton em caixa alta no `h1`, com o risco à
  mão em laranja sob o título. Ele também vence a cor de `/admin/marca` e de **Configurações → Marca**
  (as duas telas derivam o laranja por contraste e dão marrom), então a cor salva nelas não muda nada.
- **Logo:** cadastre o par em **Configurações → Marca** (os dois PNGs de `acelera/marca/png/`). Sem o logo
  escuro, o produto desenha uma caixa branca em volta da arte no tema escuro. O Inbox segue a mesma
  paleta, sem verde (`app/acelera-whatsapp.css`).
- **Testes de navegador do upstream que não valem mais aqui:** os três que procuram "Atkinson" no botão
  (`aviso-de-caso-no-whatsapp`, `conversa-do-caso`, `passagem-com-contexto`).
- E-mails de acesso (GoTrue) leem o `.env`: depois de mudar `APP_ACCENT_HEX`, rodar
  `bash hostgator-setup-kit/marca-emails.sh` (ou ajustar os templates no Supabase do CRM).

## 3. Rodar no EasyPanel a partir deste fork

O compose versionado é **`docker-compose.easypanel.yml`** (raiz do repo, branch `acelera/1.84.0`):
`app`, `worker` e `scheduler` são **construídos** daqui (`Dockerfile`, `Dockerfile.worker`,
`Dockerfile.scheduler`); `waha`, `redis` e `srh` ficam nas imagens pinadas; sem `caddy` (o HTTPS é
do EasyPanel).

- No EasyPanel: serviço **Compose** → Fonte **Git** → repositório
  `https://github.com/danilogdc363-a11y/DeskcommCRM`, branch `acelera/1.84.0` (produção atual; na troca para a nova versão, `acelera/1.100.0`), arquivo
  `docker-compose.easypanel.yml`. Variáveis na aba Ambiente (as mesmas de hoje + `ACELERA_*`/`APP_*`).
  Domínio: serviço `app`, porta `3000`.
- `NEXT_PUBLIC_*` **não** são args de build (a imagem sai com placeholders e lê o `.env` ao subir).
  O único arg é `APP_VERSION`.
- Atualizar: `git push` na branch → **Implantar** (ou ligue o Auto Deploy por webhook do GitHub).
- Volumes do WhatsApp (`waha-data`, `waha-media`): use os MESMOS nomes do compose atual, senão é
  preciso parear o número de novo.
- Build do Next pede **~3–4 GB de RAM** e leva 15–25 min; o `mem_limit: 768m` vale só para o
  contêiner rodando, não para o build. Se o build morrer por memória (exit 137 / "JavaScript heap
  out of memory"): crie swap de 4 GB na VPS, ou construa a imagem fora (GitHub Actions →
  GHCR) e troque `build:` por `image:` no compose.

## 4. Arquivos do fork (para conferir num merge do upstream)

Novos (não conflitam): `ACELERA.md`, `docker-compose.easypanel.yml`, `acelera/marca/*.svg`, `lib/acelera-sso/{pass,config,entrada}.ts`,
`app/sso/route.ts`, `tests/unit/acelera-sso-{pass,entrada}.test.ts`.

Novos (lead ganho → Novo cliente no OS): `lib/acelera/novo-cliente-url{,.test}.ts`, `app/api/v1/acelera/novo-cliente/route.ts`, `hooks/acelera/useNovoClienteUrl.ts`. Variável de runtime `ACELERA_OS_NOVO_CLIENTE_URL` = `https://<OS>/app/<slug>/empresas/novo`; sem ela o botão "Cadastrar cliente" não aparece.

Novos (Análise → Resultados do funil, `/app/resultados-funil`, piso `manager`): `lib/reports/funil-meta{,.test}.ts`
(cálculo puro: janelas, funil, comparação CRM × Meta), `lib/plataformas-de-anuncio/meta/estatisticas-do-conjunto.ts`
(lê `/{dataset}/stats`, agregação por evento, `SERVER_ONLY`, com o conjunto e o token da API de Conversões;
token só no servidor), `app/api/v1/reports/funil-meta/route.ts`, `hooks/reports/useFunilMeta.ts`,
`app/app/resultados-funil/*`. Funil = padrão da organização, contado em Brasília; comparação com o Meta
cortada no fuso da conta (America/Los_Angeles) e limitada aos 28 dias que o Meta guarda (dia fora disso, ou
leitura do Meta que falhou, aparece como "Sem dados do Meta", nunca como "Não chegou"). A rota lê com o admin
client e `organization_id` explícito, porque `ad_conversion_dispatches`, `meta_ads_conversion_rules` e
`meta_ctwa_click_dispatches` são revogadas de `authenticated`. `stage_changed` é lido nas duas grafias
(`from_stage_id`/`to_stage_id` e `de`/`para`). Cliques CTWA somem da tela se a tabela não existir (antes da 1.100).
Paginação ordenada em `lib/reports/ler-tudo.ts`. Entrada no menu em `lib/navigation/catalogo.ts` (1 bloco) e
textos em espanhol no fim de `lib/i18n/dicionario.ts`. Sem migration.

Alterados (poucas linhas, marcadas com `ACELERA (fork)`):
- `components/kanban/KanbanCardActions.tsx` e `components/inbox/CRMSidePanel.tsx` — botão "Cadastrar cliente" em lead ganho
- `app/api/v1/contacts/route.ts` — POST aceita Bearer `dsk_` com `mcp:write` (OS grava lead de formulário); telefone repetido = 409 `contact_exists` com `details.contact_id`
- `lib/auth/public-paths.ts` — 1 linha: `/^\/sso$/`
- `proxy.ts` — 1 import + 2 blocos curtos (login próprio desligado)

Dependências do core usadas (se mudarem no upstream, revisar): `respostaDePonte`,
`marcaDaSaida`, `slugDoProvisionamento`, `audit`, `createAdminClient`, `createClient`,
`cookieSecure`, o cookie `active_org` e o marcador `settings.provisioning`.

Para atualizar: criar `acelera/<nova versão>` a partir da tag nova e `git cherry-pick` os commits
do fork; conflito só pode aparecer nos dois arquivos alterados.

## Botão "Conectar com o Facebook" (Configurações → Meta Ads)

Usa o MESMO app da Meta do WhatsApp oficial, em vez de colar token. Este botão pede só `ads_read`; o das Páginas de formulário é o "Conectar formulários" (seção abaixo).

- **App só no ambiente do servidor (EasyPanel):** `META_APP_ID` (novo) e `META_APP_SECRET` (o mesmo que o
  webhook já usa; é o mesmo app). Sem banco, sem campo em Admin. Sem uma das duas, o botão some e a tela diz
  qual variável falta. Mudou o ambiente? **Reimplante** para valer. Se alguém trocar o segredo do webhook pela
  tela Admin → Meta (que vence o `.env` no webhook), o login segue com o `META_APP_SECRET` do ambiente.
- **URL de retorno a cadastrar no app da Meta** (Login do Facebook → URIs de redirecionamento válidos):
  `https://comercial.aceleradelivery.com/api/v1/meta-ads/oauth/callback`
- **Fluxo:** `GET /api/v1/meta-ads/oauth/connect` (admin) → Facebook → `GET /api/v1/meta-ads/oauth/callback`
  (público no proxy; a identidade vem do `state` assinado + cookie de vínculo + nonce de uso único) → troca o
  `code` pelo token curto e este pelo de longa duração (~60 dias) → grava em `ad_insights_connections`
  (cifrado, `token_expires_at`, migration `acelera_0005`).
- **Renovação:** sob demanda, em `lerCredencialDeLeitura`: faltando menos de 7 dias, troca por um novo e grava.
  Sem cron. Token colado à mão (sem vencimento) nunca é renovado.
- Sem acesso avançado a `ads_read` no app, só entra quem tem função no app (admin/dev/testador).
- Arquivos: `lib/plataformas-de-anuncio/meta/login/*`, `app/api/v1/meta-ads/oauth/*`, e edições em
  `credenciais-de-leitura.ts`, `/app/settings/meta-ads`, `lib/env.ts` (2 variáveis opcionais), `public-paths.ts` (1 linha).

## Formulário nativo da Meta (lead do anúncio de formulário) — por empresa

**Regra do Davy: nada fixo da Acelera.** Qualquer empresa que entra pelo Acelera OS liga as próprias Páginas
do Facebook na tela **Configurações → Meta Ads → Formulários de anúncio**. O desenho antigo (variáveis
`ACELERA_LEADS_PAGE_TOKEN`, `ACELERA_LEADS_INBOUND_URL`, `ACELERA_LEADS_VERIFY_TOKEN`,
`ACELERA_LEADS_APP_SECRET`, o script `recuperar-leads-do-formulario.ts` e `lib/acelera/lead-ads.ts`) **foi
removido**. As variáveis `ACELERA_LEADS_*` de captação podem ser apagadas do EasyPanel.

**Base:** portada do upstream `v1.108.0` (PR #3768/#3838) — mesmos nomes em `lib/leads/lead-ads/*`
(`payload`, `assinatura`, `respostas-na-meta`, `entrada`) e a migration 9320 como `acelera_0009`. A tela e a
rota por `[token]` do upstream NÃO foram portadas (lá se cola o token da Página; aqui é login com o Facebook).

### Como a empresa liga
1. **Conectar formulários** (botão próprio, ao lado do "Conectar com o Facebook" de anúncios): mesmo login,
   mesma URL de retorno já cadastrada (`.../api/v1/meta-ads/oauth/callback`), mas pede `ads_read` +
   `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement` e
   `pages_manage_ads` (a Meta exige esta última para listar os formulários no "Trazer leads antigos")
   (`?para=formularios` no `connect`, propósito dentro do `state` assinado). É um botão à parte de propósito:
   enquanto a Meta não aprova essas permissões para todos, pedi-las no login de anúncios podia derrubar o que
   funciona. As permissões já concedidas acumulam no token. Para juntar num botão só depois da aprovação:
   `ESCOPO_DE_FORMULARIOS` em `lib/plataformas-de-anuncio/meta/login/oauth.ts`.
2. O bloco lista as Páginas da pessoa (`/me/accounts`). Para cada uma: funil + etapa de entrada, **Ligar esta
   Página**, **Verificar**, **Trazer leads antigos** (7/30/90 dias) e **Desligar**.
3. Ligar = o servidor lê o token da Página na Meta (nunca passa pelo navegador), inscreve a Página no app
   (`POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`) e grava uma fonte de captação por Página
   (`webhook_sources`: `meta_page_id`, `meta_page_token_encrypted` cifrado, `meta_lead_retrieval`). Uma
   Página pertence a UMA empresa (índice único); ligada em outra empresa, a tela recusa.
4. Erros da Meta viram frase em português que diz o que fazer (`lib/leads/lead-ads/erros-da-meta.ts`): acesso a
   leads (Lead Access Manager) não liberado, permissão ainda não aprovada, login vencido, sem poder na Página.

### Como o lead chega
- **Uma URL só para todas as empresas:** `POST /api/v1/webhooks/lead-ads`. A empresa dona vem da Página
  (`entry[].id` → `webhook_sources.meta_page_id`), nunca do corpo. Assinatura `x-hub-signature-256` com o
  segredo do app (`appDaMeta()`: o da tela Admin → Meta, senão `META_APP_SECRET`), em falha fechada e ANTES de
  qualquer leitura de banco. Página que ninguém ligou → 200 e só log. Lead que não entra (fonte pausada,
  Meta recusou a leitura) → 200 e uma linha em **Leads recebidos** com o motivo. Só falha NOSSA → 500 (a Meta
  reenvia; seguro, porque `leadgen_id` é único por empresa).
- O CRM lê o lead na Graph (token da Página no cabeçalho; com os **nomes** de campanha/conjunto/anúncio) e cria
  contato + card **direto** (`receber.ts` → `entrada.ts` → `createLeadHandler`), sem chamar a si mesmo por HTTP.
  As UTMs levam o nome (`utm_campaign`, `utm_adset`, `utm_ad`), os ids ficam em `meta_*_id`. Origem do card:
  `meta_ads`, tag `Meta_ads`.
- Diferença para a captação por site: este caminho NÃO classifica o lead nem autoriza a IA a falar primeiro
  (`authorize_ai_on_capture` fica como a fonte tiver, desligado por padrão) e não completa a ficha de um
  contato que já existia. Regras de automação por fonte funcionam (o card emite `lead.created`).

### O endereço no app da Meta (sem variável nova)
Na primeira Página ligada de qualquer empresa o CRM cadastra sozinho o webhook do objeto `page` no app
(`POST /{META_APP_ID}/subscriptions`, token do app `APP_ID|APP_SECRET` no cabeçalho): URL
`<NEXT_PUBLIC_APP_URL>/api/v1/webhooks/lead-ads`, campo `leadgen` e a **senha de verificação derivada** do
`META_APP_SECRET` (`lib/leads/lead-ads/verificacao.ts`: HMAC, 32 hex; o `GET` da rota recalcula e compara).
É idempotente. A Meta confere a URL na hora, então só funciona com o CRM implantado e acessível.
**Único passo manual, se a Meta recusar o cadastro:** painel do app → Webhooks → objeto **Página** → colar a
URL acima e a senha de verificação e assinar o campo `leadgen` (a tela da empresa avisa quando isso acontece).

### O que é preciso no EasyPanel / na Meta (uma vez)
- Variáveis já existentes: `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_APP_URL`, `INTERNAL_SECRET`. Nenhuma nova.
- Aplicar a migration `acelera_0009` (3 colunas em `webhook_sources`; também está no fim do `baseline.sql`).
- App da Meta com o produto **Webhooks** adicionado.
- **Acesso a leads** de cada Página (por empresa): Configurações do portfólio dono da Página → Integrações →
  Acesso a leads → a Página → CRMs → incluir o app. O Kommo pode continuar lá.
- Enquanto a Meta não aprovar `leads_retrieval` & cia. para todos (revisão do app, vídeo pendente), só quem tem
  função no app (administrador, desenvolvedor, testador) consegue ligar.
- Teste: developers.facebook.com/tools/lead-ads-testing (Página "Danilo gestor", `924300437422209`; app
  `723939443513987`): "Criar lead"; ele aparece no CRM e em "Leads recebidos". Apague o lead de teste.
- **`pages_manage_ads` é obrigatória** no login de formulários (confirmado em produção em 25/11: a Meta recusa
  listar os formulários com erro 200 citando essa permissão). Ela precisa estar no app da Meta (casos de uso /
  permissões) e entrar na revisão do app junto das outras. Quem conectou sem ela vê o aviso para reconectar.

### Aviso no WhatsApp do comercial (legado, transitório)
`ACELERA_LEADS_AVISO_URL` + `ACELERA_LEADS_AVISO_SECRET` (aviso pelo OS) continuam funcionando para o lead que
ENTRA agora (nunca para lead antigo importado). É de UMA instalação, não por empresa: foi mantido só para não
interromper o que já funciona. Substituto por empresa: regra de automação "lead novo" → "Mensagem para a equipe"
(número da tela de Avisos). Quando isso estiver provado em produção, apagar `lib/leads/lead-ads/aviso-do-os.ts`.

Arquivos: `lib/leads/lead-ads/*`, `app/api/v1/webhooks/lead-ads/route.ts`,
`app/api/v1/meta-ads/formularios/paginas/**`, `app/app/settings/meta-ads/_formularios.tsx`; edições em
`login/{estado,oauth}.ts`, `meta-ads/oauth/{connect,callback}/route.ts`, `lib/webhooks/captacao.ts` (3 motivos),
`lib/audit/actions.ts` (2 ações), `lib/database.types.ts`, `lib/i18n/*`.

## Editar etapas direto no quadro do funil

Para gerente ou acima, e nunca em funil arquivado (o mesmo corte do renomear que o upstream já tinha):

- **"+ Nova etapa"** no fim do quadro. A rota cria no fim do funil; logo depois a etapa é levada para antes das
  colunas de fechamento e perda (`depoisDeParaEtapaNova`). Se esse segundo passo falhar, ela fica no fim e um
  aviso diz para movê-la pelo menu.
- **Menu "⋯" da coluna:** mover para a esquerda/direita (`depois_de`), arquivar (pergunta para onde vão os
  negócios quando o servidor responde `precisa_destino`) e atalho para Configurações › Funis.
- Sem rota nem migration nova: usa `POST/PATCH/DELETE /api/v1/pipelines/:id/stages` e os hooks de
  `hooks/pipelines/useStages.ts`, que agora também releem o quadro (`chaveDoQuadro`).
- Arquivos: `components/kanban/MenuDaEtapaNoQuadro.tsx`, `components/kanban/NovaEtapaNoQuadro.tsx`,
  `lib/kanban/edicao-de-etapas.ts` (+ teste), e edições em `StageColumn.tsx`, `KanbanBoard.tsx`,
  `useStages.ts` e `lib/i18n/dicionario.ts` (15 frases em espanhol).
- No upstream, a 1.119 traz arrastar a coluna para reordenar. Ao atualizar, confira se este menu ainda faz
  sentido ou se vira só o "Arquivar".

## Resumo no card, ordem das colunas e período do funil

Tudo sem migration: o que precisa ser guardado vive em `pipeline.settings.fields` (jsonb) e na URL.

- **Resumo no card** (`components/kanban/ResumoNoCard.tsx`): "Chegou há Nd · Contato há Nd" (último contato = última
  mensagem da conversa mais recente do contato, em qualquer direção) e a próxima tarefa em aberto com a data
  (`lib/kanban/resumo-do-card.ts`; a rota do quadro passou a ler o `title` de `crm_tasks`).
- **"Mostrar no card"** por campo do funil (`no_card` em `customFieldSchema`, caixa no editor de campos). Só campo do
  NEGÓCIO e de tipo que cabe em uma linha; a rota anexa `campos_no_card` ao lead (`lib/kanban/campos-no-card.ts`).
  Empresa e cidade não são fixas: a empresa cria o campo e marca a caixa.
- **Ordenar** (`ordem` na URL, `lib/kanban/ordenacao.ts`): só apresentação, a `position_in_stage` não é tocada. Com
  ordem escolhida, arrastar dentro da coluna não reordena; para outra coluna move e o card entra no topo.
- **Período** (`de`/`ate` na URL, `lib/kanban/periodo.ts`): negócio criado OU que entrou na etapa atual no período
  (usa `stage_changed_at`, então só vale a ÚLTIMA mudança de etapa). A aba Lista avisa que os dois só valem no quadro.
- Edições em `filters.ts`, `FilterBar.tsx`, `KanbanBoard.tsx`, `KanbanCard.tsx`, `ListaDoFunil.tsx` e
  `lib/i18n/dicionario.ts`.

## Botões do comercial na conversa

No topo da conversa (no celular, no menu "Mais opções"): **+ Criar lead** (funil de Orçamentos, senão o padrão), **Disparar evento** (move o card para a etapa cuja regra envia o evento; o consumidor do `event_log` envia em até cerca de 1 minuto) e **Agendar mensagem** (tabela `mensagens_agendadas`, migration `acelera_0004`, cron `api/v1/cron/mensagens-agendadas` a cada minuto no scheduler; envia no máximo uma vez).

## 5. Análise › Funil do comercial

Página `/app/funil-de-vendas` (menu Análise, piso `manager`): funil padrão em quatro degraus —
leads novos, qualificados (o contato respondeu no WhatsApp), passaram por "Reunião marcada"
e fecharam (etapa `is_won`) —, com variação contra o período anterior de mesmo tamanho.
Dois modos: **criados no período** (coorte, onde estão hoje) e **movidos no período** (quem entrou
em cada degrau dentro do período). Cartões com o investido no Meta (conexão de leitura,
`ad_insights_connections`, conta padrão) e custo por lead/reunião/fechamento dos leads do Meta
(`source = meta_ads` ou webhook com utm/source_name `ig`/`facebook`). Sem migration.
Arquivos: `lib/reports/funil-de-vendas{,.test}.ts`, `lib/reports/ler-tudo{,.test}.ts`,
`app/api/v1/reports/funil-de-vendas/route.ts`, `hooks/reports/useFunilDeVendas.ts`,
`app/app/funil-de-vendas/`, 1 item em `lib/navigation/catalogo.ts`.
