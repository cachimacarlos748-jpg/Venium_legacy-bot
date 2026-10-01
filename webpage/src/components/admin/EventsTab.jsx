import { useState, useEffect } from "react";
import { Moon, Plus, Pause, Play, X, Loader2, History, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { createEvent, setEventStatus } from "@/lib/nightEventClient";
import { formatPrice } from "@/lib/priceFormat";

const GameEntity = base44.entities.Game;
const GiftCardEntity = base44.entities.GiftCard;
const ServiceEntity = base44.entities.Service;
const EventEntity = base44.entities.NightEvent;

export default function EventsTab() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    setLoading(true);
    EventEntity.list("-created_date", 100)
      .then((r) => setEvents(r || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const unsub = EventEntity.subscribe(() => load());
    return () => unsub();
  }, []);

  const active = events.filter((e) => e.status === "active" && (e.stock_sold || 0) < (e.stock_total || 0));
  const history = events.filter((e) => !active.includes(e));

  const handlePause = (id) => setEventStatus(id, "paused").then(load);
  const handleResume = (id) => setEventStatus(id, "active").then(load);
  const handleClose = (id) => setEventStatus(id, "closed").then(load);

  return (
    <div className="space-y-6">
      {/* Header + crear */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-black text-foreground flex items-center gap-2">
            <Moon className="w-5 h-5 text-primary" /> Eventos Nocturnos
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Flash sales por stock limitado a precio especial.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} className="font-bold">
          {showForm ? <><X className="w-4 h-4 mr-1.5" /> Cancelar</> : <><Plus className="w-4 h-4 mr-1.5" /> Nuevo evento</>}
        </Button>
      </div>

      {showForm && <EventForm onDone={() => { setShowForm(false); load(); }} />}

      {/* Eventos activos */}
      <div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-primary" /> Activos ahora ({active.length})
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : active.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm border border-dashed border-border/30 rounded-xl">
            No hay eventos activos. Crea uno con el botón de arriba.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.map((e) => <ActiveCard key={e.id} event={e} onPause={handlePause} onClose={handleClose} />)}
          </div>
        )}
      </div>

      {/* Historial */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <History className="w-4 h-4 text-muted-foreground" /> Historial
          </h3>
          <div className="space-y-2">
            {history.map((e) => <HistoryRow key={e.id} event={e} onResume={handleResume} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveCard({ event, onPause, onClose }) {
  const sold = event.stock_sold || 0;
  const total = event.stock_total || 0;
  const remaining = Math.max(0, total - sold);
  const pct = total > 0 ? Math.round((sold / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/15 px-2 py-0.5 rounded-full mb-1.5">
            <Moon className="w-3 h-3" /> EVENTO NOCTURNO
          </span>
          <p className="text-sm font-bold text-foreground truncate">{event.product_name || event.product_slug}</p>
          <p className="text-xs text-muted-foreground truncate">{event.package_label}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-black text-amber-400">{formatPrice(event.event_price)} Bs</p>
        </div>
      </div>

      {/* Barra de stock */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[11px] font-bold mb-1">
          <span className="text-muted-foreground">Stock vendido</span>
          <span className="text-foreground">{sold}/{total} · Quedan {remaining}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-amber-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onPause(event.id)} className="flex-1 font-bold">
          <Pause className="w-3.5 h-3.5 mr-1" /> Pausar
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onClose(event.id)} className="flex-1 font-bold">
          <X className="w-3.5 h-3.5 mr-1" /> Cerrar
        </Button>
      </div>
    </div>
  );
}

function HistoryRow({ event, onResume }) {
  const sold = event.stock_sold || 0;
  const total = event.stock_total || 0;
  const statusLabel = {
    sold_out: { txt: "Agotado", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    paused: { txt: "Pausado", cls: "bg-muted text-muted-foreground border-border/40" },
    closed: { txt: "Cerrado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  }[event.status] || { txt: event.status, cls: "bg-muted text-muted-foreground border-border/40" };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/20 bg-card p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{event.product_name || event.product_slug}</p>
        <p className="text-xs text-muted-foreground truncate">{event.package_label} · {formatPrice(event.event_price)} Bs</p>
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusLabel.cls}`}>{statusLabel.txt}</span>
      <span className="text-xs text-muted-foreground font-medium">{sold}/{total}</span>
      {event.status === "paused" && (
        <Button size="sm" variant="ghost" onClick={() => onResume(event.id)} className="h-7 px-2">
          <Play className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

function EventForm({ onDone }) {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [slug, setSlug] = useState("");
  const [packageIdx, setPackageIdx] = useState("");
  const [eventPrice, setEventPrice] = useState("");
  const [stock, setStock] = useState("3");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [g, gc, sv] = await Promise.all([
          GameEntity.list("-updated_date", 200).catch(() => []),
          GiftCardEntity.list("-updated_date", 50).catch(() => []),
          ServiceEntity.list("-updated_date", 50).catch(() => []),
        ]);
        const all = [
          ...(g || []).map((p) => ({ slug: p.slug, name: p.name, denoms: p.config?.denominations || [], type: "Juego" })),
          ...(gc || []).map((p) => ({ slug: p.slug, name: p.name, denoms: p.config?.denominations || [], type: "Gift Card" })),
          ...(sv || []).map((p) => ({ slug: p.slug, name: p.name, denoms: p.config?.denominations || [], type: "Servicio" })),
        ].filter((p) => p.slug && p.denoms && p.denoms.length);
        setProducts(all);
      } finally {
        setLoadingProducts(false);
      }
    })();
  }, []);

  const selectedProduct = products.find((p) => p.slug === slug);
  const denoms = selectedProduct?.denoms || [];
  const selectedDenom = denoms[packageIdx] || null;

  const handleSave = async () => {
    setError("");
    if (!slug || !selectedDenom) { setError("Selecciona un producto y un paquete."); return; }
    const price = Number(eventPrice);
    const stk = Number(stock);
    if (!price || price <= 0) { setError("Ingresa un precio de evento válido (Bs)."); return; }
    if (!stk || stk <= 0) { setError("Ingresa un stock válido."); return; }
    setSaving(true);
    try {
      await createEvent({
        product_slug: slug,
        product_name: selectedProduct.name,
        package_id: selectedDenom.package_id || "",
        package_label: selectedDenom.label || "",
        event_price: price,
        stock_total: stk,
      });
      onDone();
    } catch (e) {
      setError(e?.message || "No se pudo crear el evento.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingProducts) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="rounded-xl border border-border/30 bg-card p-5 space-y-4">
      <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5"><Plus className="w-4 h-4 text-primary" /> Crear evento nocturno</h3>

      {/* Producto */}
      <div>
        <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Producto</label>
        <select value={slug} onChange={(e) => { setSlug(e.target.value); setPackageIdx(""); }}
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary">
          <option value="">Selecciona un producto…</option>
          {products.map((p) => <option key={p.slug} value={p.slug}>{p.name} ({p.type})</option>)}
        </select>
      </div>

      {/* Paquete */}
      {denoms.length > 0 && (
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Paquete</label>
          <select value={packageIdx} onChange={(e) => setPackageIdx(e.target.value)}
            className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary">
            <option value="">Selecciona un paquete…</option>
            {denoms.map((d, i) => <option key={i} value={i}>{d.label} — ${d.price}</option>)}
          </select>
        </div>
      )}

      {/* Precio + stock */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Precio evento (Bs)</label>
          <input type="number" value={eventPrice} onChange={(e) => setEventPrice(e.target.value)} placeholder="ej: 760"
            className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground mb-1.5 block">Stock (cantidad)</label>
          <input type="number" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="ej: 3"
            className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary" />
        </div>
      </div>

      {error && <p className="text-xs text-destructive font-medium">{error}</p>}

      <Button onClick={handleSave} disabled={saving} className="w-full font-bold">
        {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Creando…</> : <><Moon className="w-4 h-4 mr-1.5" /> Lanzar evento</>}
      </Button>
    </div>
  );
}