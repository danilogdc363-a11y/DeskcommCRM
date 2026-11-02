-- manifest: **(Acelera) Mensagem de histórico importado não é atendimento.** `fn_emit_message_event`, a demanda, a trava de atendimento e a revisão de contexto reagiam a qualquer INSERT em `messages`: um inbound antigo importado viraria `message.received`, moveria card e geraria evento na Meta. Os quatro gatilhos ganham a mesma condição dos gatilhos da 0686 e da acelera_0001, `metadata.historico_importado <> 'true'`. Nenhuma função muda.

-- ---- histórico importado não é atendimento (migration acelera_0003) ----
drop trigger if exists trg_messages_emit_event on public.messages;
create trigger trg_messages_emit_event
  after insert on public.messages
  for each row
  when (coalesce(new.metadata ->> 'historico_importado', '') <> 'true')
  execute function public.fn_emit_message_event();

drop trigger if exists trg_demanda_abre_no_inbound on public.messages;
create trigger trg_demanda_abre_no_inbound
  after insert on public.messages
  for each row
  when (coalesce(new.metadata ->> 'historico_importado', '') <> 'true')
  execute function public.fn_demanda_abre_no_inbound();

drop trigger if exists trg_message_service_lock on public.messages;
create trigger trg_message_service_lock
  before insert on public.messages
  for each row
  when (coalesce(new.metadata ->> 'historico_importado', '') <> 'true')
  execute function public.fn_message_service_lock();

drop trigger if exists trg_reply_inbound_revision on public.messages;
create trigger trg_reply_inbound_revision
  after insert on public.messages
  for each row
  when (coalesce(new.metadata ->> 'historico_importado', '') <> 'true')
  execute function public.fn_reply_inbound_revision();

notify pgrst, 'reload schema';
