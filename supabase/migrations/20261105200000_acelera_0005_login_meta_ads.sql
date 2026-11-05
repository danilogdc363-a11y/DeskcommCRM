-- manifest: **(Acelera) Login com o Facebook na tela Meta Ads.** `platform_meta_app.app_id` (App ID do app da Meta da instalação, público, sem cifra) e `ad_insights_connections.token_expires_at` (quando vence o token de longa duração; nulo = token colado à mão, sem vencimento conhecido). Só colunas nullable: clone antigo e código antigo seguem funcionando. O App Secret continua o de `platform_meta_app.app_secret_encrypted` (0257).

alter table public.platform_meta_app
  add column if not exists app_id text;

comment on column public.platform_meta_app.app_id is
  'App ID do app da Meta desta instalação (acelera_0005). Identificador público, vai na URL do login — por isso fica em claro. Usado só pelo botão "Conectar com o Facebook" de Configurações › Meta Ads.';

alter table public.ad_insights_connections
  add column if not exists token_expires_at timestamptz;

comment on column public.ad_insights_connections.token_expires_at is
  'Quando o token de longa duração obtido pelo login com o Facebook vence (acelera_0005). Nulo = token colado à mão, sem vencimento conhecido. A leitura renova o token sob demanda quando falta pouco.';

notify pgrst, 'reload schema';
