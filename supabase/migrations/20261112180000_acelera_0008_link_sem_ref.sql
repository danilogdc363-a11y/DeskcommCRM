-- manifest: (Acelera) link rastreável pode sair sem o [ref:] na mensagem, quando a origem chega por outro caminho (formulário pelo telefone)
--
-- O formulário do OS já manda as UTMs ao CRM junto do telefone, e o contato
-- fica carimbado na entrada do webhook. O `[ref:XXXXXX]` no texto vira
-- redundante e aparece para o lead. Com `include_ref = false` o clique continua
-- gravado (métricas), mas a mensagem sai limpa. Padrão `true`: nada muda para
-- os links que já existem. Idempotente.

alter table public.ad_tracking_links
  add column if not exists include_ref boolean not null default true;

comment on column public.ad_tracking_links.include_ref is
  'Se a mensagem do link leva o [ref:XXXXXX] (acelera_0008). Desligar só quando a origem chega por outro caminho, como o formulário pelo telefone.';

notify pgrst, 'reload schema';
