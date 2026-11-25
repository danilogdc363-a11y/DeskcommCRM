-- manifest: (Acelera) Formulário da Meta por empresa. `webhook_sources` ganha a PÁGINA da Meta que a fonte representa (`meta_page_id`, roteia o lead por page_id), o token da Página CIFRADO (`meta_page_token_encrypted`) e a opção de buscar as respostas na Graph (`meta_lead_retrieval`). Mesmo conteúdo da migration 9320 do upstream (v1.108.0, PR #3768), idempotente: num upgrade futuro ela só reaplica sem efeito. As três colunas só mudam pelo servidor.

-- ═══ POR QUE ESTAS TRÊS COLUNAS ═════════════════════════════════════════════
--
-- O aviso de formulário preenchido da Meta traz o `leadgen_id` e os ids de
-- página/formulário/anúncio. Nome, telefone e respostas só existem atrás de uma
-- chamada à Graph com o token da PÁGINA. Cada empresa liga as próprias Páginas
-- (login com o Facebook na tela Meta Ads) e o CRM guarda o token de cada uma,
-- cifrado, na fonte de captação dessa Página — que já é dona do funil e da etapa
-- de entrada. Uma Página pertence a UMA empresa (índice único abaixo): o aviso
-- chega numa URL só e o CRM escolhe a empresa pelo `entry[].id`.
--
-- O token é cifrado por `fn_encrypt_oauth` (mesma chave de `secret_encrypted`).
-- Escrita só pelo servidor (gatilho abaixo); a leitura nunca devolve o valor.

alter table public.webhook_sources
  add column if not exists meta_page_id text;

alter table public.webhook_sources
  add column if not exists meta_page_token_encrypted bytea;

alter table public.webhook_sources
  add column if not exists meta_lead_retrieval boolean not null default false;

comment on column public.webhook_sources.meta_page_id is
  'A página da Meta que esta fonte representa. Chave de ROTEAMENTO do aviso de formulário (entry[].id): a mesma URL recebe leads de todas as páginas e quem é dono do lead é esta coluna. NULL = a fonte não reivindica página.';

comment on column public.webhook_sources.meta_page_token_encrypted is
  'Token de PÁGINA com permissão de leitura de leads, cifrado por fn_encrypt_oauth. Write-only: nenhuma leitura da API o devolve. Nunca gravado em claro.';

comment on column public.webhook_sources.meta_lead_retrieval is
  'Quando o aviso chega sem as respostas (é o que a Meta manda), buscar as respostas na Graph com o token da página. Ligado pelo servidor ao conectar a Página.';

create unique index if not exists uniq_webhook_sources_meta_page
  on public.webhook_sources (meta_page_id)
  where meta_page_id is not null;

-- A página, o token e a busca só mudam pelo SERVIDOR. A policy
-- `webhook_sources_manager_write` deixa o manager escrever a linha inteira pela
-- sessão, e a página decide para qual empresa vai o lead: gravada sem a
-- conferência da rota, desviaria avisos de quem é dono. Pela sessão
-- (`authenticated`/`anon`) estas colunas não nascem preenchidas nem mudam.
create or replace function public.fn_fonte_do_lead_ads_so_pelo_servidor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.meta_page_id is not null or new.meta_page_token_encrypted is not null
       or coalesce(new.meta_lead_retrieval, false) then
      raise exception 'webhook_source_meta_server_only' using errcode = '42501';
    end if;
  elsif row(new.meta_page_id, new.meta_page_token_encrypted, new.meta_lead_retrieval)
        is distinct from row(old.meta_page_id, old.meta_page_token_encrypted, old.meta_lead_retrieval) then
    raise exception 'webhook_source_meta_server_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_fonte_do_lead_ads_so_pelo_servidor() from public, anon;

do $fonte_do_lead_ads$
begin
  drop trigger if exists trg_fonte_do_lead_ads_so_pelo_servidor on public.webhook_sources;
  create trigger trg_fonte_do_lead_ads_so_pelo_servidor
    before insert or update on public.webhook_sources
    for each row execute function public.fn_fonte_do_lead_ads_so_pelo_servidor();
end $fonte_do_lead_ads$;

notify pgrst, 'reload schema';
