import { useState } from "react";
import { Upload, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/priceFormat";

// Formulario de datos del pago (PASO 6): referencia + comprobante + correo +
// monto que pagó el cliente. Si el cliente paga menos del total, el pedido
// se marca como pago parcial y el saldo queda registrado para saldar después.
export default function PaymentForm({ email, setEmail, whatsapp, setWhatsapp, bankRef, setBankRef, receipt, onReport, reporting, total, currency, emailDelivery }) {
  const [paid, setPaid] = useState(total ? String(total) : "");
  const paidNum = Number((paid || "").replace(",", ".")) || 0;
  const isPartial = paidNum > 0 && paidNum < total;
  const debt = +Math.max(0, total - paidNum).toFixed(2);
  const valid = /^\d{6,9}$/.test(bankRef) && email.includes("@") && paidNum > 0 && whatsapp.replace(/\D/g, "").length >= 8;
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Número de referencia</label>
        <input
          inputMode="numeric"
          value={bankRef}
          onChange={(e) => setBankRef(e.target.value.replace(/\D/g, "").slice(0, 9))}
          placeholder="6 a 9 dígitos"
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground font-mono tracking-wide focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">El número de referencia que generó tu banco al hacer el pago.</p>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Monto que pagaste ({currency})</label>
        <input
          inputMode="decimal"
          value={paid}
          onChange={(e) => setPaid(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          placeholder={String(total)}
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground font-mono tracking-wide focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">Total del pedido: <span className="text-foreground font-bold">{formatPrice(total)} {currency}</span>. Si pagaste un monto distinto, ajústalo aquí.</p>
        {isPartial && (
          <p className="text-xs text-primary font-medium mt-1">Quedarás debiendo {formatPrice(debt)} {currency} y podrás completar el pago luego.</p>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Comprobante (opcional, recomendado)</label>
        {receipt.receiptUrl ? (
          <div className="flex items-center justify-between bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm">
            <span className="text-foreground truncate">{receipt.fileName || "Comprobante adjuntado"}</span>
            <button onClick={receipt.clear} className="text-destructive hover:bg-destructive/10 rounded p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 cursor-pointer bg-muted border border-dashed border-border/40 rounded-lg px-3 py-3 text-sm text-muted-foreground hover:border-primary transition-colors">
            {receipt.uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {receipt.uploading ? "Subiendo..." : "Adjuntar imagen del comprobante"}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && receipt.upload(e.target.files[0], ` · Ref: ${bankRef || "—"} · ${email || "—"}`)} />
          </label>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">{emailDelivery ? "Correo de entrega" : "Correo electrónico"}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">{emailDelivery ? "Tu código será enviado a este correo." : "Haremos llegar tu recarga y el comprobante a este correo."}</p>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">WhatsApp <span className="text-primary">*</span></label>
        <input
          inputMode="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="Ej: +58 412 1234567"
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">Te avisaremos por WhatsApp cuando tu recarga esté lista.</p>
      </div>

      <Button onClick={() => onReport(paidNum)} disabled={reporting || !valid} size="lg" className="w-full font-bold h-12">
        {reporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</> : <><ShieldCheck className="w-4 h-4 mr-2" /> Reportar pago</>}
      </Button>
    </div>
  );
}