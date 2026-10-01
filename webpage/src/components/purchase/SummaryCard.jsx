import { Zap, Clock, ShieldCheck } from "lucide-react";
import DiscountCode from "@/components/purchase/DiscountCode";
import { formatPrice } from "@/lib/priceFormat";

// Tarjeta de resumen del pedido. Se usa tanto en la columna lateral (desktop)
// como en el flujo principal (móvil). Siempre refleja el paquete seleccionado,
// el jugador verificado, el método de despacho y el total. Cuando el cliente
// paga con Binance, se muestra el total en USDT (con su equivalente en Bs).
export default function SummaryCard({
  title,
  heroImage,
  denomination,
  total,
  totalUsdt,
  isBinance,
  dispatch,
  playerId,
  server,
  nick,
  email,
  cur,
  discount,
  discountAmount,
  onApplyDiscount,
}) {
  const hasPlayer = !!playerId || !!nick;
  const isInstant = dispatch === "venium-instant" || denomination?._instant === true;

  return (
    <div className="bg-card border border-border/20 rounded-2xl p-5 shadow-lg">
      <h3 className="text-sm font-bold text-foreground uppercase tracking-wide mb-4">Resumen del pedido</h3>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border/10">
        {heroImage && (
          <img src={heroImage} alt={title} className="w-12 h-12 rounded-lg object-cover" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{title}</p>
          <p className="text-xs text-muted-foreground">
            {denomination ? denomination.label : "Selecciona un monto"}
          </p>
        </div>
        {denomination && (
          <span
            className={`ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
              isInstant
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
            }`}
          >
            {isInstant ? <Zap className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {isInstant ? "Instantáneo" : "Manual"}
          </span>
        )}
      </div>

      {hasPlayer && (
        <div className="mb-3 pb-3 border-b border-border/10">
          <p className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">Jugador</p>
          {nick && <p className="text-sm font-bold text-primary truncate">{nick}</p>}
          {playerId && (
            <p className="text-xs text-foreground font-medium">
              ID {playerId}{server ? ` · ${server}` : ""}
            </p>
          )}
        </div>
      )}

      {denomination && (
        <div className="mb-3 pb-3 border-b border-border/10">
          <DiscountCode discount={discount} onApply={onApplyDiscount} playerId={playerId} email={email} />
        </div>
      )}

      <div className="pt-2 border-t border-border/10 space-y-1.5">
        {discountAmount > 0 && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-muted-foreground line-through">
                {formatPrice(total + discountAmount)} {denomination?.currency || cur}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-green-400 font-medium">Descuento</span>
              <span className="text-green-400 font-bold">-{formatPrice(discountAmount)} {denomination?.currency || cur}</span>
            </div>
          </>
        )}
        <div className="flex items-end justify-between">
          <span className="text-foreground font-bold">Total a pagar</span>
          {denomination ? (
            isBinance ? (
              <div className="text-right">
                <span className="text-primary font-black text-lg block">{formatPrice(totalUsdt)} USDT</span>
                <span className="text-xs text-muted-foreground">≈ {formatPrice(total)} Bs</span>
              </div>
            ) : (
              <span className="text-primary font-black text-lg">
                {formatPrice(total)} {denomination.currency || cur}
              </span>
            )
          ) : (
            <span className="text-primary font-black text-lg">—</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Pago seguro
        </span>
      </div>
    </div>
  );
}