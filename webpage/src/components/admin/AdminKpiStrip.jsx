import { useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { NexusBot } from "@/lib/nexusBotClient";
import { TrendingUp, ShoppingBag, Zap, Wallet, RefreshCw } from "lucide-react";

const REFRESH_MS = 8000;

export default function AdminKpiStrip({ botOnline }) {
  const [data, setData] = useState({ ventasHoy: 0, pendientes: 0, botStatus: null, comisiones: 0 });
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [orders, creators] = await Promise.all([
        base44.entities.Order.list("-created_date", 200).catch(() => []),
        base44.entities.Creator.list().catch(() => []),
      ]);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayMs = today.getTime();
      let ventasHoy = 0, pendientes = 0;
      for (const o of orders) {
        if (o.status === "completed" && new Date(o.created_date).getTime() >= todayMs) ventasHoy += Number(o.price) || 0;
        if (["pending", "partial_payment", "processing"].includes(o.status)) pendientes++;
      }
      let comisiones = 0;
      for (const c of creators) comisiones += Number(c.balance) || 0;

      let botStatus = null;
      try { botStatus = await NexusBot.getStatus(); } catch { botStatus = null; }

      setData({ ventasHoy, pendientes, botStatus, comisiones });
      setLastUpdate(Date.now());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const secsAgo = Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000));
  const agoLabel = secsAgo < 1 ? "ahora" : `hace ${secsAgo}s`;

  const botConcurrent = data.botStatus?.cola ?? data.botStatus?.processing ?? data.botStatus?.stats?.concurrent ?? null;
  const botOn = botOnline || (data.botStatus && !data.botStatus?.error);

  const cards = [
    { icon: TrendingUp, label: "Ventas Hoy", value: `${data.ventasHoy.toFixed(0)} Bs`, sub: "Completados hoy", accent: "text-primary" },
    { icon: ShoppingBag, label: "Pedidos Pendientes", value: String(data.pendientes), sub: "Esperando / procesando", accent: "text-amber-400" },
    { icon: Zap, label: "Bot Free Fire", value: botOn ? "ONLINE" : "OFFLINE", sub: botConcurrent != null ? `Cola: ${botConcurrent}` : "Sin conexión", accent: botOn ? "text-green-400" : "text-red-400", dot: true },
    { icon: Wallet, label: "Comisiones Acumuladas", value: `${data.comisiones.toFixed(2)} Bs`, sub: "Balance creadores", accent: "text-primary" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-card border border-border/30 rounded-xl p-4 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className={`w-9 h-9 rounded-lg bg-muted flex items-center justify-center ${c.accent}`}>
              <c.icon className="w-5 h-5" />
            </div>
            {c.dot && <span className={`w-2.5 h-2.5 rounded-full ${botOn ? "bg-green-400 badge-pulse" : "bg-red-400"}`} />}
          </div>
          <p className="text-[11px] text-muted-foreground font-medium mt-3">{c.label}</p>
          <p className={`text-xl font-black ${c.accent} mt-0.5 tabular-nums`}>{loading ? "—" : c.value}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{c.sub}</p>
          <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground/60">
            <RefreshCw className="w-2.5 h-2.5" /> actualizada {agoLabel}
          </div>
        </div>
      ))}
    </div>
  );
}