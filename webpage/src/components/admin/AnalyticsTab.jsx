import { useState, useEffect } from "react";
import { TrendingUp, ShoppingBag, CheckCircle2, Clock, DollarSign, Package } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, XAxis as BarX, YAxis as BarY,
} from "recharts";
import { base44 } from "@/api/base44Client";

const STATUS_COLORS = {
  completed: "#22c55e",
  pending: "#f59e0b",
  processing: "#3b82f6",
  cancelled: "#ef4444",
  partial_payment: "#f97316",
};
const STATUS_LABELS = {
  completed: "Completado",
  pending: "Pendiente",
  processing: "Procesando",
  cancelled: "Cancelado",
  partial_payment: "Pago parcial",
};

// Dashboard de analytics para el admin. Métricas de ventas, pedidos por estado,
// tendencia temporal y productos más vendidos.
export default function AnalyticsTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const all = await base44.entities.Order.list("-created_date", 500);
        if (active) setOrders(all || []);
      } catch {}
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-20">
        <Package className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
        <p className="text-muted-foreground text-sm">Aún no hay pedidos para mostrar métricas.</p>
      </div>
    );
  }

  // KPIs
  const completed = orders.filter((o) => o.status === "completed");
  const pending = orders.filter((o) => o.status === "pending" || o.status === "processing");
  const revenue = completed.reduce((sum, o) => sum + (o.price || 0), 0);
  const avgTicket = completed.length > 0 ? revenue / completed.length : 0;

  // Pedidos por estado (pie chart)
  const byStatus = Object.keys(STATUS_LABELS).map((key) => ({
    name: STATUS_LABELS[key],
    value: orders.filter((o) => o.status === key).length,
    color: STATUS_COLORS[key],
  })).filter((s) => s.value > 0);

  // Ventas por día (últimos 14 días)
  const days = {};
  orders.forEach((o) => {
    const d = new Date(o.created_date).toISOString().slice(0, 10);
    if (!days[d]) days[d] = { date: d, orders: 0, revenue: 0 };
    days[d].orders++;
    if (o.status === "completed") days[d].revenue += o.price || 0;
  });
  const salesData = Object.values(days)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map((d) => ({
      ...d,
      label: new Date(d.date).toLocaleDateString("es-VE", { day: "numeric", month: "short" }),
    }));

  // Top productos
  const productCount = {};
  orders.forEach((o) => {
    const name = o.product_name || "Desconocido";
    if (!productCount[name]) productCount[name] = { name, count: 0, revenue: 0 };
    productCount[name].count++;
    if (o.status === "completed") productCount[name].revenue += o.price || 0;
  });
  const topProducts = Object.values(productCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Ingresos" value={`${revenue.toFixed(0)} Bs`} color="text-green-400" bg="bg-green-400/10" />
        <KpiCard icon={ShoppingBag} label="Pedidos" value={orders.length} color="text-blue-400" bg="bg-blue-400/10" />
        <KpiCard icon={CheckCircle2} label="Completados" value={completed.length} color="text-primary" bg="bg-primary/10" />
        <KpiCard icon={Clock} label="Pendientes" value={pending.length} color="text-amber-400" bg="bg-amber-400/10" />
      </div>

      {/* Ticket promedio + conversión */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-card border border-border/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Ticket promedio</p>
          </div>
          <p className="text-2xl font-black text-foreground">{avgTicket.toFixed(2)} Bs</p>
        </div>
        <div className="bg-card border border-border/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Tasa de conversión</p>
          </div>
          <p className="text-2xl font-black text-foreground">
            {orders.length > 0 ? ((completed.length / orders.length) * 100).toFixed(1) : 0}%
          </p>
        </div>
      </div>

      {/* Sales over time */}
      <div className="bg-card border border-border/20 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-4">Ventas últimos 14 días</h3>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={salesData}>
            <defs>
              <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", fontSize: "12px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorRev)" name="Ingresos Bs" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Orders by status */}
        <div className="bg-card border border-border/20 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Pedidos por estado</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={2}>
                {byStatus.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", fontSize: "12px" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-3">
            {byStatus.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                {s.name} ({s.value})
              </span>
            ))}
          </div>
        </div>

        {/* Top products */}
        <div className="bg-card border border-border/20 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Productos más vendidos</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topProducts} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
              <BarX type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
              <BarY type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "0.75rem", fontSize: "12px" }}
                cursor={{ fill: "hsl(var(--primary) / 0.1)" }}
              />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Pedidos" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color, bg }) {
  return (
    <div className="bg-card border border-border/20 rounded-2xl p-4">
      <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-2`}>
        <Icon className={`w-4.5 h-4.5 ${color}`} />
      </div>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-lg font-black text-foreground mt-0.5">{value}</p>
    </div>
  );
}