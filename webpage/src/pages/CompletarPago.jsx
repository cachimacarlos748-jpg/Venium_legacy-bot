import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Loader2, ShieldCheck, CheckCircle2, Clock, Wallet, Upload, X, AlertCircle,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { verifyPayment, friendlyPabiloError } from "@/lib/pabiloClient";
import { meta as botMeta } from "@/lib/nexusProducts";
import { NexusBot } from "@/lib/nexusBotClient";
import { notifyTelegramOrder } from "@/lib/telegramClient";
import { useReceiptUpload } from "@/components/purchase/ReceiptStep";
import { Button } from "@/components/ui/button";
import PagoMovilCard from "@/components/purchase/PagoMovilCard";
import ReferenceField, { LegalDeclaration } from "@/components/purchase/ReferenceField";
import { removePendingOrder } from "@/lib/pendingPayments";

const CUR = "Bs";
const fadeIn = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

// Página para saldar el saldo de un pedido con pago parcial.
// El cliente accede con el enlace que se le mostró en el modal de verificación
// (compartido por WhatsApp o copiado de pantalla). Aquí reporta un nuevo pago
// por el saldo restante; al completar la deuda, disparamos la recarga.
export default function CompletarPago() {
  const { orderId } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [bankRef, setBankRef] = useState("");
  const [paidStr, setPaidStr] = useState("");
  const [declared, setDeclared] = useState(false);
  const [lastPayment, setLastPayment] = useState(null);
  const receipt = useReceiptUpload();

  // stage: 'idle' | 'verifying' | 'processing' | 'partial' | 'done' | 'manual' | 'error'
  const [stage, setStage] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const o = await base44.entities.Order.get(orderId);
        if (!active) return;
        if (!o) { setLoadError("No encontramos este pedido. Verifica el enlace que recibiste."); setLoading(false); return; }
        setOrder(o);
        if (o.status === "completed") setStage("done");
        else if (o.status === "pending" || o.status === "processing") setStage("manual");
        else if (o.status === "cancelled") setStage("error");
        else if (o.status === "partial_payment") { setStage("partial"); setPaidStr(String((o.balance ?? 0) > 0 ? o.balance : "")); }
        else setStage("partial");
        if (o.status !== "partial_payment") { try { removePendingOrder(orderId); } catch {} }
      } catch (e) {
        if (!active) return;
        setLoadError(e.message || "No se pudo cargar el pedido.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [orderId]);

  const totalRequired = Number(order?.price) || 0;
  const alreadyPaid = Number(order?.amount_paid) || 0;
  const balance = +Math.max(0, totalRequired - alreadyPaid).toFixed(2);
  const paidNum = Number((paidStr || "").replace(",", ".")) || 0;
  const valid = /^\d{6,9}$/.test(bankRef) && paidNum > 0 && declared;

  const handleReport = async () => {
    if (!valid) return;
    setErrorMsg("");
    setLastPayment(null);
    setStage("verifying");

    // Chequeo local anti-fraude: una referencia bancaria sólo se puede usar
    // una vez. Se valida EN el pedido actual (incluye el log de pagos
    // previos) Y en cualquier otro pedido de la tienda, antes de llamar a
    // Pabilo.
    try {
      const inCurrentLog = Array.isArray(order.payment_log)
        ? order.payment_log.some((p) => p.reference === bankRef)
        : false;
      const existing = inCurrentLog ? [] : (await base44.entities.Order.filter({ bank_reference: bankRef }) || []);
      const dupes = Array.isArray(existing) ? existing.filter((o) => o.id !== order.id) : [];
      if (inCurrentLog || dupes.length > 0) {
        setStage("error");
        setErrorMsg("Esta referencia ya fue utilizada en un pago anterior.");
        return;
      }
    } catch {}

    const res = await verifyPayment(bankRef, paidNum);
    if (!res.ok || res.is_new === false) {
      setStage("error");
      setErrorMsg(res.is_new === false ? "Esta referencia ya fue utilizada anteriormente." : friendlyPabiloError(res));
      return;
    }

    const newPaid = +Number(alreadyPaid + paidNum).toFixed(2);
    const newBalance = +Math.max(0, totalRequired - newPaid).toFixed(2);
    const baseLog = Array.isArray(order.payment_log) ? [...order.payment_log] : [];
    const newLog = baseLog.concat([{ reference: bankRef, amount: paidNum, receipt_url: receipt.receiptUrl || "", timestamp: new Date().toISOString() }]);
    const payload = {
      amount_paid: newPaid,
      balance: newBalance,
      receipt_url: receipt.receiptUrl || order.receipt_url || "",
      payment_log: newLog,
    };

    if (newBalance <= 0) {
      // Saldo cubierto: si el pedido es de despacho automático, llamamos al bot.
      const botKey = order.bot_product || "";
      const auto = !!botKey;
      if (auto) {
        setStage("processing");
        let botResult = null;
        try { botResult = await NexusBot.recargar({ producto: botKey, id_juego: order.player_id }); }
        catch (e) { botResult = { error: e?.message || "El bot no respondió" }; }
        const botSuccess = botResult && !botResult.error;
        payload.status = botSuccess ? "completed" : "pending";
        payload.bot_tx_id = botResult?.tx_id || botResult?.id || order.bot_tx_id || "";
        if (botSuccess && botMeta(botKey)?.tipo === "nivel") {
          try {
            await base44.entities.RechargeRecord.create({
              player_id: order.player_id, producto: botKey,
              producto_nombre: botMeta(botKey).nombre, producto_tipo: "nivel",
              tx_id: botResult.tx_id || botResult.id || "", amount: String(order.price), status: "completed",
            });
          } catch {}
        }
        setStage(botSuccess ? "done" : "manual");
      } else {
        payload.status = "pending";
        setStage("manual");
      }
    } else {
      payload.status = "partial_payment";
      setStage("partial");
    }

    try {
      const updated = await base44.entities.Order.update(order.id, payload);
      setOrder(updated);
      if (newBalance <= 0) {
        notifyTelegramOrder(updated, { dispatch: order.bot_product ? "bot" : "manual", currency: CUR }).catch(() => {});
        try { removePendingOrder(order.id); } catch {}
      } else {
        notifyTelegramOrder(updated, { dispatch: "partial", currency: CUR }).catch(() => {});
        setLastPayment({ amount: paidNum, balance: newBalance });
        setBankRef("");
        setPaidStr(String(newBalance));
        receipt.clear();
      }
    } catch (e) {
      setStage("error");
      setErrorMsg(e.message || "No se pudo actualizar el pedido. Intenta de nuevo.");
    }
  };

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-background min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mb-3" />
        <p className="text-sm text-foreground mb-4">{loadError}</p>
        <Link to="/" className="text-primary text-sm underline">Volver al inicio</Link>
      </div>
    );
  }

  if (!order) return null;

  const showPartialForm = order.status === "partial_payment" && stage !== "verifying" && stage !== "processing";

  return (
    <div className="bg-background min-h-screen pb-20">
      <div className="border-b border-border/20 bg-card">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary text-sm transition-colors mb-3">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>
          <h1 className="text-xl sm:text-2xl font-black text-foreground flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" /> Completar pago
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Pedido #{String(order.id || "").slice(-8)}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 mt-6 space-y-5">
        {/* Resumen del pedido */}
        <div className="bg-card border border-border/60 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-3">Resumen del pedido</h2>
          <div className="flex items-center gap-3 mb-3">
            {order.product_image_url && <img src={order.product_image_url} alt={order.product_name} className="w-12 h-12 rounded-lg object-cover" />}
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{order.product_name}</p>
              <p className="text-xs text-muted-foreground">{order.denomination}</p>
            </div>
          </div>
          <div className="space-y-1.5 text-xs border-t border-border/10 pt-3">
            {order.player_id && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID Jugador</span>
                <span className="text-foreground font-medium">{order.player_id}{order.server ? ` · ${order.server}` : ""}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="text-foreground font-bold">{totalRequired.toFixed(2)} {CUR}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pagado</span>
              <span className="text-primary font-bold">{alreadyPaid.toFixed(2)} {CUR}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saldo pendiente</span>
              <span className={balance > 0 ? "text-primary font-bold" : "text-primary font-bold"}>{balance.toFixed(2)} {CUR}</span>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {order.status === "completed" && (
            <motion.div key="done" {...fadeIn} className="bg-card border border-border/60 rounded-2xl p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-10 h-10 text-primary" strokeWidth={2.5} />
              </div>
              <h2 className="text-lg font-black text-foreground">¡Recarga realizada exitosamente!</h2>
              <p className="text-sm text-muted-foreground mt-1">Tu paquete fue aplicado a tu cuenta de juego.</p>
              <Link to="/" className="inline-block mt-4"><Button className="font-bold">Volver al inicio</Button></Link>
            </motion.div>
          )}

          {(order.status === "pending" || order.status === "processing") && (
            <motion.div key="manual" {...fadeIn} className="bg-card border border-border/60 rounded-2xl p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
                <Clock className="w-10 h-10 text-primary" strokeWidth={2.5} />
              </div>
              <h2 className="text-lg font-black text-foreground">¡Pago completado!</h2>
              <p className="text-sm text-muted-foreground mt-1">Tu recarga está en proceso. Tiempo estimado de entrega: 1 a 2 horas.</p>
              <p className="text-xs text-muted-foreground mt-2">Te avisaremos cuando esté lista.</p>
              <Link to="/" className="inline-block mt-4"><Button className="font-bold">Volver al inicio</Button></Link>
            </motion.div>
          )}

          {order.status === "cancelled" && (
            <motion.div key="cancelled" {...fadeIn} className="bg-card border border-border/60 rounded-2xl p-6 text-center">
              <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Este pedido fue cancelado. Si crees que es un error, contáctanos por WhatsApp.</p>
              <Link to="/" className="inline-block mt-4"><Button className="font-bold">Volver al inicio</Button></Link>
            </motion.div>
          )}

          {showPartialForm && (
            <motion.div key="partial-form" {...fadeIn} className="bg-card border border-border/60 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-1">Reportar pago del saldo</h2>
              <p className="text-xs text-muted-foreground mb-3">Pagaste <span className="text-primary font-bold">{alreadyPaid.toFixed(2)} {CUR}</span>. Te falta <span className="text-primary font-bold">{balance.toFixed(2)} {CUR}</span>.</p>
              {order.payment_method && <p className="text-xs text-muted-foreground mb-3">Usa el mismo método de pago ({order.payment_method}) para enviar el saldo restante.</p>}

              <div className="mb-4">
                <PagoMovilCard total={balance} />
              </div>

              {lastPayment && (
                <div className="mb-3 rounded-lg bg-primary/10 p-3 text-sm text-foreground">
                  <p>¡Recibimos tu pago de <span className="text-primary font-bold">{lastPayment.amount.toFixed(2)} {CUR}</span>!</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Aún falta <span className="text-primary font-bold">{lastPayment.balance.toFixed(2)} {CUR}</span> para completar tu recarga.</p>
                </div>
              )}

              {stage === "error" && errorMsg && (
                <div className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive text-left">{errorMsg}</div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Monto a pagar ahora ({CUR})</label>
                  <input
                    inputMode="decimal"
                    value={paidStr}
                    onChange={(e) => setPaidStr(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                    placeholder={String(balance)}
                    className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground font-mono tracking-wide focus:outline-none focus:border-primary transition-colors"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Saldo pendiente: <span className="text-foreground font-bold">{balance.toFixed(2)} {CUR}</span></p>
                </div>

                <ReferenceField value={bankRef} onChange={setBankRef} />

                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Comprobante (opcional, recomendado)</label>
                  {receipt.receiptUrl ? (
                    <div className="flex items-center justify-between bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm">
                      <span className="text-foreground truncate">{receipt.fileName || "Comprobante adjuntado"}</span>
                      <button onClick={receipt.clear} className="text-destructive hover:bg-destructive/10 rounded p-1"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer bg-muted border border-dashed border-border/40 rounded-lg px-3 py-3 text-sm text-muted-foreground hover:border-primary transition-colors">
                      {receipt.uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {receipt.uploading ? "Subiendo..." : "Adjuntar imagen del comprobante"}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => e.target.files?.[0] && receipt.upload(e.target.files[0])} />
                    </label>
                  )}
                </div>

                <LegalDeclaration checked={declared} onChange={setDeclared} />

                <Button onClick={handleReport} disabled={!valid} size="lg" className="w-full font-black h-14 text-base tap glow-primary">
                  <ShieldCheck className="w-5 h-5 mr-2" /> Verificar pago
                </Button>
              </div>
            </motion.div>
          )}

          {order.status === "partial_payment" && stage === "verifying" && (
            <motion.div key="verifying" {...fadeIn} className="bg-card border border-border/60 rounded-2xl p-8 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
              <p className="text-base font-bold text-foreground">Verificando tu pago...</p>
              <p className="text-xs text-muted-foreground mt-1">No cierres esta ventana.</p>
            </motion.div>
          )}

          {order.status === "partial_payment" && stage === "processing" && (
            <motion.div key="processing" {...fadeIn} className="bg-card border border-border/60 rounded-2xl p-8 text-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
              <p className="text-base font-bold text-foreground">Pago verificado. Realizando recarga, por favor espere...</p>
              <p className="text-xs text-muted-foreground mt-1">No cierres esta ventana.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}