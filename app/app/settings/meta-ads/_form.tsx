"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  disconnectAdInsights,
  updateAdInsightsConnection,
} from "@/app/actions/settings/updateAdInsightsConnection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * Cada recusa vira uma frase que diz O QUE FAZER — mesma regra do formulário de
 * Conversões. `cifra_indisponivel` é a que mais importa acertar: é problema de
 * INSTALAÇÃO, e um texto genérico mandaria o admin do tenant refazer um cadastro
 * que já está certo, para falhar igual.
 */
const ERRO_EM_PORTUGUES: Record<string, string> = {
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta conexão.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  cifra_indisponivel:
    "Esta instalação está sem a chave mestra de criptografia, e o token não foi gravado. Quem instalou o sistema precisa configurá-la — refazer o cadastro aqui não resolve.",
  erro_ao_gravar: "Não consegui gravar agora. Tente de novo em instantes.",
};

/**
 * O que a Meta/nós devolvemos na volta do "Conectar com o Facebook"
 * (`?erro=<código>` / `?ok=1`). Frases curtas, sem jargão, que dizem o que fazer.
 */
const ERRO_DO_FACEBOOK: Record<string, string> = {
  cancelado: "Você cancelou a conexão no Facebook. Quando quiser, é só clicar no botão de novo.",
  meta_recusou:
    "O Facebook não deixou conectar. Isso costuma acontecer porque o aplicativo ainda não tem a liberação avançada de leitura de anúncios: sem ela, só entra quem tem função no aplicativo (administrador, desenvolvedor ou testador). Peça a quem cuida do aplicativo para te adicionar, ou cole um token abaixo.",
  troca_falhou: "Não consegui terminar a conexão com o Facebook. Tente de novo em instantes.",
  estado_invalido: "O pedido de conexão venceu ou não é mais válido. Clique no botão e tente de novo.",
  sem_codigo: "O Facebook não devolveu a autorização. Clique no botão e tente de novo.",
  app_nao_configurado:
    "O botão do Facebook ainda não foi configurado no servidor (faltam META_APP_ID e META_APP_SECRET). Peça a quem administra o sistema.",
  cifra_indisponivel:
    "Esta instalação está sem a chave mestra de criptografia, e a conexão não foi gravada. Quem instalou o sistema precisa configurá-la.",
  erro_ao_gravar: "Não consegui gravar agora. Tente de novo em instantes.",
};

