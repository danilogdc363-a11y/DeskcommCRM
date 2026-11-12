-- manifest: **(Acelera) A fala HUMANA da equipe vira gatilho de automação: `message.team_sent`.** O `message.sent` que já existe é registro (nasce `done` pela `fn_event_log_e_registro`, sem consumidor) e cobre IA e automação; e o `trg_messages_emit_event` é AFTER INSERT, então a mensagem que o Inbox grava como `sending` nem chega a emitir `message.sent`. Gatilho NOVO em `messages`, sem tocar em função existente: `fn_mensagem_da_equipe_vira_evento` emite `message.team_sent` (fora da lista de registro → nasce `pending` e o `automationRulesHandler` o consome) com o mesmo payload do `fn_emit_message_event` (inclui `body_preview`). O `when` é o recorte da 0686 — `direction = 'outbound'`, `sent_via in ('user','crm','external_device')`, `type not in ('reaction','system')`, sem `metadata.historico_importado` — e o corpo descarta conversa de grupo, como a 0482. Uso: a frase-código do vendedor move o card (ex.: "Parabéns pela sua decisão" → Fechou → Purchase na Meta).

-- ---- a mensagem da equipe vira gatilho (migration acelera_0001) ----
-- POR QUE NÃO O `message.sent`:
--   1. é REGISTRO: `fn_event_log_marca_registro` o grava `done` e o drain nunca
--      o seleciona — tirá-lo da lista acordaria todo envio de IA, automação e
--      campanha como evento pendente;
--   2. cobre IA e automação: uma regra "mensagem enviada contém X" casaria com o
--      texto que OUTRA automação mandou (laço entre regras);
--   3. o Inbox grava a linha como `sending` e o gatilho é AFTER INSERT: a fala
--      digitada no CRM emitiria `message.sending`, nunca `message.sent`.
-- Por isso um evento próprio, com o recorte de "humano" que o produto já usa na
-- 0686 (Inbox do CRM e celular conectado).
create or replace function public.fn_mensagem_da_equipe_vira_evento()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  -- Grupo não é atendimento de um contato (mesma regra da 0482).
  if exists (select 1 from public.conversations c
             where c.id = new.conversation_id
               and c.organization_id = new.organization_id
               and c.is_group) then
    return new;
  end if;

  perform public.fn_log_event(
    new.organization_id, 'message.team_sent',
    jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id,
      'contact_id', new.contact_id, 'direction', new.direction,
      'type', new.type, 'status', new.status, 'external_id', new.external_id,
      'channel_session_id', new.channel_session_id, 'sent_via', new.sent_via,
      'sent_by_user_id', new.sent_by_user_id,
      'body_preview', "left"(new.body, 280)
    )
  );
  return new;
end$fn$;

comment on function public.fn_mensagem_da_equipe_vira_evento() is
  'Acelera: emite `message.team_sent` para a fala humana de saída (sent_via user/crm/external_device, sem reação/sistema/grupo/histórico importado). É o gatilho "quando a equipe enviar mensagem" das automações — a frase-código do vendedor move o card.';

revoke execute on function public.fn_mensagem_da_equipe_vira_evento() from public, anon, authenticated;
grant execute on function public.fn_mensagem_da_equipe_vira_evento() to service_role;

drop trigger if exists trg_mensagem_da_equipe_vira_evento on public.messages;
create trigger trg_mensagem_da_equipe_vira_evento
  after insert on public.messages
  for each row
  when (new.direction = 'outbound'
        and new.sent_via in ('user', 'crm', 'external_device')
        and new.type not in ('reaction', 'system')
        and coalesce(new.metadata ->> 'historico_importado', '') <> 'true')
  execute function public.fn_mensagem_da_equipe_vira_evento();

notify pgrst, 'reload schema';
