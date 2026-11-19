-- manifest: "Unificar fichas" de negócio — fn_mesclar_negocios junta 2+ negócios num principal (FKs pelo catálogo, contatos diferentes via fn_mesclar_contatos), com prévia, lápide merged_into_lead_id e rastro de quem/quando
--
-- Pedido do Danilo (19/11/2026): o mesmo lead virou três cards no funil
-- Orçamento (@bizziopizza + dois "Jeferson"). Juntar CONTATOS já existia
-- (`fn_mesclar_contatos`, 0215); juntar NEGÓCIOS não.
--
-- Mesmas regras da 0215, de propósito:
--  * piso `manager`, conferido aqui dentro (auth.uid() da sessão do usuário);
--  * repontamento de FK DERIVADO de `pg_constraint` a cada execução — a tabela
--    criada amanhã apontando para `crm_leads` já entra;
--  * colisão de índice único vira repontamento linha a linha, e o que sobrar
--    continua apontando para a lápide (que existe), nunca fica órfão;
--  * o principal MANDA: campo, tag e metadado dos absorvidos só preenchem o que
--    o principal não tem;
--  * o absorvido NÃO é apagado. Vira lápide: `merged_into_lead_id`,
--    `merged_at`, `merged_by_user_id`, e vai para a etapa de perda do funil dele
--    com motivo `other` (sem etapa de perda, fica onde está — a lápide basta).
--  * tudo numa transação só (a própria chamada da função).
--
-- Negócios de CONTATOS diferentes: os contatos são juntados primeiro, pela
-- `fn_mesclar_contatos`, no contato do principal. Assim mensagens do WhatsApp,
-- tarefas e conversa vão junto — elas moram no contato, não no negócio.
--
-- `p_previa = true` não escreve nada: devolve o que SERIA movido, para a tela
-- mostrar antes do "Confirmar".

alter table public.crm_leads
  add column if not exists merged_into_lead_id uuid
    references public.crm_leads(id) on delete set null,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by_user_id uuid;

create index if not exists idx_crm_leads_merged_into
  on public.crm_leads (merged_into_lead_id)
  where merged_into_lead_id is not null;

