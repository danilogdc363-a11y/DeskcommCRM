-- manifest: (Acelera) Venda parada por falta de valor sai sozinha quando o valor do negócio é preenchido depois do fechamento: gatilho em `crm_leads.value_cents` pede o reenvio da compra pela `fn_solicitar_reenvio_conversao`.
--
-- O caso real (18/11/2026): negócio marcado como ganho às 13:19 com o valor em
-- branco. A compra virou pendência `sem_valor`, o valor foi preenchido às 19:42,
-- ninguém clicou em reprocessar, e a venda passou dos 7 dias que a Meta aceita.
--
-- POR QUE GATILHO NO BANCO, e não escutar `lead.updated` no envio da venda:
--   1. `lead.updated` é REGISTRO: está na lista da `fn_event_log_e_registro`,
--      nasce `done` e o drain nunca o seleciona. Um handler assinado nele nunca
--      rodaria (medido no CI do PR 47: `evento-de-fato-nao-fica-pendente`);
--   2. tirá-lo da lista acordaria TODA edição de negócio como evento pendente,
--      para servir a um caso raro (o mesmo motivo da acelera_0001);
--   3. o gatilho cobre todo caminho que grava o valor (ficha, importação,
--      proposta, automação), não só a rota que emite `lead.updated`.
--
-- Nada muda no aplicativo: o `ad_conversion.retry_requested` que a função emite
-- já é consumido pelo envio da venda. Idempotente; sem BEGIN/COMMIT.
-- Espelho no `baseline.sql`: a função junto das funções da Acelera (antes da
-- varredura de anon) e o gatilho no apêndice (bloco "acelera_0012").

create or replace function public.fn_valor_preenchido_reenvia_a_venda()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  -- Só a venda que parou POR FALTA DE VALOR. Venda recusada pela plataforma, ou
  -- negócio que nunca gerou envio, não é reenviada por uma edição: para isso
  -- existe o botão de reprocessar.
  if exists (
    select 1 from public.ad_conversion_dispatches d
     where d.organization_id = new.organization_id
       and d.lead_id = new.id
       and d.event_name = 'Purchase'
       and d.status = 'skipped'
       and d.reason = 'sem_valor'
  ) then
    -- A mesma porta do botão: confere ganho, recusa pedido repetido na fila e
    -- emite `ad_conversion.retry_requested`, que o envio da venda já consome.
    perform public.fn_solicitar_reenvio_conversao(new.organization_id, new.id, 'Purchase');
  end if;
  return new;
exception when others then
  -- Preencher o valor do negócio NUNCA falha por causa de conversão: a venda
  -- continua pendente na tela de Conversões e o botão segue valendo.
  raise warning 'fn_valor_preenchido_reenvia_a_venda: % (negocio %)', sqlerrm, new.id;
  return new;
end$fn$;

comment on function public.fn_valor_preenchido_reenvia_a_venda() is
  'Acelera: quando o valor de um negócio ganho é preenchido depois do fechamento e a venda está pendente por `sem_valor`, pede o reenvio da compra (mesma porta do botão de reprocessar).';

revoke execute on function public.fn_valor_preenchido_reenvia_a_venda() from public, anon, authenticated;
grant execute on function public.fn_valor_preenchido_reenvia_a_venda() to service_role;

drop trigger if exists trg_valor_preenchido_reenvia_a_venda on public.crm_leads;
create trigger trg_valor_preenchido_reenvia_a_venda
  after update of value_cents on public.crm_leads
  for each row
  when (new.status = 'won'
        and new.value_cents > 0
        and coalesce(old.value_cents, 0) <= 0)
  execute function public.fn_valor_preenchido_reenvia_a_venda();

notify pgrst, 'reload schema';
