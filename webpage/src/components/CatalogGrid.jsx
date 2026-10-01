import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getProductSlug } from "@/data/purchaseConfig";
import ProductImage from "@/components/ProductImage";
import { getProductRegion } from "@/lib/productRegions";

// Colorea los badges según el estado del juego y bloquea clics para los que
// están en "Próximamente".
function badgeClassFor(badge) {
  const t = String(badge || "").toLowerCase();
  if (t.includes("próxim") || t.includes("proxi")) return { classes: "bg-slate-500/90 text-white", locked: true };
  if (t.includes("manten")) return { classes: "bg-amber-500/90 text-black", locked: false };
  if (t.includes("disponible")) return { classes: "bg-green-600/90 text-white", locked: false };
  return { classes: "bg-primary/90 text-primary-foreground", locked: false };
}

export default function CatalogGrid({ entityName, title, subtitle, withCategories = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const scrollRefs = useRef({});
  const Entity = base44.entities[entityName];

  useEffect(() => {
    let active = true;
    Entity.list("-updated_date", 200)
      .then((r) => { if (active) setItems(r || []); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const categories = withCategories
    ? ["Todas", ...Array.from(new Set(items.map((i) => i.category).filter(Boolean)))]
    : [];

  const filtered = items.filter((it) => {
    const matchQ = !query || (it.name || "").toLowerCase().includes(query.toLowerCase());
    const matchC = category === "Todas" || it.category === category;
    return matchQ && matchC;
  });

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="border-b border-border/20 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl font-black text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
          <div className="relative mt-5 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar en ${title}...`}
              className="w-full bg-muted border border-border/30 rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          {withCategories && categories.length > 1 && (
            <div className="flex gap-2 mt-4 overflow-x-auto scrollbar-hide pb-1">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${
                    category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 text-primary animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm py-20 text-center">Sin resultados</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map((item, i) => {
              const bs = badgeClassFor(item.badge);
              const Card = (
                <div
                  className={`bg-card rounded-xl overflow-hidden border border-border/20 border-b-[3px] ${bs.locked ? "border-b-slate-500 opacity-65" : "border-b-transparent hover:border-b-primary hover:border-border/40 hover:-translate-y-2"} transition-all duration-300 shadow-sm group`}
                >
                  <div className="relative aspect-square overflow-hidden bg-muted/20">
                    <ProductImage
                      src={item.image_url}
                      alt={item.name}
                      className={`w-full h-full object-cover ${bs.locked ? "grayscale" : "group-hover:scale-110"} transition-transform duration-700`}
                    />
                    {item.badge && (
                      <span className={`absolute top-2 right-2 ${bs.classes} text-[10px] font-bold px-2.5 py-0.5 rounded-full`}>{item.badge}</span>
                    )}
                  </div>
                  <div className="p-3 border-t border-border/10">
                    <p className="text-foreground text-sm font-bold truncate text-center group-hover:text-primary transition-colors">{item.name}</p>
                    {getProductRegion(getProductSlug(item)) && (
                      <p className="text-[10px] text-muted-foreground font-medium text-center mt-0.5 uppercase tracking-wide">{getProductRegion(getProductSlug(item))}</p>
                    )}
                  </div>
                </div>
              );
              return bs.locked ? (
                <div key={item.id || i} title="Próximamente" className="cursor-not-allowed">{Card}</div>
              ) : (
                <Link key={item.id || i} to={`/comprar/${getProductSlug(item)}`} className="block group">{Card}</Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}