import { useState, useEffect, useMemo } from "react";
import { Check, Gem, Ticket, Coins, Medal, Sparkles, Zap, Clock, ChevronDown, Moon } from "lucide-react";
import { formatPrice } from "@/lib/priceFormat";

// Cuántos paquetes se muestran antes del botón "Ver más".
const VISIBLE_COUNT = 5;

// Clasifica una denominación en una pestaña (categoría).
//   "moneda"     → paquetes de la moneda principal (Diamantes, Oro, Robux…)
//   "membresias" → Membresías Semanal/Mensual
//   "paquetes"   → Pases, Bendición Lunar, etc.
function categorizeDenom(d) {
  const label = String(d.label || "").trim();
  // Paquetes numéricos (empiezan con número) → pestaña de la moneda principal.
  if (/^\d/.test(label)) return "moneda";
  // Membresías, Pases, etc. → pestaña especial.
  return "especiales";
}

// Separa el label en cantidad numérica + unidad.
function parseDenom(label, currencyLabel) {
  const s = String(label || "").trim();
  const m = s.match(/^(\d[\d.,]*)\s*(.*)$/);
  if (m) {
    const unit = (m[2] || currencyLabel || "Diamantes").trim();
    return { qty: m[1], unit: unit.charAt(0).toUpperCase() + unit.slice(1), isNumeric: true };
  }
  return { qty: null, unit: s, isNumeric: false };
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

export default function DenominationPicker({ denominations, selected, onSelect, currencyLabel, regions }) {
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

  // Si las denominaciones cambian y la pestaña activa ya no existe, reinicia.
  useEffect(() => {
    if (!categories[activeTab] && categoryKeys.length) {
      setActiveTab(categoryKeys[0]);
      setShowAll(false);
    }
  }, [categories, activeTab, categoryKeys]);

  // Etiqueta de la pestaña especial: "Membresías" si hay membresías, si no "Paquetes".
  const specialLabel = useMemo(() => {
    const items = categories["especiales"] || [];
    if (items.some((d) => /membres|tarjeta/i.test(d.label || ""))) return "Membresías";
    return "Paquetes";
  }, [categories]);

  // Etiqueta de cada pestaña: para "moneda" usa el nombre de la moneda del juego.
  const tabLabel = (key) => key === "moneda" ? (currencyLabel || "Paquetes") : specialLabel;

  let list = categories[activeTab] || [];
  // Filtra por región si el producto tiene selector de regiones (ej: Roblox).
  if (regions && activeRegion) {
    list = list.filter((d) => d.region === activeRegion);
  }

  const visibleList = showAll ? list : list.slice(0, VISIBLE_COUNT);
  const hiddenCount = list.length - VISIBLE_COUNT;

  return (
    <div className="space-y-4">
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
                  : "bg-card border border-border/30 text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Pestañas de categoría (Oro / Paquetes, Diamantes / Membresías, etc.) */}
      {hasMultipleCats && (
        <div className="flex gap-2 p-1 bg-muted rounded-xl">
          {categoryKeys.map((key) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setShowAll(false); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wide transition-colors ${
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

      {/* Lista de paquetes (tarjetas verticales estilo Venium) */}
      <div className="space-y-2.5">
        {visibleList.map((d) => {
          const active = selected?._i === d._i;
          const { qty, unit, isNumeric } = parseDenom(d.label, currencyLabel);
          const Icon = isNumeric ? (CURRENCY_ICONS[unit] || Gem) : Ticket;
          const priceText =
            d.currency === "Bs"
              ? `${formatPrice(d.price)} Bs`
              : `$${formatPrice(d.price)} ${d.currency || "USD"}`;
          const hasDiscount = d.original_price && Number(d.original_price) > Number(d.price);
          const discountPct = hasDiscount ? Math.round((1 - Number(d.price) / Number(d.original_price)) * 100) : 0;

          return (
            <button
              key={d._i}
              onClick={() => onSelect(d)}
              className={`w-full flex items-center gap-3 rounded-xl border p-3.5 transition-all duration-200 text-left ${
                active
                  ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
                  : "border-border/30 bg-card hover:border-primary/40"
              }`}
            >
              {/* Icono */}
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary/20" : "bg-muted/60"}`}>
                <Icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
              </div>

              {/* Nombre del paquete */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isNumeric ? (
                    <span className={`text-base font-bold ${active ? "text-primary" : "text-foreground"}`}>
                      {qty} <span className="text-xs text-muted-foreground font-medium">{unit}</span>
                    </span>
                  ) : (
                    <span className={`text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                      {unit}
                    </span>
                  )}
                  {d._instant !== undefined && (
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      d._instant ? "bg-primary/15 text-primary border border-primary/30" : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    }`}>
                      {d._instant ? <Zap className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                      {d._instant ? "Instantáneo" : "Manual"}
                    </span>
                  )}
                  {d._isEvent && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase tracking-wide">
                      <Moon className="w-2.5 h-2.5" /> Evento
                    </span>
                  )}
                  {hasDiscount && (
                    <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      -{discountPct}%
                    </span>
                  )}
                </div>
              </div>

              {/* Precio */}
              <div className="text-right shrink-0">
                {hasDiscount && (
                  <div className="text-[11px] text-muted-foreground line-through">
                    {d.currency === "Bs" ? `${formatPrice(d.original_price)} Bs` : `$${formatPrice(d.original_price)}`}
                  </div>
                )}
                <div className={`text-base font-black ${active ? "text-primary" : "text-foreground"}`}>
                  {priceText}
                </div>
              </div>

              {active && (
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Botón "Ver más" para listas largas */}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border/30 bg-card hover:bg-muted/40 hover:border-primary/40 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver {hiddenCount} {hiddenCount === 1 ? "paquete" : "paquetes"} más
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}