import { useState } from "react";
import { Ticket, Loader2, Check, X } from "lucide-react";
import { validateDiscountCode } from "@/lib/discountClient";

// Campo de código de descuento en el checkout. Si el código es válido (Setting
// discount_<CODE>), aplica el descuento sobre el total del pedido. El total
// final lo recibe Comprar.jsx vía onApply() y se recalcula usando
// computeDiscount desde discountClient.
export default function DiscountCode({ discount, onApply }) {
  const [code, setCode] = useState(discount?.code || "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const apply = async () => {
    setErr("");
    setLoading(true);
    const r = await validateDiscountCode(code);
    setLoading(false);
    if (r.error) {
      setErr(r.error);
      onApply(null);
      return;
    }
    onApply(r);
  };

  if (discount?.applied) {
    return (
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
    </div>
  );
}