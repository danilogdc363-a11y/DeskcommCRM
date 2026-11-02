-- manifest: **(Acelera) Mensagem agendada por conversa.** Tabela `mensagens_agendadas` com RLS por organização: quem atende cria e cancela (só linha pendente, e só vira `cancelada`); quem envia é o cron `mensagens-agendadas`, com service role. A trava contra envio duplo é o UPDATE condicional `pendente → enviando`; o id da linha também é o id da mensagem, então a chave primária de `messages` é a segunda defesa.

create table if not exists public.mensagens_agendadas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  corpo text not null check (char_length(corpo) between 1 and 4096),
  enviar_em timestamptz not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'enviando', 'enviada', 'falhou', 'cancelada')),
  motivo_falha text,
  message_id uuid,
  criado_por uuid not null references auth.users(id),
  cancelado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  travada_em timestamptz,
  concluida_em timestamptz
);

-- A varredura do relógio: só o que ainda vai sair.
create index if not exists mensagens_agendadas_vencidas_idx
  on public.mensagens_agendadas (enviar_em) where status = 'pendente';
create index if not exists mensagens_agendadas_travadas_idx
  on public.mensagens_agendadas (travada_em) where status = 'enviando';
create index if not exists mensagens_agendadas_da_conversa_idx
  on public.mensagens_agendadas (organization_id, conversation_id, enviar_em);

alter table public.mensagens_agendadas enable row level security;

drop policy if exists mensagens_agendadas_select on public.mensagens_agendadas;
create policy mensagens_agendadas_select on public.mensagens_agendadas
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

-- A conversa precisa ser da mesma organização: a FK sozinha não garante isso.
drop policy if exists mensagens_agendadas_insert on public.mensagens_agendadas;
create policy mensagens_agendadas_insert on public.mensagens_agendadas
  for insert to authenticated
  with check (
    organization_id in (select public.fn_user_org_ids())
    and criado_por = auth.uid()
    and status = 'pendente'
    and exists (
      select 1 from public.conversations c
       where c.id = conversation_id and c.organization_id = mensagens_agendadas.organization_id
    )
  );

-- A tela só cancela. Linha que o relógio já pegou não volta atrás.
drop policy if exists mensagens_agendadas_cancelar on public.mensagens_agendadas;
create policy mensagens_agendadas_cancelar on public.mensagens_agendadas
  for update to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and status = 'pendente')
  with check (organization_id in (select public.fn_user_org_ids()) and status = 'cancelada');

revoke all on public.mensagens_agendadas from anon, authenticated;
grant select on public.mensagens_agendadas to authenticated;
grant insert (organization_id, conversation_id, corpo, enviar_em, criado_por)
  on public.mensagens_agendadas to authenticated;
grant update (status, cancelado_por, concluida_em) on public.mensagens_agendadas to authenticated;
grant all on public.mensagens_agendadas to service_role;

notify pgrst, 'reload schema';
