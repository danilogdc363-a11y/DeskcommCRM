-- manifest: **(Acelera) Login com o Facebook na tela Meta Ads.** `ad_insights_connections.token_expires_at` (quando vence o token de longa duração; nulo = token colado à mão, sem vencimento conhecido). Só uma coluna nullable: clone antigo e código antigo seguem funcionando. App ID e segredo do login NÃO vão ao banco: ficam no ambiente (`META_APP_ID`, `META_APP_SECRET`).

alter table public.ad_insights_connections
  add column if not exists token_expires_at timestamptz;

comment on column public.ad_insights_connections.token_expires_at is
  'Quando o token de longa duração obtido pelo login com o Facebook vence (acelera_0005). Nulo = token colado à mão, sem vencimento conhecido. A leitura renova o token sob demanda quando falta pouco.';

notify pgrst, 'reload schema';
