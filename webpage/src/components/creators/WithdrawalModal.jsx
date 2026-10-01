import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, Loader2, AlertTriangle, Check, Banknote, Smartphone, Bitcoin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestWithdrawal, getCommissionConfig, DEFAULT_PAYOUT_THRESHOLD } from "@/lib/creatorCommission";

const METHODS = [
  { id: "Pago Móvil", label: "Pago Móvil", icon: Smartphone, placeholder: "Banco, teléfono, cédula (ej: BDV 0424-1234567 V-12.345.678)" },
  { id: "Binance", label: "Binance Pay", icon: Bitcoin, placeholder: "Tu ID de Binance Pay (ej: 123456789)" },
  { id: "Transferencia", label: "Transferencia bancaria", icon: Banknote, placeholder: "Banco, cuenta, cédula (ej: BDV 0102-0123-45-678 V-12.345.678)" },
  { id: "Otro", label: "Otro", icon: Wallet, placeholder: "Indica cómo quieres recibir el pago" },
];

export default function WithdrawalModal({ open, onClose, creator, onRequested }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Pago Móvil");
  const [bankInfo, setBankInfo] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_PAYOUT_THRESHOLD);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const balance = creator?.balance || 0;
  const activeMethod = METHODS.find((m) => m.id === method) || METHODS[0];

  useEffect(() => {
    if (!open) return;
    getCommissionConfig().then((cfg) => setThreshold(cfg.threshold || DEFAULT_PAYOUT_THRESHOLD)).catch(() => {});
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Ingresa un monto válido"); return; }
    if (amt > balance) { setErr("No tienes suficiente balance"); return; }
    if (amt < threshold) { setErr(`El mínimo de retiro es ${threshold} Bs`); return; }
    if (!bankInfo.trim()) { setErr("Ingresa tus datos bancarios para recibir el pago"); return; }

    setSubmitting(true);
    try {
      await requestWithdrawal(creator.id, { amount: amt, method, bank_info: bankInfo.trim() });
      setOk(true);
      setTimeout(() => {
        setOk(false);
        setAmount(""); setBankInfo("");
        onClose();
        onRequested?.();
      }, 1500);
    } catch (e2) {
      setErr(e2.message || "No se pudo procesar la solicitud");
    }
    setSubmitting(false);
  };

  const inputCls = "w-full bg-muted border border-border/30 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary transition-colors";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%", opacity: 0.7 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="max-w-md w-full bg-card border border-border/30 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-card border-b border-border/20 px-5 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-foreground">Solicitar retiro</h3>
                  <p className="text-[11px] text-muted-foreground">Balance: <span className="text-primary font-bold">{balance.toFixed(2)} Bs</span></p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {ok ? (
              <div className="p-8 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 12 }}
                  className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-green-400" />
                </motion.div>
                <h3 className="text-lg font-black text-foreground">¡Solicitud enviada!</h3>
                <p className="text-sm text-muted-foreground mt-1">El admin revisará tu solicitud y te contactará para procesar el pago.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {/* Monto */}
                <div>
                  <label className="text-xs text-muted-foreground font-bold uppercase tracking-wide mb-2 block">Monto a retirar (Bs)</label>
                  <div className="relative">
                    <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00" inputMode="decimal"
                      className={inputCls + " pr-16 text-lg font-bold"} />
                    <button type="button" onClick={() => setAmount(String(balance))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg hover:bg-primary/20 transition-colors">
                      Máximo
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">Mínimo de retiro: {threshold} Bs</p>
                </div>

                {/* Método */}
                <div>
                  <label className="text-xs text-muted-foreground font-bold uppercase tracking-wide mb-2 block">Método de pago</label>
                  <div className="grid grid-cols-2 gap-2">
                    {METHODS.map((m) => (
                      <button key={m.id} type="button" onClick={() => setMethod(m.id)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all ${method === m.id ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-muted-foreground hover:border-border/50"}`}>
                        <m.icon className="w-4 h-4" /> {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Datos bancarios */}
                <div>
                  <label className="text-xs text-muted-foreground font-bold uppercase tracking-wide mb-2 block">Datos para recibir el pago</label>
                  <textarea value={bankInfo} onChange={(e) => setBankInfo(e.target.value)}
                    placeholder={activeMethod.placeholder} rows={3}
                    className={inputCls + " resize-none"} />
                </div>

                {/* Resumen */}
                <div className="bg-muted/30 border border-border/20 rounded-xl p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Balance actual</span><span className="font-bold text-foreground">{balance.toFixed(2)} Bs</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">A retirar</span><span className="font-bold text-primary">{(Number(amount) || 0).toFixed(2)} Bs</span></div>
                  <div className="flex justify-between border-t border-border/20 pt-1.5"><span className="text-muted-foreground">Balance después</span><span className="font-bold text-foreground">{(balance - (Number(amount) || 0)).toFixed(2)} Bs</span></div>
                </div>

                {err && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {err}
                  </div>
                )}

                <Button type="submit" disabled={submitting} className="w-full h-12 font-bold text-base">
                  {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</> : <><Wallet className="w-4 h-4 mr-2" /> Solicitar retiro</>}
                </Button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}