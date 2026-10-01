import { useState, useEffect } from "react";
import { Plus, Loader2, Wand2, ChevronUp, ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import ProductEditor from "./ProductEditor";
import { buildDefaultConfig, slugifyLocal } from "@/data/purchaseConfig";

const TABS = [
  { name: "Game", label: "Juegos" },
  { name: "GiftCard", label: "Gift Cards" },
  { name: "Service", label: "Servicios" },
];

export default function ProductManager() {
  const [tab, setTab] = useState("Game");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);

  const load = () => {
    setLoading(true);
    base44.entities[tab].list("-updated_date", 200)
      .then((r) => {
        const sorted = (r || []).slice().sort((a, b) => {
          const ao = a.sort_order ?? 9999;
          const bo = b.sort_order ?? 9999;
          if (ao !== bo) return ao - bo;
          return new Date(b.updated_date || 0) - new Date(a.updated_date || 0);
        });
        setItems(sorted);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("catalog-changed", handler);
    return () => window.removeEventListener("catalog-changed", handler);
  }, [tab]);

  const createNew = async () => {
    const name = prompt("Nombre del nuevo producto:");
    if (!name) return;
    const slug = slugifyLocal(name);
    await base44.entities[tab].create({
      name,
      slug,
      image_url: "",
      category: tab === "Game" ? "Otros" : "",
      badge: "",
      description: "",
      sort_order: items.length,
      config: buildDefaultConfig(slug, name),
    });
    load();
  };

  const seedDefaults = async () => {
    if (!confirm("Esto cargará los precios/denominaciones por defecto en los productos que no las tengan. ¿Continuar?")) return;
    let updated = 0;
    for (const it of items) {
      if (it.config?.denominations?.length) continue;
      const cfg = buildDefaultConfig(it.slug || it.name, it.name);
      if (!cfg.denominations.length) continue;
      await base44.entities[tab].update(it.id, { config: cfg });
      updated++;
    }
    alert(`Actualizados ${updated} productos con precios por defecto.`);
    load();
  };

  const move = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    setMoving(true);
    try {
      const newItems = items.slice();
      const [moved] = newItems.splice(index, 1);
      newItems.splice(targetIndex, 0, moved);
      const updates = newItems.map((it, i) => ({ id: it.id, sort_order: i }));
      await base44.entities[tab].bulkUpdate(updates);
      load();
    } catch (e) {
      alert("Error al reordenar: " + (e.message || ""));
    } finally {
      setMoving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t.name}
              onClick={() => setTab(t.name)}
              className={`text-sm font-medium px-4 py-1.5 rounded-md transition-all ${
                tab === t.name ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={seedDefaults} className="h-9">
            <Wand2 className="w-4 h-4 mr-1.5" /> Cargar precios por defecto
          </Button>
          <Button size="sm" onClick={createNew} className="h-9">
            <Plus className="w-4 h-4 mr-1.5" /> Nuevo
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm py-16 text-center">No hay productos. Crea uno con "Nuevo".</p>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={it.id} className="flex items-stretch gap-1.5">
              <div className="flex flex-col items-center justify-center gap-0.5 bg-card border border-border/20 rounded-xl px-1 py-2">
                <span className="text-[10px] font-bold text-muted-foreground mb-0.5">{i + 1}</span>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || moving}
                  className="p-1 text-muted-foreground hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors"
                  title="Subir"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1 || moving}
                  className="p-1 text-muted-foreground hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed rounded transition-colors"
                  title="Bajar"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <ProductEditor entityName={tab} initial={it} onChanged={load} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}