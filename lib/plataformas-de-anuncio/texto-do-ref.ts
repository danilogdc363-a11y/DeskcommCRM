/**
 * O texto que vai para o WhatsApp. Desde 27/11/2026 ele nunca leva o código
 * `[ref:XXXXXX]`: a conversa herda a origem pelo telefone de quem preencheu o
 * formulário (`lib/leads/origem-do-site.ts`), e o código só aparecia para o
 * lead como sujeira. Tira o marcador com `{token}` e qualquer `[ref:...]` que
 * já tenha sido escrito à mão no texto.
 */
export function textoSemRef(template: string): string {
  return template
    .replace(/\s*\[[^[\]]*\{token\}[^[\]]*\]/g, "")
    .replace(/\s*\[ref:[^\]]*\]/g, "")
    .replaceAll("{token}", "")
    .trim();
}
