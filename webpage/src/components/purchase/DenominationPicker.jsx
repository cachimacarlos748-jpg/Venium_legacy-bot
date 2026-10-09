import { useState, useEffect, useMemo } from "react";
import { Check, Gem, Ticket, Coins, Medal, Sparkles, ChevronDown, Flame, Crown } from "lucide-react";
import { formatPrice } from "@/lib/priceFormat";

// Cuántos paquetes se muestran antes del botón "Ver más". 6 = tres filas
// exactas de la cuadrícula, sin dejar un hueco suelto.
const VISIBLE_COUNT = 6;

// Clasifica una denominación en una pestaña (categoría).
//   "moneda"     → paquetes de la moneda principal (Diamantes, Oro, Robux…)
//   "especiales" → Membresías Semanal/Mensual, Pases, Niveles
function categorizeDenom(d) {
  const label = String(d.label || "").trim();
  if (/^\d/.test(label)) return "moneda";
  return "especiales";
}

// Separa el label en cantidad, bono y unidad.
//   "100+10"            → qty 100, bonus 10
//   "100 + 10 Diamantes"→ qty 100, bonus 10, unit "Diamantes"
//   "Nivel 30"          → sin cantidad (se muestra el texto tal cual)
function splitLabel(label, currencyLabel) {
  const s = String(label || "").trim();
  const withBonus = s.match(/^(\d[\d.,]*)\s*\+\s*(\d+)\s*(.*)$/);
  if (withBonus) {
    return { qty: withBonus[1], bonus: withBonus[2], unit: (withBonus[3] || currencyLabel || "").trim(), isNumeric: true };
  }
  const plain = s.match(/^(\d[\d.,]*)\s*(.*)$/);
  if (plain) {
    return { qty: plain[1], bonus: "", unit: (plain[2] || currencyLabel || "").trim(), isNumeric: true };
  }
  return { qty: null, bonus: "", unit: s, isNumeric: false };
}

const CURRENCY_ICONS = {
  "Diamantes": Gem,
  "Gemas": Gem,
  "Ágatas": Gem,
  "Cristales": Sparkles,
  "Robux": Coins,
  "Oro": Coins,
  "Riot Coins": Coins,
  "CP": Medal,
};

