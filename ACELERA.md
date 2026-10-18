# ACELERA.md — o que este fork muda

Fork de `melgarafael/DeskcommCRM` (MIT) usado como **CRM comercial da Acelera Delivery**
(`comercial.aceleradelivery.com`). Tudo que é só da Acelera está listado aqui, para
facilitar puxar atualizações do upstream.

## 1. Login único com o Acelera OS

O **Acelera OS é o dono da identidade**. Os bancos continuam separados: o CRM tem o
próprio Supabase e os próprios usuários; o OS só prova "quem é" com um passe assinado.

### Fluxo

1. No OS, a pessoa clica em **CRM comercial** na barra lateral (só aparece para dono/admin
   do workspace configurado e para membros liberados por e-mail).
2. O OS (`/app/<org>/crm-comercial`) assina um passe de 60 s
   `crm1.<payload>.<HMAC-SHA256>` com `{ sub, email, name, role, org, aud, exp, nonce }`
   e redireciona para `https://<crm>/sso?pass=...`.
3. O CRM (`app/sso/route.ts`) confere prefixo, assinatura, `aud`, validade e nonce
   (uso único, em memória).
4. Acha ou cria o usuário no Supabase do CRM **pelo e-mail** (`auth.admin.createUser`
   com e-mail já confirmado; se já existe, usa o existente).
5. Garante o vínculo em `user_organizations` na organização `ACELERA_SSO_ORG_ID`:
   dono/admin do OS → `admin`; membro → `ACELERA_SSO_MEMBER_ROLE` (padrão `agent`).
   Vínculo **revogado** no CRM continua revogado (o passe não reabre a porta).
6. Abre a sessão pelo mecanismo nativo do GoTrue: `auth.admin.generateLink({ type: "magiclink" })`
   (só no servidor — nenhum e-mail é enviado) + `auth.verifyOtp({ token_hash })`, o mesmo
   `verifyOtp` que `/auth/confirm` usa; ele grava o cookie `sb-deskcomm-auth`.
7. Segue para `/app` pela ponte same-origin (`respostaDePonte`), porque o cookie é
   `SameSite=Strict` e a chegada veio de outro site (mesmo motivo da issue #1646).

Quem tem MFA ligado no CRM continua passando pelo segundo fator do próprio CRM.

### Variáveis (no `.env` do compose do CRM, no EasyPanel)

| Variável | Exemplo | Para quê |
|---|---|---|
| `ACELERA_SSO_SECRET` | 64+ caracteres aleatórios | Mesma chave que `CRM_SSO_SECRET` no OS. Sem ela, `/sso` responde 404. |
| `ACELERA_SSO_ORG_ID` | uuid da organização no CRM | Onde quem entra pelo OS ganha vínculo. Sem ela, `/sso` responde 404. |
| `ACELERA_SSO_MEMBER_ROLE` | `agent` | Papel de quem é *membro* no OS (`viewer`/`agent`/`manager`/`admin`). |
| `ACELERA_SSO_ONLY` | `true` | Desliga a tela de login/cadastro própria. |
| `ACELERA_OS_LOGIN_URL` | `https://os.aceleradelivery.com/login` | Para onde vai quem chega sem sessão (com `ACELERA_SSO_ONLY=true`) e quem chega com passe inválido. |

**Saída de emergência:** com `ACELERA_SSO_ONLY=true`, `/login?acesso_local=1` ainda mostra
o login por senha (para o admin da instalação, se o OS estiver fora do ar).
`/login/mfa`, `/login/reset`, `/login/recovery`, `/login/forgot` e `/login/continuar`
continuam abertos.

### Quem já tinha conta no CRM

Casa **pelo e-mail**. A conta existente é reaproveitada (mesmo id, mesmos dados, mesma senha,
que continua valendo só via `?acesso_local=1`). Se ela já tinha vínculo na organização da
Acelera, o papel é **realinhado** ao do OS a cada entrada (dono/admin → `admin`). Se o e-mail
do OS for diferente do e-mail da conta no CRM, nasce uma conta nova — alinhe os e-mails antes.

### Limites conhecidos

- Anti-replay em memória: vale para uma réplica do serviço `app`. Reiniciar o container
  dentro dos 60 s de vida de um passe, ou rodar 2+ réplicas, abre uma janela pequena de
  replay. Trocar por Redis/tabela se isso mudar.
- O passe vai na URL (não há como evitar num redirect entre domínios): vale 60 s, é de uso
  único e as respostas saem com `no-store` e `Referrer-Policy: no-referrer`.

## 2. Aparência Acelera — por configuração, sem mexer em componente

O CRM já tem white-label nativo (`docs/white-label.md`). **Não editamos tela nenhuma.**

- `.env` (semente): `APP_NAME=Acelera CRM`, `APP_ACCENT_HEX=#FF7300`.
  Só vale na primeira leitura — depois **o banco manda**. Numa instalação que já existe,
  aplique pela tela **`/admin/marca`**: nome do sistema, cor `#FF7300`, logo e ícone.
- Logo e ícone: a tela aceita **PNG ou JPG até 512 KB** (SVG é recusado de propósito).
  Os originais vetoriais estão em `acelera/marca/` (horizontal, vertical, selo, ícone; versões
  branca para fundo escuro). Exportar:
  - logo: `acelera-horizontal.svg` → PNG com ~96 px de altura, fundo transparente;
  - ícone do app/favicon: `acelera-icone.svg` → PNG 512×512 quadrado.
- E-mails de acesso (GoTrue) leem o `.env`: depois de mudar `APP_ACCENT_HEX`, rodar
  `bash hostgator-setup-kit/marca-emails.sh` (ou ajustar os templates no Supabase do CRM).

## 3. Arquivos do fork (para conferir num merge do upstream)

Novos (não conflitam):
- `ACELERA.md`, `acelera/marca/*.svg`
- `lib/acelera-sso/pass.ts`, `lib/acelera-sso/config.ts`
- `app/sso/route.ts`
- `tests/unit/acelera-sso-pass.test.ts`

Alterados (poucas linhas, marcadas com `ACELERA (fork)`):
- `lib/auth/public-paths.ts` — 1 linha: `/^\/sso$/`
- `proxy.ts` — 1 import + 2 blocos curtos (login próprio desligado)

Para puxar o upstream: `git fetch upstream && git merge upstream/main`; se der conflito,
só pode ser nesses dois arquivos — reaplique os blocos marcados.
