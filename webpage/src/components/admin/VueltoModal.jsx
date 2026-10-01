import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, ArrowLeftRight, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendVuelto, VENEZUELAN_BANKS } from "@/lib/pabiloChangeClient";
import { base44 } from "@/api/base44Client";

export default function VueltoModal({ order, onClose, onSent }) {
  const overpayment = Math.max(0, (order.amount_paid || 0) - (order.price || 0));
  const [amount, setAmount] = useState(overpayment > 0 ? overpayment.toFixed(2) : "");
  const [dniCode, setDniCode] = useState("V");
  const [dniNumber, setDniNumber] = useState("");
  const [phone, setPhone] = useState((order.customer_whatsapp || "").replace(/\D/g, ""));
  const [bankCode, setBankCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const invoiceNumber = String(order.id || "").replace(/\D/g, "").slice(-8) || String(Date.now()).slice(-8);

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    const res = await sendVuelto({
      amount: parseFloat(amount),
      dniCode,
      dniNumber,
      phonePagador: phone,
      destinationBankCode: bankCode,
      invoiceNumber,
    });

    if (res.ok) {
      const logEntry = {
        amount: parseFloat(amount),
        reference: res.reference,
        authorization_code: res.authorization_code,
        status: res.status,
        destination_bank: bankCode,
        recipient_phone: phone,
        recipient_dni: `${dniCode}-${dniNumber}`,
        timestamp: new Date().toISOString(),
      };
      try {
        const existingLog = order.vuelto_log || [];
        await base44.entities.Order.update(order.id, {
          vuelto_log: [...existingLog, logEntry],
        });
      } catch (e) {
        console.warn("No se pudo registrar el vuelto en el pedido:", e);
      }
      if (onSent) onSent();
    }

    setResult(res);
    setLoading(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-card border border-border/30 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-border/20 sticky top-0 bg-card z-10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-bold text-foreground">Devolver Vuelto</h3>
            </div>
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {result ? (
            <div className="p-6 text-center">
              {result.ok ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <h4 className="text-base font-bold text-foreground mb-2">¡Vuelto enviado!</h4>
                  <p className="text-xs text-muted-foreground mb-4">
                    Se devolvieron <span className="font-bold text-foreground">Bs. {parseFloat(amount).toFixed(2)}</span> al cliente.
                  </p>
                  <div className="bg-muted/50 rounded-lg p-3 text-left space-y-1.5 mb-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Referencia:</span>
                      <span className="font-mono text-foreground">{result.reference || "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Código auth:</span>
                      <span className="font-mono text-foreground">{result.authorization_code || "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Estado:</span>
                      <span className="text-green-500 font-bold">{result.status}</span>
                    </div>
                  </div>
                  <Button onClick={onClose} className="w-full">Listo</Button>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-8 h-8 text-red-500" />
                  </div>
                  <h4 className="text-base font-bold text-foreground mb-2">No se pudo enviar</h4>
                  <p className="text-xs text-muted-foreground mb-4">{result.error}</p>
                  <Button variant="secondary" onClick={() => setResult(null)} className="w-full mb-2">Intentar de nuevo</Button>
                  <Button variant="ghost" onClick={onClose} className="w-full">Cerrar</Button>
                </>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Producto:</span>
                  <span className="font-bold text-foreground truncate ml-2 max-w-[60%]">{order.product_name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Total pedido:</span>
                  <span className="text-foreground">Bs. {(order.price || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Pagado:</span>
                  <span className="text-foreground">Bs. {(order.amount_paid || 0).toFixed(2)}</span>
                </div>
                {overpayment > 0 && (
                  <div className="flex justify-between text-xs pt-1 border-t border-border/20">
                    <span className="text-primary font-bold">Sobrante:</span>
                    <span className="text-primary font-bold">Bs. {overpayment.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Monto a devolver (Bs)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <p className="text-xs text-muted-foreground font-medium">Datos del cliente para el Pago Móvil:</p>

              <div className="flex gap-2">
                <div className="w-16">
                  <label className="text-xs text-muted-foreground mb-1 block">Cédula</label>
                  <select
                    value={dniCode}
                    onChange={(e) => setDniCode(e.target.value)}
                    className="w-full bg-input border border-border/30 rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  >
                    {["V", "E", "J", "P", "G"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Número</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="12345678"
                    value={dniNumber}
                    onChange={(e) => setDniNumber(e.target.value.replace(/\D/g, ""))}
                    className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Teléfono del cliente</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="04141234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Banco del cliente</label>
                <select
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">Selecciona el banco…</option>
                  {VENEZUELAN_BANKS.map((b) => <option key={b.code} value={b.code}>{b.name} ({b.code})</option>)}
                </select>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={loading || !amount || !dniNumber || !phone || !bankCode}
                className="w-full"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando…</>
                ) : (
                  <><ArrowLeftRight className="w-4 h-4 mr-2" /> Enviar Bs. {parseFloat(amount || 0).toFixed(2)}</>
                )}
              </Button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}