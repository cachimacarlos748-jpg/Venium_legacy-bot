import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { User, Mail, Package, LogOut, ChevronRight, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";

const STATUS_CONFIG = {
  pending: { label: "Pendiente", color: "text-amber-400" },
  processing: { label: "Procesando", color: "text-blue-400" },
  completed: { label: "Completado", color: "text-green-400" },
  cancelled: { label: "Cancelado", color: "text-red-400" },
  partial_payment: { label: "Pago parcial", color: "text-orange-400" },
};

// Página de perfil del usuario. Muestra sus datos y pedidos recientes.
export default function Perfil() {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let active = true;
    (async () => {
      try {
        const all = await base44.entities.Order.list("-created_date", 100);
        if (!active) return;
        const mine = (all || []).filter(
          (o) => o.customer_email === user.email || o.created_by_id === user.id
        );
        setOrders(mine);
      } catch {}
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <User className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Inicia sesión para ver tu perfil.</p>
          <Link to="/Login" className="inline-block mt-4 bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-bold">
            Iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  const completedCount = orders.filter((o) => o.status === "completed").length;

  return (
    <div className="bg-background min-h-screen pb-20">
      <div className="border-b border-border/20 bg-card">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center shrink-0">
              <User className="w-8 h-8 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black text-foreground truncate">{user.full_name || "Usuario"}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Mail className="w-3 h-3" /> {user.email}
              </p>
              <p className="text-xs text-primary font-bold mt-1">{completedCount} recargas completadas</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-6 space-y-6">
        <Link to="/mis-pedidos" className="block bg-card border border-border/20 rounded-2xl p-4 hover:border-primary/40 transition-colors group">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-foreground font-bold text-sm">Mis Pedidos</p>
              <p className="text-muted-foreground text-xs">Consulta el estado de tus recargas</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        <div>
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-3">Pedidos recientes</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-card border border-border/20 rounded-2xl p-8 text-center">
              <Package className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No tienes pedidos aún.</p>
              <Link to="/" className="inline-block mt-4 text-primary text-sm font-bold hover:underline">
                Explorar la tienda →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {orders.slice(0, 8).map((order) => {
                const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
                return (
                  <div key={order.id} className="bg-card border border-border/20 rounded-xl p-3 flex items-center gap-3">
                    {order.product_image_url && (
                      <img src={order.product_image_url} alt={order.product_name} className="w-10 h-10 rounded-lg object-cover border border-border/20" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground text-sm font-bold truncate">{order.product_name}</p>
                      <p className="text-muted-foreground text-xs">{order.denomination} · {order.price?.toFixed(2)}</p>
                    </div>
                    <span className={`text-xs font-bold ${cfg.color} whitespace-nowrap`}>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => logout()}
          className="w-full bg-destructive/10 text-destructive border border-destructive/20 rounded-2xl p-4 flex items-center gap-3 hover:bg-destructive/20 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-bold text-sm">Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}