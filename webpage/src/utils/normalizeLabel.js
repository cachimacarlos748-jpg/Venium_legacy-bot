/**
 * Normalizează un label para comparación de alcance de descuentos.
 * Quita acentos, pasa a minúsculas y deja espacios simples.
 */
export function normalizeLabel(label = "") {
  return String(label)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
}
