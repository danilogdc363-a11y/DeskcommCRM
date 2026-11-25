-- manifest: (Acelera) Temperatura MANUAL do lead. `crm_leads.temperatura_manual` (frio|morno|quente, NULL = automático) é a marcação do operador e vale mais que a faixa da IA; fica em crm_leads (decisão humana) e não em crm_lead_scores (telemetria da IA, que nunca a sobrescreve). Idempotente.

-- ═══ POR QUE NA `crm_leads` E NÃO NA `crm_lead_scores` ═══════════════════════
--
-- A migration 0075 tirou o SCORE da IA de `crm_leads` de propósito: recálculo em
-- segundo plano é telemetria e não pode pulsar card nem invalidar a trava
-- otimista do arrasto. A temperatura marcada à mão é o oposto — é uma EDIÇÃO
-- humana: deve pulsar o card (alguém mexeu) e deve bumpar `updated_at` como
-- qualquer outra edição. E a IA nunca a escreve, então não há corrida.
--
-- NULL = "automático": o card mostra a faixa da IA, se existir. Preenchida, a
-- marcação do operador vence a da IA (regra em `lib/kanban/temperatura.ts`).
-- O CHECK repete o vocabulário de `ScoreBand` para quem escreve por fora da API.

alter table public.crm_leads
  add column if not exists temperatura_manual text;

do $temperatura_manual$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_leads_temperatura_manual_check'
       and conrelid = 'public.crm_leads'::regclass
  ) then
    alter table public.crm_leads
      add constraint crm_leads_temperatura_manual_check
      check (temperatura_manual is null or temperatura_manual in ('frio', 'morno', 'quente'));
  end if;
end $temperatura_manual$;

comment on column public.crm_leads.temperatura_manual is
  'Temperatura marcada à mão pelo operador (frio|morno|quente). NULL = automático (vale a faixa da IA em crm_lead_scores, se houver). Marcação humana: vence a da IA e a IA nunca a escreve.';

notify pgrst, 'reload schema';
