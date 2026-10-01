import { useState } from "react";
import { Ticket, Loader2, Check, X, UserCheck, AlertTriangle } from "lucide-react";
import { validateDiscountCode } from "@/lib/discountClient";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Campo de código de descuento en el checkout. Si el código es válido (Setting
// discount_<CODE>), aplica el descuento sobre el total del pedido. El total
// final lo recibe Comprar.jsx vía onApply() y se recalcula usando
// computeDiscount desde discountClient.
//
// Los códigos marcados como `new_customer_only` (los que se publican en la
// publicidad) se validan contra el historial de pedidos: si la persona ya
// compró, se muestra una ventana explicando que el código es solo para la
// primera compra en vez de un error seco de "código inválido".
export default function DiscountCode({ discount, onApply, playerId, email }) {
  const [code, setCode] = useState(discount?.code || "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(null);

  const apply = async () => {
    setErr("");
    setLoading(true);
    const r = await validateDiscountCode(code, { playerId, email });
    setLoading(false);

    if (r.error) {
      onApply(null);
      // El cliente ya compró: merece una explicación clara, no un "código inválido"
      // que lo haga pensar que la tienda está fallando.
      if (r.reason === "not_new" || r.reason === "need_identity") {
        setNotice({ title: r.reason === "need_identity" ? "Falta un dato" : "Ya eres cliente", message: r.error });
        setErr("");
      } else {
        setErr(r.error);
      }
      return;
    }
    setNotice(null);
    onApply(r);
  };

  if (discount?.applied) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2.5 text-sm">
          <span className="text-green-300 flex items-center gap-1.5 flex-1 min-w-0">
            <Check className="w-4 h-4 shrink-0" />
            <span className="font-bold">Código aplicado: </span>
            <span className="font-mono font-bold truncate">{discount.code}</span>
            <span className="text-muted-foreground text-xs">
              ({discount.kind === "percent" ? `-${discount.value}%` : `-${discount.value} Bs`})
            </span>
          </span>
          <button
            type="button"
            onClick={() => { onApply(null); setCode(""); setErr(""); }}
            className="text-destructive hover:bg-destructive/10 rounded p-1 ml-2"
            aria-label="Quitar código"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {discount.new_customer_only && (
          <p className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium">
            <UserCheck className="w-3 h-3 shrink-0" /> Bienvenida: primera compra con este código.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
        <Ticket className="w-3.5 h-3.5" /> Código de descuento (opcional)
      </label>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Ej: LEGACY10"
          className="flex-1 bg-muted border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground font-mono tracking-wide focus:outline-none focus:border-primary transition-colors"
        />
        <button
          type="button"
          onClick={apply}
          disabled={loading || !code.trim()}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
          {loading ? "..." : "Aplicar"}
        </button>
      </div>
      {err && <p className="text-destructive text-xs mt-1">{err}</p>}

      <Dialog open={!!notice} onOpenChange={(open) => { if (!open) setNotice(null); }}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2">
            {notice?.title === "Ya eres cliente" ? (
              <UserCheck className="w-5 h-5 text-primary" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
            {notice?.title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {notice?.message}
          </DialogDescription>
          {notice?.title === "Ya eres cliente" && (
            <p className="text-xs text-muted-foreground">
              ¿Prefieres otro método de pago o quieres hablar con nosotros por WhatsApp?
              Escríbenos al <span className="text-primary font-semibold">0422-2896623</span> y te ayudamos.
            </p>
          )}
          <DialogFooter>
            <Button onClick={() => setNotice(null)} className="w-full sm:w-auto">
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}