export default function DenominationPicker({ denominations, selected, onSelect, currencyLabel, regions, topSeller }) {
  // Agrupa las denominaciones por categoría (pestaña).
  const categories = useMemo(() => {
    const groups = {};
    (denominations || []).forEach((d) => {
      const cat = categorizeDenom(d);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    });
    return groups;
  }, [denominations]);

  const categoryKeys = Object.keys(categories);
  const hasMultipleCats = categoryKeys.length > 1;

  const [activeTab, setActiveTab] = useState(categoryKeys[0] || "moneda");
  const [showAll, setShowAll] = useState(false);
  const [activeRegion, setActiveRegion] = useState(regions?.[0]?.id || null);

  useEffect(() => {
    if (!categories[activeTab] && categoryKeys.length) {
      setActiveTab(categoryKeys[0]);
      setShowAll(false);
    }
  }, [categories, activeTab, categoryKeys]);

  const specialLabel = useMemo(() => {
    const items = categories["especiales"] || [];
    if (items.some((d) => /membres|tarjeta/i.test(d.label || ""))) return "Membresías";
    return "Paquetes";
  }, [categories]);

  const tabLabel = (key) => key === "moneda" ? (currencyLabel || "Paquetes") : specialLabel;

  let list = categories[activeTab] || [];
  if (regions && activeRegion) {
    list = list.filter((d) => d.region === activeRegion);
  }

  // "Mejor valor": el paquete con el precio más bajo por unidad de la pestaña.
  // Sale de los datos del catálogo, no de una etiqueta escrita a mano.
  const bestValueIndex = useMemo(() => {
    let best = null;
    let bestRatio = Infinity;
    list.forEach((d) => {
      const { qty, bonus } = splitLabel(d.label, currencyLabel);
      const units = Number(String(qty || "").replace(/[.,]/g, "")) + Number(bonus || 0);
      const price = Number(d.price);
      if (!units || !price) return;
      const ratio = price / units;
      if (ratio < bestRatio) { bestRatio = ratio; best = d._i; }
    });
    return best;
  }, [list, currencyLabel]);

  const visibleList = showAll ? list : list.slice(0, VISIBLE_COUNT);
  const hiddenCount = list.length - VISIBLE_COUNT;

  return (
    <div className="space-y-3">
      {/* Selector de regiones (estilo Roblox en Venium) */}
      {regions && regions.length > 1 && (
        <div className="flex gap-2">
          {regions.map((r) => (
            <button
              key={r.id}
              onClick={() => { setActiveRegion(r.id); setShowAll(false); }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                activeRegion === r.id
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Pestañas de categoría (Diamantes / Membresías, etc.) */}
      {hasMultipleCats && (
        <div className="flex gap-1.5 p-1 bg-muted rounded-xl">
          {categoryKeys.map((key) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setShowAll(false); }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
                activeTab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tabLabel(key)}
            </button>
          ))}
        </div>
      )}

      {/* CUADRÍCULA 2 COLUMNAS: cada paquete es una tarjeta, no una fila larga.
          Así el monto y el precio de todos se ven de un vistazo, sin deslizar. */}
      <div className="grid grid-cols-2 gap-2.5">
        {visibleList.map((d) => {
          const active = selected?._i === d._i;
          const { qty, bonus, unit, isNumeric } = splitLabel(d.label, currencyLabel);
          const Icon = CURRENCY_ICONS[unit] || CURRENCY_ICONS[currencyLabel] || (isNumeric ? Gem : Ticket);
          const priceText =
            d.currency === "Bs"
              ? `${formatPrice(d.price)} Bs`
              : `$${formatPrice(d.price)}`;
          const originalPrice = Number(d.original_price || 0);
          // Comparación explícita a booleano: si se deja el número crudo, React
          // lo pinta como texto y aparece un "0" suelto en la tarjeta.
          const hasDiscount = originalPrice > Number(d.price);
          const discountPct = hasDiscount ? Math.round((1 - Number(d.price) / originalPrice) * 100) : 0;
          const isTopSeller = !!topSeller && String(topSeller) === String(d.label);
          const isBestValue = bestValueIndex === d._i && !isTopSeller;

          // Una sola etiqueta por tarjeta, en orden de importancia.
          const badge = isTopSeller
            ? { text: "MÁS VENDIDO", icon: Flame, className: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
            : isBestValue
              ? { text: "MEJOR VALOR", icon: Crown, className: "bg-amber-500/15 text-amber-300 border-amber-500/30" }
              : bonus && isNumeric
                ? { text: `+${bonus} EXTRA`, icon: Sparkles, className: "bg-primary/15 text-primary border-primary/30" }
                : null;
          const BonusIcon = badge?.icon;

          return (
            <button
              key={d._i}
              onClick={() => onSelect(d)}
              className={`tap relative flex flex-col rounded-2xl border p-2.5 text-left transition-all duration-200 ${
                active
                  ? "border-amber-500/70 bg-gradient-to-b from-amber-500/[0.14] to-card glow-amber"
                  : "border-border bg-card hover:border-amber-500/40"
              }`}
            >
              <div className="flex items-start justify-between gap-1 mb-1.5">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                  active ? "bg-amber-500/15 border-amber-500/30" : "bg-muted/60 border-border"
                }`}>
                  <Icon className={`w-4 h-4 ${active ? "text-amber-400" : "text-primary/80"}`} />
                </span>
                {badge && (
                  <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md border leading-none ${badge.className}`}>
                    {BonusIcon && <BonusIcon className="w-2.5 h-2.5" />}
                    {badge.text}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                {isNumeric ? (
                  <p className="font-black text-lg leading-tight text-foreground">
                    {qty}
                    {bonus && <span className={`text-xs font-bold ml-1 ${active ? "text-amber-400" : "text-primary"}`}>+{bonus}</span>}
                  </p>
                ) : (
                  <p className="font-bold text-[13px] leading-snug text-foreground break-words">{unit}</p>
                )}
                {/* Unidad + despacho en una sola línea: dice lo mismo que antes
                    pero sin ocupar una fila entera de la tarjeta. */}
                <p className="text-[10px] truncate">
                  <span className="text-muted-foreground">{isNumeric ? (unit || "Recarga") : (currencyLabel || "Paquete")}</span>
                  {d._instant !== undefined && (
                    <span className={`font-bold ${d._instant ? "text-primary" : "text-amber-400"}`}>
                      {" · "}{d._instant ? "Instantáneo" : "Manual"}
                    </span>
                  )}
                  {d._isEvent === true && <span className="font-bold text-amber-300">{" · "}Evento</span>}
                </p>
              </div>

              <div className="mt-1.5 pt-1.5 border-t border-border/60 flex items-center justify-between gap-1">
                <span className={`num text-[11px] font-black leading-none ${active ? "text-amber-300" : "text-foreground"}`}>
                  {priceText}
                </span>
                {hasDiscount ? (
                  <span className="text-[9px] font-bold text-green-400 shrink-0">-{discountPct}%</span>
                ) : active ? (
                  <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={3} />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Botón "Ver más" para listas largas */}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border bg-card hover:bg-muted/40 hover:border-primary/40 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver {hiddenCount} {hiddenCount === 1 ? "paquete" : "paquetes"} más
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