create or replace function public.fn_mesclar_negocios(
  p_organization_id uuid,
  p_negocio_principal uuid,
  p_negocios_secundarios uuid[],
  p_previa boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal public.crm_leads%rowtype;
  v_esperado integer;
  v_achado integer;
  v_alvo record;
  v_linha record;
  v_movidas integer;
  v_pulados integer;
  v_repontado jsonb := '{}'::jsonb;
  v_nao_repontado jsonb := '{}'::jsonb;
  v_contatos uuid[];
  v_contato_principal uuid;
  v_fusao_contatos jsonb := null;
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  if p_negocio_principal is null
     or p_negocios_secundarios is null
     or cardinality(p_negocios_secundarios) = 0
     or p_negocio_principal = any(p_negocios_secundarios) then
    raise exception using errcode = '22023', message = 'selecao_de_mesclagem_invalida';
  end if;

  select count(distinct id)::integer into v_esperado
    from unnest(p_negocios_secundarios) as ids(id);
  if v_esperado <> cardinality(p_negocios_secundarios) then
    raise exception using errcode = '22023', message = 'secundario_repetido';
  end if;

  select * into v_principal from public.crm_leads
   where id = p_negocio_principal
     and organization_id = p_organization_id
     and merged_into_lead_id is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'negocio_principal_indisponivel';
  end if;

  perform 1 from public.crm_leads
   where id = any(p_negocios_secundarios)
     and organization_id = p_organization_id
     and merged_into_lead_id is null
   for update;
  get diagnostics v_achado = row_count;
  if v_achado <> v_esperado then
    raise exception using errcode = 'P0002', message = 'negocio_secundario_indisponivel';
  end if;

  -- Contatos dos absorvidos que NÃO são o do principal.
  select coalesce(array_agg(distinct l.contact_id), '{}'::uuid[]) into v_contatos
    from public.crm_leads l
   where l.id = any(p_negocios_secundarios)
     and l.contact_id is not null
     and l.contact_id is distinct from v_principal.contact_id;

  -- ─── Prévia: conta, não escreve ───────────────────────────────────────────
  if p_previa then
    for v_alvo in
      select c.relname as tabela, a.attname as coluna
        from pg_catalog.pg_constraint co
        join pg_catalog.pg_class c on c.oid = co.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
       where co.contype = 'f'
         and co.confrelid = 'public.crm_leads'::regclass
         and array_length(co.conkey, 1) = 1
         and c.relkind = 'r'
         and n.nspname = 'public'
         and not (c.relname = 'crm_leads' and a.attname = 'merged_into_lead_id')
       order by 1, 2
    loop
      execute format('select count(*) from public.%I where %I = any($1)',
                     v_alvo.tabela, v_alvo.coluna)
        into v_movidas using p_negocios_secundarios;
      if v_movidas > 0 then
        v_repontado := v_repontado
          || jsonb_build_object(v_alvo.tabela || '.' || v_alvo.coluna, v_movidas);
      end if;
    end loop;

    return jsonb_build_object(
      'previa', true,
      'negocio_id', p_negocio_principal,
      'negocios_mesclados', to_jsonb(p_negocios_secundarios),
      'contatos_a_juntar', to_jsonb(v_contatos),
      'repontado', v_repontado,
      'nao_repontado', '{}'::jsonb,
      'tags_novas', (
        select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
          from (select unnest(l.tags) as t from public.crm_leads l
                 where l.id = any(p_negocios_secundarios)) s
         where not (t = any(coalesce(v_principal.tags, '{}'::text[])))
      ),
      'campos_novos', (
        select coalesce(jsonb_agg(distinct e.key), '[]'::jsonb)
          from public.crm_leads l, jsonb_each(coalesce(l.custom_fields, '{}'::jsonb)) e
         where l.id = any(p_negocios_secundarios)
           and not (coalesce(v_principal.custom_fields, '{}'::jsonb) ? e.key)
      )
    );
  end if;

  -- ─── 1 · Contatos primeiro (mensagens, tarefas, conversa moram neles) ─────
  v_contato_principal := v_principal.contact_id;
  if cardinality(v_contatos) > 0 then
    if v_contato_principal is null then
      -- Principal sem contato: herda o do absorvido mais antigo.
      select l.contact_id into v_contato_principal from public.crm_leads l
       where l.id = any(p_negocios_secundarios) and l.contact_id is not null
       order by l.created_at, l.id limit 1;
      update public.crm_leads set contact_id = v_contato_principal
       where id = p_negocio_principal;
      v_contatos := array_remove(v_contatos, v_contato_principal);
    end if;
    if cardinality(v_contatos) > 0 then
      v_fusao_contatos := public.fn_mesclar_contatos(
        p_organization_id, v_contato_principal, v_contatos);
    end if;
  end if;

  -- ─── 2 · Lápide antes do repontamento ─────────────────────────────────────
  update public.crm_leads
     set merged_into_lead_id = p_negocio_principal,
         merged_at = now(),
         merged_by_user_id = auth.uid()
   where organization_id = p_organization_id
     and id = any(p_negocios_secundarios);

  -- Cadeia: quem já tinha sido unificado num absorvido aponta para o principal.
  update public.crm_leads
     set merged_into_lead_id = p_negocio_principal
   where organization_id = p_organization_id
     and merged_into_lead_id = any(p_negocios_secundarios)
     and id <> p_negocio_principal;

  -- ─── 3 · Reponta TODO ponteiro para os absorvidos (catálogo) ──────────────
  for v_alvo in
    select c.relname as tabela, a.attname as coluna,
           case when c.relname = 'crm_leads' then ' and id <> $3' else '' end as filtro
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class c on c.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.crm_leads'::regclass
       and array_length(co.conkey, 1) = 1
       and c.relkind = 'r'
       and n.nspname = 'public'
       and not (c.relname = 'crm_leads' and a.attname = 'merged_into_lead_id')
     order by 1, 2
  loop
    v_pulados := 0;
    begin
      execute format('update public.%I set %I = $1 where %I = any($2)%s',
                     v_alvo.tabela, v_alvo.coluna, v_alvo.coluna, v_alvo.filtro)
        using p_negocio_principal, p_negocios_secundarios, p_negocio_principal;
      get diagnostics v_movidas = row_count;
    exception when unique_violation or exclusion_violation then
      v_movidas := 0;
      for v_linha in execute format(
        'select ctid as tid from public.%I where %I = any($1)%s',
        v_alvo.tabela, v_alvo.coluna, replace(v_alvo.filtro, '$3', '$2')
      ) using p_negocios_secundarios, p_negocio_principal
      loop
        begin
          execute format('update public.%I set %I = $1 where ctid = $2',
                         v_alvo.tabela, v_alvo.coluna)
            using p_negocio_principal, v_linha.tid;
          v_movidas := v_movidas + 1;
        exception when unique_violation or exclusion_violation then
          v_pulados := v_pulados + 1;
        end;
      end loop;
    end;

    if v_movidas > 0 then
      v_repontado := v_repontado
        || jsonb_build_object(v_alvo.tabela || '.' || v_alvo.coluna, v_movidas);
    end if;
    if v_pulados > 0 then
      v_nao_repontado := v_nao_repontado
        || jsonb_build_object(v_alvo.tabela || '.' || v_alvo.coluna, v_pulados);
    end if;
  end loop;

  -- ─── 4 · O principal manda; o que ele não tem vem dos absorvidos ──────────
  update public.crm_leads p set
    tags = (
      select coalesce(array_agg(distinct t), '{}'::text[])
        from (select unnest(l.tags) as t from public.crm_leads l
               where l.id = p_negocio_principal or l.id = any(p_negocios_secundarios)) s
    ),
    custom_fields = (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select distinct on (k) k, v from (
          select e.key as k, e.value as v, 0 as ordem, p.created_at as quando
            from jsonb_each(coalesce(p.custom_fields, '{}'::jsonb)) e
          union all
          select e.key, e.value, 1, l.created_at
            from public.crm_leads l, jsonb_each(coalesce(l.custom_fields, '{}'::jsonb)) e
           where l.id = any(p_negocios_secundarios)
        ) x order by k, ordem, quando
      ) y
    ),
    source_metadata = (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
        select distinct on (k) k, v from (
          select e.key as k, e.value as v, 0 as ordem, p.created_at as quando
            from jsonb_each(coalesce(p.source_metadata, '{}'::jsonb)) e
          union all
          select e.key, e.value, 1, l.created_at
            from public.crm_leads l, jsonb_each(coalesce(l.source_metadata, '{}'::jsonb)) e
           where l.id = any(p_negocios_secundarios)
        ) x order by k, ordem, quando
      ) y
    ) || jsonb_build_object(
      'unificado_de',
      coalesce(p.source_metadata->'unificado_de', '[]'::jsonb) || to_jsonb(p_negocios_secundarios),
      'unificado_at', to_jsonb(now())
    ),
    value_cents = coalesce(p.value_cents, (
      select l.value_cents from public.crm_leads l
       where l.id = any(p_negocios_secundarios) and l.value_cents is not null
       order by l.created_at, l.id limit 1)),
    description = coalesce(p.description, (
      select l.description from public.crm_leads l
       where l.id = any(p_negocios_secundarios) and l.description is not null
       order by l.created_at, l.id limit 1)),
    last_activity_at = greatest(p.last_activity_at, (
      select max(l.last_activity_at) from public.crm_leads l
       where l.id = any(p_negocios_secundarios)))
  where p.id = p_negocio_principal;

  -- ─── 5 · Absorvidos saem do funil vivo: etapa de perda, motivo `other` ────
  update public.crm_leads l set
    stage_id = coalesce(
      (select s.id from public.crm_stages s
        where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived
        order by s.position nulls last, s.id limit 1),
      l.stage_id),
    lost_reason = case
      when exists (select 1 from public.crm_stages s
                    where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived)
      then 'other' else l.lost_reason end,
    source_metadata = coalesce(l.source_metadata, '{}'::jsonb)
      || jsonb_build_object('unificado_em', p_negocio_principal,
                            'unificado_at', to_jsonb(now()))
  where l.organization_id = p_organization_id
    and l.id = any(p_negocios_secundarios)
    and l.status <> 'lost';

  -- ─── 6 · Rastro na linha do tempo do principal ────────────────────────────
  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type,
     reason, payload, metadata, performed_at, performed_by_user_id)
  values
    (p_organization_id, p_negocio_principal,
     (select contact_id from public.crm_leads where id = p_negocio_principal),
     'crm', p_negocio_principal, 'leads_merged',
     'Fichas unificadas',
     jsonb_build_object(
       'negocios_mesclados', to_jsonb(p_negocios_secundarios),
       'repontado', v_repontado,
       'nao_repontado', v_nao_repontado,
       'contatos', v_fusao_contatos
     ),
     '{}'::jsonb, now(), auth.uid());

  return jsonb_build_object(
    'previa', false,
    'negocio_id', p_negocio_principal,
    'negocios_mesclados', to_jsonb(p_negocios_secundarios),
    'contatos_a_juntar', to_jsonb(v_contatos),
    'repontado', v_repontado,
    'nao_repontado', v_nao_repontado,
    'contatos', v_fusao_contatos
  );
end;
$$;

revoke execute on function public.fn_mesclar_negocios(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.fn_mesclar_negocios(uuid, uuid, uuid[], boolean) to authenticated, service_role;

-- Unificação feita à mão no banco em 19/11/2026 (Bizzio: dois "Jeferson" em
-- @bizziopizza, com ok do Danilo no chat) deixou `source_metadata.unificado_em`.
-- Vira lápide de verdade aqui. Idempotente.
update public.crm_leads l
   set merged_into_lead_id = (l.source_metadata->>'unificado_em')::uuid,
       merged_at = coalesce(l.merged_at, (l.source_metadata->>'unificado_at')::timestamptz)
 where l.merged_into_lead_id is null
   and l.source_metadata->>'unificado_em' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and exists (select 1 from public.crm_leads p
                where p.id = (l.source_metadata->>'unificado_em')::uuid
                  and p.organization_id = l.organization_id);

notify pgrst, 'reload schema';
