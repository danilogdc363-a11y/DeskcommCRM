"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export interface FunilParaEscolher {
  id: string;
  nome: string;
  etapas: { id: string; nome: string }[];
}

interface PaginaDaTela {
  id: string;
  nome: string;
  conectada: boolean;
  ativa: boolean;
  funilId: string | null;
  etapaId: string | null;
  ultimoRecebimento: string | null;
}

interface ListaDePaginas {
  loginFeito: boolean;
  permissoesFaltando: string[];
  paginas: PaginaDaTela[];
  aviso: string | null;
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

const CLASSE_DO_CAMPO =
  "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50";

/** O texto técnico da Meta (só admin vê esta tela), para quem for diagnosticar. */
function detalheDe(erro?: { details?: unknown }): string | undefined {
  return typeof erro?.details === "string" && erro.details ? `Meta: ${erro.details}` : undefined;
}

async function chamar<T>(url: string, metodo: string, corpo?: unknown): Promise<Envelope<T>> {
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: corpo ? { "content-type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return (await r.json()) as Envelope<T>;
  } catch {
    return { error: { code: "rede", message: "Não consegui falar com o servidor. Tente de novo." } };
  }
}

/**
 * (Acelera) Bloco "Formulários de anúncio": as Páginas do Facebook da pessoa,
 * com funil e etapa de entrada e os botões de ligar, verificar, trazer leads
 * antigos e desligar. Toda frase de erro vem pronta do servidor, em português.
 */
export function FormulariosDeAnuncio({
  idioma,
  loginDisponivel,
  funis,
  retornoOk,
}: {
  idioma: Idioma;
  loginDisponivel: boolean;
  funis: FunilParaEscolher[];
  retornoOk: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [lista, setLista] = useState<ListaDePaginas | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Record<string, { funil: string; etapa: string }>>({});
  const [dias, setDias] = useState<Record<string, number>>({});
  const [resultado, setResultado] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    const r = await chamar<ListaDePaginas>("/api/v1/meta-ads/formularios/paginas", "GET");
    if (r.data) {
      setLista(r.data);
      setFalha(null);
    } else {
      setFalha(r.error?.message ?? "Não consegui carregar as Páginas.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (!retornoOk) return;
    toast.success(t("Facebook conectado para os formulários. Escolha as Páginas abaixo."));
    router.replace("/app/settings/meta-ads");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retornoOk]);

  const funilDe = (id: string | undefined) => funis.find((f) => f.id === id);
  const destinoDe = (p: PaginaDaTela) => {
    const e = escolha[p.id];
    const funil = e?.funil ?? p.funilId ?? funis[0]?.id ?? "";
    const etapa = e?.etapa ?? p.etapaId ?? funilDe(funil)?.etapas[0]?.id ?? "";
    return { funil, etapa };
  };

  async function ligar(p: PaginaDaTela) {
    const { funil, etapa } = destinoDe(p);
    setOcupada(p.id);
    const r = await chamar<{ aviso_do_app: string | null }>("/api/v1/meta-ads/formularios/paginas", "POST", {
      page_id: p.id,
      pipeline_id: funil,
      stage_id: etapa,
    });
    setOcupada(null);
    if (r.error) {
      toast.error(r.error.message, { description: detalheDe(r.error), duration: 20000 });
      return;
    }
    toast.success(t("Página ligada. Os próximos formulários entram sozinhos."));
    if (r.data?.aviso_do_app) toast.warning(r.data.aviso_do_app, { duration: 15000 });
    await carregar();
  }

  async function desligar(p: PaginaDaTela) {
    if (!window.confirm(t("Desligar esta Página? Novos formulários deixam de entrar no CRM."))) return;
    setOcupada(p.id);
    const r = await chamar("/api/v1/meta-ads/formularios/paginas", "DELETE", { page_id: p.id });
    setOcupada(null);
    if (r.error) toast.error(r.error.message, { description: detalheDe(r.error), duration: 20000 });
    else toast.success(t("Página desligada."));
    await carregar();
  }

  async function verificar(p: PaginaDaTela) {
    setOcupada(p.id);
    const r = await chamar<{ mensagem: string }>(`/api/v1/meta-ads/formularios/paginas/${p.id}/verificar`, "GET");
    setOcupada(null);
    if (r.error) toast.error(r.error.message, { description: detalheDe(r.error), duration: 20000 });
    else toast.success(r.data?.mensagem ?? "Tudo certo.");
  }

  async function trazerAntigos(p: PaginaDaTela) {
    setOcupada(p.id);
    const r = await chamar<{
      encontrados: number;
      entraram: number;
      ja_existiam: number;
      ignorados: number;
      falharam: number;
      parou_no_limite: boolean;
    }>(`/api/v1/meta-ads/formularios/paginas/${p.id}/importar`, "POST", { dias: dias[p.id] ?? 30 });
    setOcupada(null);
    if (r.error || !r.data) {
      toast.error(r.error?.message ?? "Não consegui trazer os leads.", { description: detalheDe(r.error), duration: 20000 });
      return;
    }
    const d = r.data;
    setResultado((antes) => ({
      ...antes,
      [p.id]:
        `${d.encontrados} encontrados: ${d.entraram} entraram, ${d.ja_existiam} já estavam no CRM` +
        (d.ignorados + d.falharam > 0 ? `, ${d.ignorados + d.falharam} não entraram (veja “Leads recebidos”)` : "") +
        (d.parou_no_limite ? ". Ainda tem mais: clique de novo para continuar." : "."),
    }));
  }

  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="formularios-de-anuncio">
      <div>
        <h2 className="font-medium">{t("Formulários de anúncio")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "Os leads do formulário nativo do Instagram e do Facebook entram sozinhos no funil que você escolher. Entre com o Facebook, marque as Páginas e escolha a etapa de entrada.",
          )}
        </p>
      </div>

      {loginDisponivel ? (
        <div>
          <Button asChild variant={lista?.loginFeito ? "outline" : "default"}>
            {/* Navegação completa de propósito: o fluxo sai para o Facebook e volta. */}
            <a href="/api/v1/meta-ads/oauth/connect?para=formularios" data-testid="meta-formularios-conectar">
              {lista?.loginFeito ? t("Reconectar formulários") : t("Conectar formulários")}
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("O login do Facebook ainda não foi configurado no servidor (META_APP_ID e META_APP_SECRET).")}
        </p>
      )}

