import { useState, useEffect } from "react";
import { Info, Copy, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Tarjeta reutilizable con los datos del Pago Móvil (banco, titular, cédula,
// teléfono y QR) cargados desde el Setting del admin. Se muestra en la
// página de completar pago para que el cliente pueda copiarlos aunque haya
// cerrado la ventana original del flujo de compra.
export default function PagoMovilCard() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    base44.entities.Setting.filter({ key: "pago_movil" })
      .then((r) => { if (r?.[0]?.value) { try { setData(JSON.parse(r[0].value)); } catch {} } })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const rows = [
    { k: "Banco", v: data.banco },
    { k: "Titular", v: data.titular },
    { k: "Cédula", v: data.cedula },
    { k: "Teléfono", v: data.telefono },
  ].filter((r) => r.v);

  if (!rows.length && !data.qr_url) return null;

  const copyAll = async () => {
    const text = rows.map((r) => `${r.k}: ${r.v}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="bg-muted rounded-xl p-4 text-xs space-y-2 select-all">
      <div className="flex items-center gap-1.5 text-foreground font-bold mb-1">
        <Info className="w-3.5 h-3.5 text-primary" /> Datos para tu pago (Pago Móvil)
        <button
          type="button"
          onClick={copyAll}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border border-border/30 bg-card hover:border-primary/60 hover:text-primary transition-colors"
        >
          {copied ? <><Check className="w-3 h-3 text-primary" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar datos</>}
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between items-center gap-2">
          <span className="text-muted-foreground">{r.k}:</span>
          <span className="text-foreground font-medium text-right break-all">{r.v}</span>
        </div>
      ))}
      {data.qr_url && (
        <div className="pt-3 mt-2 border-t border-border/10 flex flex-col items-center gap-2">
          <img src={data.qr_url} alt="Código QR" className="w-40 h-40 rounded-lg bg-white p-1.5 object-contain" />
          <p className="text-[11px] text-muted-foreground">Escanea para pagar</p>
        </div>
      )}
    </div>
  );
}