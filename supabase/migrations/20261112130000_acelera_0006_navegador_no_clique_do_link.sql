-- manifest: guarda IP, navegador e fbp de quem clicou no link rastreável da Meta (meta_ads_click_refs), para os eventos da API de Conversões casarem melhor (EMQ)
--
-- O link rastreável (`/api/v1/rastreio/[id]` e `/api/v1/anuncios/meta/[org]`)
-- é a única hora em que o CRM vê o navegador de quem veio do anúncio: depois a
-- pessoa vai para o WhatsApp. A Meta usa IP, user agent e `fbp` para achar a
-- pessoa (qualidade de correspondência). Colunas nulas: clique antigo e clique
-- sem esses dados seguem válidos. Idempotente.
--
-- LGPD: IP e navegador são dado pessoal. Só saem para a Meta junto de um
-- evento do contato casado, e o contato anonimizado não sai identificado
-- (`lib/conversoes/identidade-para-meta.ts`).

alter table public.meta_ads_click_refs add column if not exists client_ip_address text;
alter table public.meta_ads_click_refs add column if not exists client_user_agent text;
alter table public.meta_ads_click_refs add column if not exists fbp text;

comment on column public.meta_ads_click_refs.client_ip_address is
  'IP de quem clicou no link (acelera_0006). Vai à Meta como client_ip_address.';
comment on column public.meta_ads_click_refs.client_user_agent is
  'User agent de quem clicou no link (acelera_0006). Vai à Meta como client_user_agent.';
comment on column public.meta_ads_click_refs.fbp is
  'Cookie _fbp repassado pela página na query (acelera_0006). Vai à Meta como fbp.';