export function FormularioDeMetaAds({
  conectada,
  contaPadrao,
  idioma,
  loginDisponivel,
  variaveisQueFaltam,
  expiraEm,
  expiraEmMs,
  retorno,
}: {
  conectada: boolean;
  contaPadrao: string | null;
  idioma: Idioma;
  /** A instalação tem App ID + segredo do app da Meta. */
  loginDisponivel: boolean;
  /** Nomes das variáveis de ambiente que faltam para ligar o botão. */
  variaveisQueFaltam: string[];
  /** Data (já formatada) em que o token do login vence; nulo = token colado à mão. */
  expiraEm: string | null;
  /** Vencimento em ms (para decidir "venceu" no navegador); nulo = sem vencimento conhecido. */
  expiraEmMs: number | null;
  retorno: { ok: boolean; erro: string | null };
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Lazy: `Date.now()` no corpo do render seria impuro.
  const [agoraMs] = useState(() => Date.now());
  const vencida = expiraEmMs !== null && expiraEmMs < agoraMs;
  const [token, setToken] = useState("");
  const [conta, setConta] = useState(contaPadrao ?? "");

  // Avisa uma vez o desfecho da volta do Facebook e limpa a URL, para um
  // recarregar não repetir o aviso.
  useEffect(() => {
    if (!retorno.ok && !retorno.erro) return;
    if (retorno.ok) {
      toast.success(t("Conta do Facebook conectada."));
    } else if (retorno.erro) {
      toast.error(t(ERRO_DO_FACEBOOK[retorno.erro] ?? "Não consegui conectar com o Facebook."), {
        duration: 15000,
      });
    }
    router.replace("/app/settings/meta-ads");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Na primeira conexão o token é obrigatório — a coluna é NOT NULL (0214) e a
  // Server Action recusa. Barrar aqui explica antes de o clique acontecer, em
  // vez de devolver um erro de validação depois.
  const podeSalvar = conectada || token.trim().length >= 20;

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    startTransition(async () => {
      const resultado = await updateAdInsightsConnection({
        platform: "meta_ads",
        access_token: token.trim() || undefined,
        default_account_id: conta.trim() || null,
      });

      if (resultado.ok) {
        // O campo é limpo no sucesso: deixá-lo preenchido dá a impressão de que
        // a tela guarda o token, e ela nunca o mostra de volta.
        setToken("");
        toast.success(t("Conexão salva."));
        router.refresh();
        return;
      }
      toast.error(t(ERRO_EM_PORTUGUES[resultado.error] ?? "Não consegui salvar agora."));
    });
  }

  function desconectar() {
    startTransition(async () => {
      const resultado = await disconnectAdInsights();
      if (resultado.ok) {
        setToken("");
        setConta("");
        toast.success(t("Conta desconectada."));
        router.refresh();
        return;
      }
      toast.error(t(ERRO_EM_PORTUGUES[resultado.error] ?? "Não consegui desconectar agora."));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-6" data-testid="meta-ads-login">
        <h2 className="font-medium">{t("Conectar com o Facebook")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Entre com a sua conta do Facebook e autorize só a leitura dos anúncios. Não precisa gerar nem colar token: a conexão dura cerca de 60 dias e o sistema renova sozinho enquanto você usar a tela de Meta Ads.",
          )}
        </p>
        {loginDisponivel ? (
          <div className="flex items-center gap-3">
            <Button asChild>
              {/* Navegação completa de propósito: o fluxo sai para o Facebook e volta. */}
              <a href="/api/v1/meta-ads/oauth/connect" data-testid="meta-ads-conectar-facebook">
                {conectada ? t("Reconectar com o Facebook") : t("Conectar com o Facebook")}
              </a>
            </Button>
            {conectada && expiraEm && (
              <span className="text-xs text-muted-foreground">
                {vencida
                  ? `${t("A conexão venceu em")} ${expiraEm}. ${t("Reconecte.")}`
                  : `${t("Conectado até")} ${expiraEm}.`}
              </span>
            )}
          </div>
        ) : (
          <p
            className="rounded-md border border-warning/40 bg-warning-bg p-3 text-xs leading-4"
            data-testid="meta-ads-login-indisponivel"
          >
            {t(
              "O botão do Facebook está desligado porque faltam estas configurações no servidor:",
            )}{" "}
            <strong>{variaveisQueFaltam.join(", ")}</strong>.{" "}
            {t("Quem administra o sistema cadastra e reimplanta. Enquanto isso, você pode colar um token logo abaixo.")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t(
            "Se o Facebook disser que o recurso está indisponível, é porque o aplicativo ainda não tem a liberação avançada de leitura de anúncios. Sem ela, só entra quem tem função no aplicativo (administrador, desenvolvedor ou testador).",
          )}
        </p>
      </Card>

    <Card className="p-6">
      <form onSubmit={salvar} className="flex flex-col gap-5">
        <h2 className="font-medium">{t("Ou cole um token à mão")}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="access_token">{t("Token de acesso")}</Label>
          <Input
            id="access_token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={conectada ? t("Guardado — preencha só para trocar") : "EAA…"}
          />
          <p className="text-xs text-muted-foreground">
            {conectada
              ? t(
                  "Já existe um token guardado. Deixe em branco para mantê-lo, ou cole um novo para substituir.",
                )
              : t("Precisa da permissão ads_read.")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="default_account_id">{t("Conta padrão (opcional)")}</Label>
          <Input
            id="default_account_id"
            value={conta}
            onChange={(e) => setConta(e.target.value)}
            placeholder="act_123456789012345"
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "A conta que a tela de Meta Ads abre por padrão. Em branco, ela abre a primeira conta ativa que o token alcançar.",
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending || !podeSalvar}>
            {isPending ? t("Salvando…") : t("Salvar")}
          </Button>

          {conectada && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={desconectar}
            >
              {t("Desconectar")}
            </Button>
          )}

          {!podeSalvar && (
            <span className="text-sm text-muted-foreground">
              {t("Cole o token para poder salvar.")}
            </span>
          )}
        </div>

        {conectada && (
          <p className="text-xs text-muted-foreground">
            {/*
              Desconectar APAGA a linha — não existe "pausar" nesta feature, e o
              porquê está no cabeçalho da 0214: como nada roda sozinho, um estado
              "conectado mas desligado" teria a mesma consequência visível de não
              estar conectado.
            */}
            {t(
              "Desconectar apaga o token guardado. A tela de Meta Ads volta a pedir uma conexão, e nenhum dado histórico é perdido — nada é armazenado aqui.",
            )}
          </p>
        )}
      </form>
    </Card>
    </div>
  );
}
