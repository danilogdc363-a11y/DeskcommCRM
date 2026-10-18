# ACELERA.md — o que este fork muda

Fork de `melgarafael/DeskcommCRM` (MIT) usado como **CRM comercial** pelo Acelera OS
(`comercial.aceleradelivery.com`). Tudo que é só nosso está listado aqui.

**Branch canônica: `acelera/1.84.0`** = tag `v1.84.0` do upstream (a versão que roda em
produção) + os commits do fork. `feat/acelera-sso-aparencia` tem os mesmos commits sobre o
`main` do fork (base mais nova, ~v1.85+) e serve só para quando decidirmos atualizar.

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
  `acelera/marca/`. Exportar: logo `acelera/marca/acelera-horizontal.svg` → PNG ~96 px de altura, transparente;
  ícone `acelera/marca/acelera-icone.svg` → PNG 512×512.
- E-mails de acesso (GoTrue) leem o `.env`: depois de mudar `APP_ACCENT_HEX`, rodar
  `bash hostgator-setup-kit/marca-emails.sh` (ou ajustar os templates no Supabase do CRM).

## 3. Rodar no EasyPanel a partir deste fork

O compose versionado é **`docker-compose.easypanel.yml`** (raiz do repo, branch `acelera/1.84.0`):
`app`, `worker` e `scheduler` são **construídos** daqui (`Dockerfile`, `Dockerfile.worker`,
`Dockerfile.scheduler`); `waha`, `redis` e `srh` ficam nas imagens pinadas; sem `caddy` (o HTTPS é
do EasyPanel).

- No EasyPanel: serviço **Compose** → Fonte **Git** → repositório
  `https://github.com/danilogdc363-a11y/DeskcommCRM`, branch `acelera/1.84.0`, arquivo
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

Alterados (poucas linhas, marcadas com `ACELERA (fork)`):
- `lib/auth/public-paths.ts` — 1 linha: `/^\/sso$/`
- `proxy.ts` — 1 import + 2 blocos curtos (login próprio desligado)

Dependências do core usadas (se mudarem no upstream, revisar): `respostaDePonte`,
`marcaDaSaida`, `slugDoProvisionamento`, `audit`, `createAdminClient`, `createClient`,
`cookieSecure`, o cookie `active_org` e o marcador `settings.provisioning`.

Para atualizar: criar `acelera/<nova versão>` a partir da tag nova e `git cherry-pick` os commits
do fork; conflito só pode aparecer nos dois arquivos alterados.
