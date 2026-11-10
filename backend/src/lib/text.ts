/**
 * Normalização usada na busca do catálogo.
 *
 * O pessoal digita no celular sem acento e sem se preocupar com maiúscula:
 * "avioes", "AVIÕES", "aviões" precisam dar no mesmo lugar. Guardamos a versão
 * normalizada do título na coluna `search_key` e comparamos com ela.
 */
export function normalizaBusca(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // pontuação atrapalha a busca por trecho ("—", "(", "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
