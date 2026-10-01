import { useState, useEffect } from "react";
import { Loader2, RefreshCw, MessageCircle, ArrowLeftRight, FileImage } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { sendWhatsAppMessage, buildWaLink, completionMessage } from "@/lib/whatsappClient";
import WhatsAppSender from "@/components/admin/WhatsAppSender";
import VueltoModal from "@/components/admin/VueltoModal";
import { creditCommission, cancelCommission } from "@/lib/creatorCommission";

const STATUSES = ["pending", "processing", "completed", "cancelled"];

const STATUS_STYLE = {
  pending: "bg-amber-500/15 text-amber-500",
  processing: "bg-blue-500/15 text-blue-500",
  completed: "bg-primary/15 text-primary",
  cancelled: "bg-red-500/15 text-red-500",
};

export default function OrderManager() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatorCodes, setCreatorCodes] = useState(new Set());

  const load = () => {
    setLoading(true);
    base44.entities.Order.list("-created_date", 100)
      .then((r) => setOrders(r || []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
    // Fetch creator codes to distinguish creator vs admin codes
    base44.entities.Creator.filter({ status: "approved" })
      .then((r) => setCreatorCodes(new Set((r || []).map((c) => c.code).filter(Boolean))))
      .catch(() => setCreatorCodes(new Set()));
  };

  useEffect(() => { load(); }, []);

  const [sending, setSending] = useState(null);
  const [waSender, setWaSender] = useState(null);
  const [vueltoOrder, setVueltoOrder] = useState(null);

  const setStatus = async (order, status) => {
    await base44.entities.Order.update(order.id, { status });
    // Al marcar como completado, envía WhatsApp automáticamente al cliente.
    if (status === "completed" && order.customer_whatsapp) {
      setSending(order.id);
      try {
        const res = await sendWhatsAppMessage(order.customer_whatsapp, completionMessage(order));
        // Si la API no está configurada o falló, abre wa.me como respaldo manual.
        if (!res.ok) {
          const link = buildWaLink(order);
          if (link) window.open(link, "_blank");
        }
      } catch {
        const link = buildWaLink(order);
        if (link) window.open(link, "_blank");
      }
      setSending(null);
    }
    // Al completar, acreditar comisión al creador si la orden usó un código de creador.
    if (status === "completed" && order.discount_code) {
      try {
        await creditCommission({ ...order, status });
      } catch {}
    }
    // Al cancelar, revertir la comisión del creador si la orden usó un código.
    if (status === "cancelled" && order.discount_code) {
      try {
        await cancelCommission({ ...order, status });
      } catch {}
    }
    load();
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-foreground">Pedidos recientes</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setWaSender({})} className="h-8">
            <MessageCircle className="w-3.5 h-3.5 mr-1.5" /> Envío personalizado
          </Button>
          <button onClick={load} className="p-2 text-muted-foreground hover:text-primary"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="text-muted-foreground text-sm py-16 text-center">No hay pedidos aún.</p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.id} className="bg-card border border-border/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground truncate">{o.product_name}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[o.status] || ""}`}>{o.status}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {o.denomination} · Bs. {o.price?.toFixed?.(2)} {o.payment_method}
                  {o.player_id ? ` · ID ${o.player_id}` : ""}
                </p>
                {o.discount_code && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${
                    creatorCodes.has(o.discount_code) ? "bg-primary/15 text-primary" : "bg-blue-500/15 text-blue-400"
                  }`}>
                    {creatorCodes.has(o.discount_code) ? "🎬 Creador" : "🏷️ Cupón"}: {o.discount_code}
                    {o.discount_amount ? ` (−${o.discount_amount})` : ""}
                  </span>
                )}
                <p className="text-xs text-muted-foreground truncate">{o.customer_email}</p>
                {o.customer_whatsapp && (
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" /> {o.customer_whatsapp}
                  </p>
                )}
                {o.receipt_url && (
                  <a href={o.receipt_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline mt-1">
                    <FileImage className="w-3 h-3" /> Ver comprobante
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(o.amount_paid || 0) > (o.price || 0) && (
                  <button
                    onClick={() => setVueltoOrder(o)}
                    title="Devolver vuelto"
                    className="p-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setWaSender({ order: o })}
                  title="Enviar WhatsApp"
                  className="p-2 rounded-lg bg-green-500/15 text-green-500 hover:bg-green-500/25 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
                <select
                  value={o.status}
                  onChange={(e) => setStatus(o, e.target.value)}
                  className="bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
      {waSender && <WhatsAppSender order={waSender.order} onClose={() => setWaSender(null)} />}
      {vueltoOrder && <VueltoModal order={vueltoOrder} onClose={() => setVueltoOrder(null)} onSent={load} />}
    </div>
  );
}