      {falha && <p className="text-sm text-destructive">{falha}</p>}
      {lista?.aviso && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{lista.aviso}</p>
      )}
      {!lista && !falha && <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>}

      {lista && lista.paginas.length === 0 && lista.loginFeito && (
        <p className="text-sm text-muted-foreground">
          {t("Nenhuma Página encontrada nesta conta do Facebook. É preciso ser administrador da Página.")}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {lista?.paginas.map((p) => {
          const { funil, etapa } = destinoDe(p);
          const etapas = funilDe(funil)?.etapas ?? [];
          const trabalhando = ocupada === p.id;
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border p-3" data-testid={`pagina-${p.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.nome}</span>
                {p.conectada && (
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                    {t("Ligada")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("Funil")}
                  <select
                    className={CLASSE_DO_CAMPO}
                    value={funil}
                    disabled={trabalhando || !lista.loginFeito}
                    onChange={(e) =>
                      setEscolha((a) => ({
                        ...a,
                        [p.id]: { funil: e.target.value, etapa: funilDe(e.target.value)?.etapas[0]?.id ?? "" },
                      }))
                    }
                  >
                    {funis.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("Etapa de entrada")}
                  <select
                    className={CLASSE_DO_CAMPO}
                    value={etapa}
                    disabled={trabalhando || !lista.loginFeito}
                    onChange={(e) => setEscolha((a) => ({ ...a, [p.id]: { funil, etapa: e.target.value } }))}
                  >
                    {etapas.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  disabled={trabalhando || !lista.loginFeito || !funil || !etapa}
                  onClick={() => void ligar(p)}
                >
                  {p.conectada ? t("Salvar destino") : t("Ligar esta Página")}
                </Button>
              </div>
              {p.conectada && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => void verificar(p)}>
                    {t("Verificar")}
                  </Button>
                  <select
                    className={CLASSE_DO_CAMPO}
                    aria-label={t("Período dos leads antigos")}
                    value={dias[p.id] ?? 30}
                    disabled={trabalhando}
                    onChange={(e) => setDias((a) => ({ ...a, [p.id]: Number(e.target.value) }))}
                  >
                    <option value={7}>{t("Últimos 7 dias")}</option>
                    <option value={30}>{t("Últimos 30 dias")}</option>
                    <option value={90}>{t("Últimos 90 dias")}</option>
                  </select>
                  <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => void trazerAntigos(p)}>
                    {t("Trazer leads antigos")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={trabalhando} onClick={() => void desligar(p)}>
                    {t("Desligar")}
                  </Button>
                </div>
              )}
              {resultado[p.id] && <p className="text-sm text-muted-foreground">{resultado[p.id]}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
