// Recompensas por rangos de vistas — Programa de Creadores.
//   Rango Inicial (1K – 3.9K): Semanal básica + Tarjeta semanal.
//   Rango Intermedio (4K – 9.9K): Pase Booyah + Tarjeta semanal.
//   Rango Pro (10K+): Tarjeta mensual + Pase Booyah.
//     (Si ya tiene el pase activo: Tarjeta mensual + Tarjeta semanal
//      básica + Recarga normal).

export const TIERS = [
  { tier: "inicial", label: "Inicial (1K – 3.9K)", reward: "Semanal básica + Tarjeta semanal", min: 1000, max: 3999 },
  { tier: "intermedio", label: "Intermedio (4K – 9.9K)", reward: "Pase Booyah + Tarjeta semanal", min: 4000, max: 9999 },
  { tier: "pro", label: "Pro (10K+)", reward: "Tarjeta mensual + Pase Booyah", min: 10000, max: Infinity },
];

export function rewardTierForViews(views, alreadyHasBooyah = false) {
  const v = Number(views) || 0;
  if (v < 1000) return { tier: "none", label: "Sin recompensa (< 1.000 vistas)" };
  if (v < 4000) return { tier: "inicial", label: "Semanal básica + Tarjeta semanal" };
  if (v < 10000) return { tier: "intermedio", label: "Pase Booyah + Tarjeta semanal" };
  if (alreadyHasBooyah) {
    return { tier: "pro", label: "Tarjeta mensual + Tarjeta semanal básica + Recarga normal (Pase ya activo)" };
  }
  return { tier: "pro", label: "Tarjeta mensual + Pase Booyah" };
}

// Recorre un set de registros (Order/RechargeRecord/CreatorVideo) y detecta
// si壳 ya hay un Pase Booyah activo/entregado para este creador.
export function hasActiveBooyah(records = []) {
  return records.some((r) => {
    const hay = `${r.producto || ""} ${r.producto_nombre || ""} ${r.reward_label || ""}`.toLowerCase();
    return /booyah|pase de elite/i.test(hay) && r.status === "completed";
  });
}