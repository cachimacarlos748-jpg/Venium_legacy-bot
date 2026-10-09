import { useState } from "react";
import { Loader2, ShieldCheck, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/priceFormat";
import ReferenceField, { LegalDeclaration } from "@/components/purchase/ReferenceField";

// Ventana de "Ya pagué": referencia bancaria + WhatsApp, igual que el checkout
// del proveedor. Se quitó el comprobante porque el que confirma el pago es el
// banco (Pabilo), no una foto: al no haber imagen ya no corre la revisión de la
// captura con IA ni queda evidencia adjunta en el pedido.
//
// El monto va precargado con el total y es editable porque el bot lo usa para
// detectar pagos parciales (si pagó menos, el saldo queda como deuda).
export default function PaymentForm({ email, setEmail, whatsapp, setWhatsapp, bankRef, setBankRef, onReport, reporting, total, currency, emailDelivery }) {
  const [paid, setPaid] = useState(total ? String(total) : "");
  const [declared, setDeclared] = useState(false);
  const [showEmail, setShowEmail] = useState(!!email);
  const paidNum = Number((paid || "").replace(",", ".")) || 0;
  const isPartial = paidNum > 0 && paidNum < total;
  const debt = +Math.max(0, total - paidNum).toFixed(2);
  // El correo solo es obligatorio cuando el producto se entrega por correo.
  const emailOk = !emailDelivery || email.includes("@");
  const valid = /^\d{6,9}$/.test(bankRef) && paidNum > 0 && whatsapp.replace(/\D/g, "").length >= 8 && declared && emailOk;

  return (
    <div className="space-y-4">
      <ReferenceField value={bankRef} onChange={setBankRef} autoFocus />

      <div>
        <label className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.14em] block mb-1.5">
          Tu WhatsApp <span className="text-destructive">*</span>
        </label>
        <input
          inputMode="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="Ej: +58 412 1234567"
          className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-[11px] text-muted-foreground mt-1">Te avisamos por aquí cuando tu recarga esté lista.</p>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.14em] block mb-1.5">
            Monto pagado ({currency})
          </label>
          <input
            inputMode="decimal"
            value={paid}
            onChange={(e) => setPaid(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder={String(total)}
            className="num w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground font-mono tracking-wide focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <span className="num text-[11px] text-muted-foreground pb-3 shrink-0">
          Total {formatPrice(total)} {currency}
        </span>
      </div>
      {isPartial && (
        <p className="text-[11px] text-amber-300 font-medium -mt-2">
          Quedarás debiendo {formatPrice(debt)} {currency} y podrás completarlo luego.
        </p>
      )}

      {emailDelivery ? (
        <div>
          <label className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.14em] block mb-1.5">
            Correo de entrega <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
            className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      ) : showEmail || email ? (
        <div>
          <label className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.14em] block mb-1.5">
            Correo (opcional)
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
            className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Si lo dejas, te enviamos también el comprobante.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowEmail(true)}
          className="tap inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          <Mail className="w-3.5 h-3.5" /> Añadir correo (opcional)
        </button>
      )}

      <LegalDeclaration checked={declared} onChange={setDeclared} />

      <Button onClick={() => onReport(paidNum)} disabled={reporting || !valid} size="lg" className="w-full font-black h-14 text-base tap glow-primary">
        {reporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verificando en el banco...</> : <><ShieldCheck className="w-5 h-5 mr-2" /> Verificar pago</>}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Consultamos el banco al instante. No cierres esta ventana mientras verificamos.
      </p>
    </div>
  );
}
