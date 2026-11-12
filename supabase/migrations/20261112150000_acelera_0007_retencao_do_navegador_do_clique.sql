-- manifest: apaga IP, user agent e fbp do clique no link rastreável depois de 30 dias (cron data-retention) e na anonimização do contato; o clique e as UTMs ficam
--
-- Decisão do Danilo (12/11/2026): "pode apagar depois de 30 dias". A Meta só
-- aceita evento de até 7 dias, então guardar o navegador por mais tempo não
-- melhora a correspondência — só acumula dado pessoal.
--
-- Duas portas:
--  1. `fn_limpar_navegador_dos_cliques`, em lotes, chamada pelo cron diário
--     `data-retention`. Piso de 30 dias NO CORPO: quem chama não consegue
--     limpar antes. Só zera as três colunas — não apaga linha, não escolhe
--     linha (único predicado é a idade).
--  2. Gatilho em `contacts`: o contato anonimizado (LGPD) perde na hora o
--     navegador de todos os cliques dele. Gatilho sem HTTP, só UPDATE local.
-- Idempotente.

create or replace function public.fn_limpar_navegador_dos_cliques(
  p_retencao_dias integer,
  p_limite integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dias integer := greatest(coalesce(p_retencao_dias, 30), 30);
  v_limite integer := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_n integer;
begin
  with alvo as (
    select id
      from public.meta_ads_click_refs
     where created_at < now() - make_interval(days => v_dias)
       and (client_ip_address is not null or client_user_agent is not null or fbp is not null)
     limit v_limite
     for update skip locked
  )
  update public.meta_ads_click_refs r
     set client_ip_address = null, client_user_agent = null, fbp = null
    from alvo
   where r.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.fn_limpar_navegador_dos_cliques(integer, integer) from public, anon, authenticated;
grant execute on function public.fn_limpar_navegador_dos_cliques(integer, integer) to service_role;

create or replace function public.fn_limpar_navegador_de_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meta_ads_click_refs
     set client_ip_address = null, client_user_agent = null, fbp = null
   where organization_id = new.organization_id
     and contact_id = new.id
     and (client_ip_address is not null or client_user_agent is not null or fbp is not null);
  return new;
end;
$$;

revoke execute on function public.fn_limpar_navegador_de_contato_anonimizado() from public, anon, authenticated;

drop trigger if exists trg_limpar_navegador_de_contato_anonimizado on public.contacts;
create trigger trg_limpar_navegador_de_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized and not coalesce(old.is_anonymized, false))
  execute function public.fn_limpar_navegador_de_contato_anonimizado();

notify pgrst, 'reload schema';
