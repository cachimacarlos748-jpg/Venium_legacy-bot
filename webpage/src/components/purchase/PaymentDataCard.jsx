import { useState } from "react";
import { Copy, Check, QrCode, Wallet, ChevronDown } from "lucide-react";
import { formatPrice } from "@/lib/priceFormat";

// Tarjeta de datos de transferencia (estilo checkout del proveedor):
// cada dato en su propia caja con su botón de copiar, el total destacado
// arriba y el QR escondido detrás de "Ver imagen QR".
//
// Un solo botón de "copiar todo" obligaba al cliente a pegar y separar a mano.
// Copiar campo por campo es lo que realmente usa la gente desde el teléfono.
export default function PaymentDataCard({ methodName = "Pago Móvil", rows = [], qrUrl = "", total = null, currency = "Bs" }) {
  const [copiedKey, setCopiedKey] = useState("");
  const [showQr, setShowQr] = useState(false);

  const copy = async (key, value) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1600);
    } catch {}
  };

  const copyAll = async () => {
    const text = rows.map((r) => `${r.k}: ${r.v}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey("__all__");
      setTimeout(() => setCopiedKey(""), 1600);
    } catch {}
  };

  if (!rows.length && !qrUrl) return null;

  return (
    <div className="surface overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/60">
        <span className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <Wallet className="w-4 h-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.16em]">{methodName}</p>
          <p className="text-sm font-black text-foreground uppercase tracking-wide">Datos de transferencia</p>
        </div>
        <button
          type="button"
          onClick={copyAll}
          className="tap inline-flex items-center gap-1.5 text-[11px] font-bold text-foreground/90 bg-muted border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/60 hover:text-primary transition-colors shrink-0"
        >
          {copiedKey === "__all__"
            ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado</>
            : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Total */}
        {total != null && (
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3.5">
            <span className="text-sm text-muted-foreground font-medium">Total a pagar</span>
            <span className="num text-2xl font-black text-amber-300">
              <span className="text-sm font-bold mr-1">{currency}</span>{formatPrice(total)}
            </span>
          </div>
        )}

        {/* Un dato por caja, con su propio copiar */}
        {rows.map((r, i) => {
          const key = `${r.k}-${i}`;
          const isCopied = copiedKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => copy(key, r.v)}
              className="tap w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left hover:border-primary/50 transition-colors"
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-black text-muted-foreground uppercase tracking-[0.16em]">{r.k}</span>
                <span className="block text-base font-bold text-foreground break-all num">{r.v}</span>
              </span>
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors
                ${isCopied ? "border-emerald-500/50 bg-emerald-500/10" : "border-border bg-card"}`}>
                {isCopied ? <Check className="w-4 h-4 text-emerald-400" strokeWidth={3} /> : <Copy className="w-4 h-4 text-muted-foreground" />}
              </span>
            </button>
          );
        })}

        {/* QR opcional */}
        {qrUrl && (
          <>
            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              className="tap w-full flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 text-primary text-xs font-black uppercase tracking-wider py-3 hover:bg-primary/10 transition-colors"
            >
              <QrCode className="w-4 h-4" /> Ver imagen QR
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showQr ? "rotate-180" : ""}`} />
            </button>
            {showQr && (
              <div className="flex flex-col items-center gap-2 pt-1">
                <img src={qrUrl} alt="Código QR para pagar" className="w-44 h-44 rounded-xl bg-white p-2 object-contain" />
                <p className="text-[11px] text-muted-foreground">Escanea desde tu app bancaria</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
