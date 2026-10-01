import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Clock, CheckCircle2, XCircle, Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";

const STATUS_CONFIG = {
  pending: { label: "Pendiente", icon: Clock, color: "text-amber-400", bg: "bg-amber-400/10" },
  processing: { label: "Procesando", icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10" },
  completed: { label: "Completado", icon: CheckCircle2, color: "text-green-400", bg: "bg-green-400/10" },
  cancelled: { label: "Cancelado", icon: XCircle, color: "text-red-400", bg: "bg-red-400/10" },
  partial_payment: { label: "Pago parcial", icon: AlertCircle, color: "text-orange-400", bg: "bg-orange-400/10" },
};

// Página de historial de pedidos. El cliente busca por su correo o WhatsApp
// y ve todos sus pedidos con el estado en tiempo real.
export default function MisPedidos() {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 3) return;
    setLoading(true);
    setSearched(true);
    try {
      const cleanWa = q.replace(/\D/g, "");
      let results = [];
      if (q.includes("@")) {
        results = await base44.entities.Order.filter({ customer_email: q });
      } else if (cleanWa.length >= 8) {
        results = await base44.entities.Order.filter({ customer_whatsapp: cleanWa });
      } else {
        const [byEmail, byWa] = await Promise.all([
          base44.entities.Order.filter({ customer_email: q }).catch(() => []),
          base44.entities.Order.filter({ customer_whatsapp: cleanWa }).catch(() => []),
        ]);
        results = [...(byEmail || []), ...(byWa || [])];
      }
      const seen = new Set();
      setOrders((results || []).filter((o) => !seen.has(o.id) && seen.add(o.id)));
    } catch {
      setOrders([]);
    }
    setLoading(false);
  };

  return (
    <div className="bg-background min-h-screen pb-20">
      <div className="border-b border-border/20 bg-card">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary text-sm transition-colors mb-3">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>
          <h1 className="text-xl sm:text-2xl font-black text-foreground">Mis Pedidos</h1>
          <p className="text-xs text-muted-foreground mt-1">Consulta el estado de tus recargas con tu correo o WhatsApp</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-6">
        <form onSubmit={handleSearch} className="flex gap-2 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="tu@email.com o +58 412..."
              className="w-full bg-card border border-border/30 rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <button type="submit" disabled={loading || query.trim().length < 3}
            className="bg-primary text-primary-foreground px-6 py-3 rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar
          </button>
        </form>

        {searched && !loading && orders.length === 0 && (
          <div className="text-center py-16">
            <Package className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">No encontramos pedidos con ese dato.</p>
            <p className="text-muted-foreground/60 text-xs mt-1">Verifica que el correo o WhatsApp sea el que usaste al comprar.</p>
          </div>
        )}

        <div className="space-y-3">
          <AnimatePresence>
            {orders.map((order) => {
              const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-card border border-border/20 rounded-2xl p-4"
                >
                  <div className="flex items-start gap-3">
                    {order.product_image_url && (
                      <img src={order.product_image_url} alt={order.product_name} className="w-12 h-12 rounded-lg object-cover border border-border/20" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-foreground font-bold text-sm truncate">{order.product_name}</p>
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${cfg.bg} ${cfg.color} whitespace-nowrap`}>
                          <Icon className="w-3 h-3" /> {cfg.label}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs mt-1">{order.denomination}</p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-foreground font-bold text-sm">{order.price?.toFixed(2)} {order.amount_paid && order.amount_paid < order.price ? `· Pagado ${order.amount_paid.toFixed(2)}` : ""}</p>
                        <p className="text-muted-foreground/60 text-xs">
                          {new Date(order.created_date).toLocaleDateString("es-VE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}