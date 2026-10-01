import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Ticker de "recargas recientes" — bandera en vivo estilo recargasnexus.
// Muestra pedidos completados/procesando de la última hora con el nickname
// anonimizado y el monto. Sólo lee `Order` (sin permisos extra).

const mask = (s) => {
  if (!s) return "*";
  const t = String(s).trim();
  if (t.length <= 2) return t[0] + "*";
  return t.slice(0, 2) + "*".repeat(Math.max(1, t.length - 3)) + t.slice(-1);
};

const timeAgo = (d) => {
  if (!d) return "hace un momento";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "hace unos segundos";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};

export default function RecentOrdersTicker() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await base44.entities.Order.list("-created_date", 30);
        if (!active) return;
        const valid = (list || []).filter(
          (o) => o.status === "completed" || o.status === "processing" || o.status === "pending"
        );
        const mapped = valid.map((o) => {
          const whoRaw = (o.customer_email || o.player_id || o.product_name || "u").toString();
          const head = o.customer_email ? whoRaw.split("@")[0] : whoRaw;
          return {
            id: o.id,
            who: mask(head),
            denom: o.denomination || o.product_name || "Producto",
            ago: timeAgo(o.created_date),
          };
        });
        setItems(mapped);
      } catch {}
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  if (!loaded) return null;
  if (!items.length) {
    return (
      <div className="bg-card border-y border-border/20 py-2 text-center">
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-amber-400" />
          Aún no hay recargas recientes — ¡sé tú el primero en recargar en Legacy Store!
        </p>
      </div>
    );
  }

  const doubled = items.concat(items);
  return (
    <div className="bg-card border-y border-border/20 py-2.5 overflow-hidden">
      <div className="flex gap-10 text-xs whitespace-nowrap animate-ticker-x">
        {doubled.map((it, i) => (
          <span key={it.id + "-" + i} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Zap className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="text-foreground font-bold">{it.who}</span>
            <span>recargó</span>
            <span className="text-primary font-bold">{it.denom}</span>
            <span className="text-muted-foreground/60">· {it.ago}</span>
          </span>
        ))}
      </div>
    </div>
  );
}