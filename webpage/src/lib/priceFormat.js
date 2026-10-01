// Formatea un precio con separador de miles y 2 decimales.
// Ej: 8472    → "8,472.00"
//     845.5   → "845.50"
//     1747    → "1,747.00"
export function formatPrice(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}