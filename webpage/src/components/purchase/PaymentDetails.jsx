import { useState } from "react";
import { Info, Copy, Check, QrCode } from "lucide-react";
import { getMethodFields } from "@/lib/paymentMethods";

// Muestra los datos de cuenta del método seleccionado (campos fijos por tipo).
// - Pago Móvil: incluye botón "Copiar datos" y slot para código QR.
export default function PaymentDetails({ method, fallback }) {
  const fields = getMethodFields(method);

  const isPagoMovil =
    method?.id === "pago-movil" ||
    method?.type === "pago_movil" ||
    /pago\s*m[oó]vil/i.test(method?.name || "");
  const isBinance =
    method?.id === "binance" ||
    method?.type === "binance" ||
    /binance/i.test(method?.name || "");
  const showQR = isPagoMovil || isBinance;

  const qrUrl = method?.qr_url || fallback?.qr_url || "";

  let rows = fields.map((f) => ({ k: f.label, v: f.value }));
  if (!rows.length && isPagoMovil && fallback) {
    rows = [
      { k: "Banco", v: fallback.banco },
      { k: "Titular", v: fallback.titular },
      { k: "Cédula", v: fallback.cedula },
      { k: "Teléfono", v: fallback.telefono },
    ].filter((r) => r.v);
  }

  if (!rows.length && !(showQR && qrUrl)) return null;

  return <Block rows={rows} copyable={isPagoMovil} showQR={showQR} qrUrl={qrUrl} />;
}

function Block({ rows, copyable, showQR, qrUrl }) {
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    const text = rows.map((r) => `${r.k}: ${r.v}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="mt-3 bg-muted rounded-lg p-3.5 text-xs space-y-1.5 select-all">
      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-foreground font-bold mb-1.5">
            <Info className="w-3.5 h-3.5 text-primary" /> Datos para tu pago
            {copyable && (
              <button
                type="button"
                onClick={copyAll}
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border border-border/30 bg-card hover:border-primary/60 hover:text-primary transition-colors"
              >
                {copied ? <><Check className="w-3 h-3 text-primary" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar datos</>}
              </button>
            )}
          </div>
          {rows.map((r, idx) => (
            <div key={idx} className="flex justify-between items-center gap-2">
              <span className="text-muted-foreground">{r.k}: </span>
              <span className="text-foreground font-medium text-right break-all">{r.v}</span>
            </div>
          ))}
        </>
      )}
      {showQR && (
        <div className="pt-3 mt-2 border-t border-border/10 flex flex-col items-center gap-2">
          {qrUrl ? (
            <img src={qrUrl} alt="Código QR" className="w-40 h-40 rounded-lg bg-white p-1.5 object-contain" />
          ) : (
            <div className="w-40 h-40 rounded-lg border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <QrCode className="w-10 h-10" />
              <span className="text-[11px] text-center px-2">Código QR</span>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Escanea para pagar</p>
        </div>
      )}
    </div>
  );
}