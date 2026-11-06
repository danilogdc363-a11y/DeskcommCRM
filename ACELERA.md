# ACELERA.md — o que este fork muda

Fork de `melgarafael/DeskcommCRM` (MIT) usado como **CRM comercial** pelo Acelera OS
(`comercial.aceleradelivery.com`). Tudo que é só nosso está listado aqui.

**Branch canônica: `acelera/1.100.0`** = tag `v1.100.0` do upstream + os commits do fork
(feita a partir de `acelera/1.98.9` com merge de `acelera/1.84.0` e da `v1.100.0`).
A `acelera/1.84.0` (tag `acelera-pre-1.100`) é a produção anterior e serve de rollback de código.
As migrations `acelera_0001..0004` estão no fim do `supabase/baseline.sql`, depois dos blocos do upstream.

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
  `acelera/marca/`; os PNGs prontos para subir estão em `acelera/marca/png/` (`logo-claro.png`,
  `logo-escuro.png`, `icone.png`).
- **Identidade Acelera:** `app/acelera-tema.css` traz a paleta do guia de marca (laranja #FF7300 e
  cinzas neutros), cantos de 5 a 10 px, Inter no texto e Anton em caixa alta no `h1`, com o risco à
  mão em laranja sob o título. Ele também vence a cor de `/admin/marca` e de **Configurações → Marca**
  (as duas telas derivam o laranja por contraste e dão marrom), então a cor salva nelas não muda nada.
- **Logo:** cadastre o par em **Configurações → Marca** (`logo-claro.png` e `logo-escuro.png`). Sem o logo
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

Usa o MESMO app da Meta do WhatsApp oficial, em vez de colar token. Escopo só `ads_read`.

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

## Botões do comercial na conversa

No topo da conversa (no celular, no menu "Mais opções"): **+ Criar lead** (funil de Orçamentos, senão o padrão), **Disparar evento** (move o card para a etapa cuja regra envia o evento; o consumidor do `event_log` envia em até cerca de 1 minuto) e **Agendar mensagem** (tabela `mensagens_agendadas`, migration `acelera_0004`, cron `api/v1/cron/mensagens-agendadas` a cada minuto no scheduler; envia no máximo uma vez).
