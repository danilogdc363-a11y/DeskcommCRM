const PAGINA = 1000;

type Resposta<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string; code?: string } | null;
}>;

/**
 * Lê todas as páginas. A consulta TEM de vir ordenada por chave única: sem
 * `order`, o Postgres não garante a mesma ordem entre páginas e linhas se
 * repetem ou somem.
 */
export async function lerTudo<T>(
  consulta: (de: number, ate: number) => Resposta<T>,
  tamanho = PAGINA,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += tamanho) {
    const { data, error } = await consulta(i, i + tamanho - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < tamanho) return out;
  }
}
