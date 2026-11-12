# EMQ dos eventos do CRM na API de Conversões da Meta

## O que mudou

Os eventos de etapa (`Contact`, `Respondidos`, `Schedule`, `QualifiedLead`,
`InitiateCheckout`) e a compra (`Purchase`) que o CRM envia ao conjunto de
dados saíam só com `ph`. Agora o `user_data` leva tudo o que o CRM já sabe
da pessoa. A montagem fica em `lib/plataformas-de-anuncio/meta/user-data.ts`
e a leitura em `lib/conversoes/identidade-para-meta.ts`.

| Campo | Fonte | Forma |
|---|---|---|
| `ph` | `contacts.phone_number` | SHA-256 |
| `external_id` | telefone em dígitos com DDI (o mesmo do formulário do OS); sem telefone, `contacts.id` | SHA-256 |
| `em` | `contacts.email` | SHA-256 |
| `fn` / `ln` | `contacts.name`, senão `display_name` | SHA-256, sem acento, igual ao formulário do OS (o `ln` só sai quando há mais de um nome) |
| `ct` / `st` | `contacts.source_metadata.Cidade` / `Estado` | SHA-256 (estado vira sigla: `São Paulo` → `sp`) |
| `country` | DDI 55 do telefone | SHA-256 de `br` |
| `fbc` | 1º `custom_fields.meta_fbc` do negócio (cookie do formulário); 2º `fbclid` do link rastreável com a hora do clique; 3º `fbclid` da origem do contato | em claro, `fb.1.<ms>.<fbclid>` |
| `fbp`, `client_ip_address`, `client_user_agent` | 1º `custom_fields.meta_fbp` / `meta_ip` / `meta_user_agent` (formulário do OS); 2º o clique no link rastreável (`meta_ads_click_refs`, migration `acelera_0006`) | em claro |
| `ctwa_clid` + `page_id` (ou `whatsapp_business_account_id`) | clique-para-WhatsApp + tela Conversões | em claro, com `action_source=business_messaging` |

O `event_id` não muda (`<lead>:<evento>`), então a deduplicação continua igual.
Contato anonimizado (LGPD) sai sem nada além do que já saía. Se a leitura
falhar, o evento sai só com o telefone, como antes: ele nunca deixa de sair
por causa disso.

## Regras da produção que continuam valendo

- `Contact`, `Respondidos` e `Schedule` saem como `system_generated` mesmo com
  clique CTWA (a Meta recusa esses nomes em `business_messaging`), e por isso
  levam o `user_data` completo.
- No clique CTWA (`business_messaging`), o `user_data` continua só com
  `ctwa_clid`, a página e o telefone, como já era.
- O formulário (`custom_fields.meta_*`, e-mail, `lead_id` do Lead Ads) vence a
  leitura do contato e do link.
- Telefone sem o 55 ganha o DDI, no `ph` e no `external_id`.
- Vale o clique mais recente do link rastreável.

## Captura no link rastreável

As rotas `/api/v1/rastreio/[id]` e `/api/v1/anuncios/meta/[org]` agora guardam,
no clique da Meta, o IP, o user agent e o `fbp` (quando a página repassa o
cookie `_fbp` na URL como `fbp=` ou `_fbp=`). Nada muda na tela do formulário.
Se a migration ainda não estiver no banco, o clique é gravado sem esses campos,
e a atribuição não se perde.

## Como conferir depois do deploy (EasyPanel, manual)

1. Aplique a migration `supabase/migrations/20261112130000_acelera_0006_navegador_no_clique_do_link.sql`
   no projeto Supabase "CRM". São três colunas nulas e idempotentes. Depois
   faça o deploy da branch no serviço `crm` do projeto `comercial`. A ordem
   inversa também funciona, só não guarda o navegador até a migration entrar.
2. **Teste sem sujar a produção:** em Configurações › Conversões, preencha o
   *código de evento de teste* que aparece no Gestor de Eventos › conjunto
   `991921003166325` › **Testar eventos**. Mova um negócio de teste (que tenha
   vindo de anúncio) de etapa. O evento aparece em *Testar eventos*. Abra-o e
   confira, em *Parâmetros de correspondência*, se vieram `external_id`, `fn`,
   `ct`, `st`, `country` (e `fbc`, `fbp`, IP e navegador quando o lead veio do
   formulário ou do link rastreável). **Apague o código de teste ao terminar**, senão os eventos reais
   também vão para o modo de teste.
3. **EMQ real:** Gestor de Eventos › conjunto › aba **Visão geral** › clique no
   evento (`Schedule`, `Contact`…) › **Qualidade da correspondência de
   eventos**. A nota é recalculada sobre as últimas 48 h de eventos. Conte uns
   2 dias depois do deploy para ela refletir só eventos novos. A mesma tela
   lista, por parâmetro, a porcentagem de eventos que o trouxeram.
4. Pelo CRM, a tabela `ad_conversion_dispatches` (`event_name like
   'MetaEtapa:%'`, `status`) mostra se os envios seguem `sent`.

## O que esperar, honestamente

Medido no banco em 12/11/2026: os 500 contatos têm nome; 305 têm cidade (que
vieram da importação e não necessariamente são os que viram evento); **nenhum**
tem e-mail; só **1** negócio tem `meta_fbc`/`meta_fbp`/IP/navegador do
formulário; só **1** clique de link rastreável foi casado com contato. Então,
para os leads que chegam direto pelo WhatsApp, o ganho imediato vem de
`external_id`, `fn`, `country` e (quando houver) `ct`/`st`. O salto grande,
para perto do 7,8 do formulário, depende de o `fbc`, o IP e o navegador chegarem
junto com o lead. Veja o que falta abaixo.

## Decisão pendente: retenção de IP e navegador

O IP, o navegador e o `fbp` ficam guardados em `meta_ads_click_refs` para todo
clique, sem prazo. A Meta só aceita evento de até 7 dias, então guardar mais que
isso não melhora a correspondência. A proposta é apagar esses três campos depois
de 30 dias, deixando o clique e as UTMs, e também quando o contato for
anonimizado. Isso fica para o Danilo decidir; não foi implementado.

## O que ainda falta para a EMQ alta

- **E-mail no contato:** nenhum contato tem e-mail hoje. Se o formulário pedir
  o e-mail e ele for gravado em `contacts.email`, o campo passa a sair sozinho.
- **O LeadSubmitted do clique CTWA** (`meta_ctwa_click_dispatches`) existe no
  banco de produção, mas o código que o envia não está neste repositório. Ele
  não foi alterado aqui.
