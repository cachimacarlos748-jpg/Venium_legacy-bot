import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, ShoppingBag, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

// Notificaciones en tiempo real para el panel de admin.
// Escucha nuevos pedidos vía subscribe() y muestra un badge + toast + notificación del navegador.
export default function AdminNotifications() {
  const [unread, setUnread] = useState(0);
  const [recent, setRecent] = useState([]);
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState(null); // pedido nuevo que salta como banner
  const lastSeenId = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    // Cargar pedidos recientes al montar
    const load = async () => {
      const list = await base44.entities.Order.list("-created_date", 15).catch(() => []);
      setRecent(list || []);
      const stored = localStorage.getItem("admin_last_order_seen");
      lastSeenId.current = stored || (list?.[0]?.id ?? null);
      if (stored && list?.length) {
        const idx = list.findIndex((o) => o.id === stored);
        setUnread(idx > 0 ? idx : 0);
      }
    };
    load();

    // Suscripción en tiempo real: nuevo pedido = notificación
    const unsub = base44.entities.Order.subscribe((event) => {
      if (event.type === "create") {
        setRecent((prev) => [event.data, ...prev].slice(0, 15));
        setUnread((c) => c + 1);
        const name = event.data?.product_name || "Nuevo pedido";
        const contact = event.data?.customer_whatsapp || event.data?.customer_email || "";
        // Banner flotante prominente
        setBanner({ name, contact, price: event.data?.price, id: event.data?.id });
        // Toast
        toast({
          title: "🛒 Nuevo pedido",
          description: `${name} — ${contact}`,
        });
        // Notificación nativa del navegador si hay permiso
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("Nuevo pedido — Vex Store", {
              body: name,
              icon: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/ce368c5aa_file_000000005e7071f7aee19aec1b4a0992.png",
            });
          } catch {}
        }
        // Auto-cerrar el banner después de 8 segundos
        setTimeout(() => setBanner(null), 8000);
      }
    });
    return () => unsub();
  }, []);

  // Pedir permiso de notificaciones del navegador
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const markAllRead = () => {
    if (recent.length > 0) {
      localStorage.setItem("admin_last_order_seen", recent[0].id);
      lastSeenId.current = recent[0].id;
    }
    setUnread(0);
  };

  return (
    <>
    {/* Banner flotante que salta automáticamente cuando llega un pedido nuevo */}
    <AnimatePresence>
      {banner && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[55] w-[92%] max-w-md"
        >
          <div className="bg-gradient-to-r from-primary to-purple-600 text-white rounded-xl shadow-2xl shadow-primary/40 p-4 flex items-center gap-3 border border-white/20">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black">¡Nuevo pedido! 🛒</p>
              <p className="text-xs text-white/90 truncate">{banner.name}</p>
              <p className="text-[11px] text-white/70 truncate">
                {banner.contact}{banner.price ? ` · ${banner.price.toFixed(2)} Bs` : ""}
              </p>
            </div>
            <button onClick={() => setBanner(null)} className="p-1.5 hover:bg-white/20 rounded-lg shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    <div className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open && unread > 0) markAllRead(); }}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full badge-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border/30 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
              <span className="text-sm font-bold text-foreground">Pedidos recientes</span>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Check className="w-3 h-3" /> Marcar leídos
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">No hay pedidos todavía.</div>
              ) : (
                recent.map((o) => (
                  <div key={o.id} className="px-4 py-2.5 border-b border-border/10 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start gap-2">
                      <ShoppingBag className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-foreground truncate">{o.product_name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {o.customer_whatsapp || o.customer_email || "—"} · {o.price?.toFixed(2) || "0"} Bs
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">{new Date(o.created_date).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                        o.status === "completed" ? "bg-green-500/20 text-green-400" :
                        o.status === "pending" ? "bg-amber-500/20 text-amber-400" :
                        o.status === "partial_payment" ? "bg-blue-500/20 text-blue-400" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {o.status === "partial_payment" ? "PARCIAL" : o.status === "completed" ? "OK" : o.status === "pending" ? "PEND" : o.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}