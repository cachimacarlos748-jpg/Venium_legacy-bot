import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Home, AlertTriangle, ShieldAlert, Camera, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportErrorToSupport } from "@/lib/errorReportClient";
import { base44 } from "@/api/base44Client";
import { WA_LOGO } from "@/components/Header";
import ProcessingSticker from "@/components/purchase/ProcessingSticker";
import RedemptionGuide from "@/components/purchase/RedemptionGuide";
import { isEmailDelivery } from "@/lib/redemptionGuide";
import { formatPrice } from "@/lib/priceFormat";

const SUPPORT_IMG = WA_LOGO;

// stage: 'verifying' | 'processing' | 'done' | 'manual' | 'error'
// verifying  -> "Verificando tu pago..." (spinner)
// processing -> "Tu pago fue verificado. Procesando tu recarga..." (spinner, auto)
// done       -> "¡Recarga completada!" + confetti (auto)
// manual     -> "Tu pago fue verificado. Tu pedido está siendo procesado."
// error      -> mensaje de error + "Intentar de nuevo"
export default function VerifyModal({ open, stage, errorMsg, debugInfo, order, cur, onRetry, onHome, botErrInfo, logs, ipInfo }) {
  const [wa, setWa] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  useEffect(() => {
    if (open) { setReported(false); setReporting(false); }
  }, [open]);
  const handleReportError = async () => {
    setReporting(true);
    try {
      await reportErrorToSupport(errorMsg, {
        email: order?.customer_email,
        whatsapp: order?.customer_whatsapp,
        playerId: order?.player_id,
        bankRef: order?.bank_reference,
        ip: ipInfo?.ip,
      });
      setReported(true);
    } catch {}
    setReporting(false);
  };
  useEffect(() => {
    base44.entities.Setting.filter({ key: "support" })
      .then((recs) => {
        try {
          const p = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
          setWa((p.whatsapp || "").replace(/[^0-9]/g, ""));
        } catch {}
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (stage === "done") {
      const fire = (o) => {
        confetti({ particleCount: 80, spread: 70, startVelocity: 45, origin: o, colors: ["#6B5B95", "#9D8FBF", "#ffffff", "#A89DC5"] });
      };
      fire({ x: 0.2, y: 0.7 }); fire({ x: 0.5, y: 0.6 }); fire({ x: 0.8, y: 0.7 });
      const t = setTimeout(() => { fire({ x: 0.3, y: 0.5 }); fire({ x: 0.7, y: 0.5 }); }, 350);
      return () => clearTimeout(t);
    }
  }, [stage]);

  const isWorking = stage === "verifying" || stage === "processing";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="p-8 text-center">
              <AnimatePresence mode="wait">
                {isWorking && (
                  <motion.div key="work" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4 w-full">
                    <ProcessingSticker logs={logs} />
                    <p className="text-xs text-muted-foreground -mt-2">Esto puede tardar hasta 60 segundos.</p>
                    <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex gap-2.5 items-start text-left">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs leading-snug">
                        <p className="font-bold text-amber-300">No cierres esta pestaña</p>
                        <p className="text-amber-300/80 mt-0.5">Tu pago no se perderá pero tendrás que llenar todo de nuevo si sales.</p>
                      </div>
                    </div>
                    <div className="w-full space-y-2 text-left rounded-xl border border-border bg-muted/30 p-3">
                      {(logs || []).map((log, i) => <LogRow key={i} log={log} />)}
                      {(!logs || logs.length === 0) && (
                        <p className="text-xs text-muted-foreground">Preparando la consulta al banco…</p>
                      )}
                    </div>
                  </motion.div>
                )}

                {stage === "error" && (
                  <motion.div key="err" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4 w-full">
                    <motion.div initial={{ rotate: -30, scale: 0.3 }} animate={{ rotate: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 14 }}
                      className="relative w-24 h-24 flex items-center justify-center">
                      <motion.div className="absolute inset-0 rounded-full bg-red-500/20"
                        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }} />
                      <div className="relative w-20 h-20 rounded-full bg-red-500/15 border-2 border-red-500/40 flex items-center justify-center overflow-hidden"
                        style={{ boxShadow: "0 0 40px -5px rgba(239,68,68,0.5)" }}>
                        <img src="https://media.base44.com/images/public/6a5b9606e1931edeb474236e/92e00ddef_file_000000009444822fb424232690a5a32e.png" alt="Comprobante falso" className="w-full h-full object-contain" />
                      </div>
                    </motion.div>
                    <h2 className="text-2xl font-black text-foreground tracking-tight">Pago rechazado</h2>
                    <p className="text-sm text-muted-foreground -mt-1 px-2">{errorMsg || "Revisa el número de referencia e intenta de nuevo."}</p>
                    {ipInfo && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                        className="w-full mt-1 rounded-xl overflow-hidden border border-red-500/40"
                        style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))" }}>
                        <div className="px-4 py-2.5 bg-red-500/20 border-b border-red-500/40 flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                          <p className="text-red-300 text-xs font-black uppercase tracking-wide">Comprobante falso detectado</p>
                        </div>
                        <div className="p-4 text-left space-y-3">
                          <p className="text-red-100 text-sm font-bold leading-snug">
                            Hemos detectado una imagen falsa. Por seguridad de la tienda, esto es fraude.
                          </p>
                          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                            <p className="text-red-300/90 text-[11px] font-semibold uppercase tracking-wide mb-1.5">Tenemos tu IP y ubicación real:</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-red-200 text-sm bg-red-500/15 px-2.5 py-1 rounded-md border border-red-500/30">{ipInfo.ip}</span>
                              {ipInfo.city || ipInfo.region || ipInfo.country_name ? (
                                <span className="text-red-200/80 text-xs font-medium">📍 {[ipInfo.city, ipInfo.region, ipInfo.country_name].filter(Boolean).join(", ")}</span>
                              ) : null}
                            </div>
                          </div>
                          <p className="text-red-200/80 text-xs leading-relaxed font-medium">
                            ⚠️ Si vuelves a seguir intentando con comprobantes falsos, te vamos a reportar al banco y a las autoridades competentes.
                          </p>
                        </div>
                      </motion.div>
                    )}
                    <Button onClick={onRetry} size="lg" className="w-full font-bold h-11 mt-1">Intentar de nuevo</Button>
                    {wa && (
                      <a
                        href={`https://wa.me/${wa}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 text-white font-bold rounded-lg py-3 text-sm transition-opacity hover:opacity-90"
                        style={{ backgroundColor: "#25D366" }}
                      >
                        <img src={SUPPORT_IMG} alt="WhatsApp" className="w-5 h-5 rounded object-cover" />
                        Contactar a soporte
                      </a>
                    )}
                    <button
                      onClick={handleReportError}
                      disabled={reporting || reported}
                      className="w-full flex items-center justify-center gap-2 font-bold rounded-lg py-3 text-sm border border-border/30 bg-muted text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
                    >
                      {reported
                        ? <><CheckCircle2 className="w-4 h-4 text-green-500" /> Reporte enviado</>
                        : reporting
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando reporte...</>
                        : <><Camera className="w-4 h-4" /> Reportar con soporte</>}
                    </button>
                  </motion.div>
                )}

                {stage === "done" && (
                  <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4 w-full">
                    <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 220, damping: 12 }}
                      className="w-24 h-24 rounded-full bg-primary/15 flex items-center justify-center overflow-hidden">
                      <img src="https://media.base44.com/images/public/6a5b9606e1931edeb474236e/158b07d77_file_000000002a6881f9ab3a86c6a8cc5a4b.png" alt="¡Recarga exitosa!" className="w-full h-full object-contain" />
                    </motion.div>
                    <h2 className="text-xl font-black text-foreground">¡Recarga realizada exitosamente!</h2>
                    <p className="text-sm text-muted-foreground -mt-2">
                      {isEmailDelivery(order?.product_slug) && order?.delivery_code
                        ? "Tu código de canje está listo abajo."
                        : "Tu paquete fue aplicado a tu cuenta de juego de inmediato."}
                    </p>
                    {isEmailDelivery(order?.product_slug) && order?.delivery_code && (
                      <DeliveryCodeCard code={order.delivery_code} slug={order.product_slug} />
                    )}
                  </motion.div>
                )}

                {stage === "manual" && (
                  <motion.div key="man" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 220, damping: 12 }}
                      className="w-24 h-24 rounded-full bg-primary/15 flex items-center justify-center overflow-hidden">
                      <img src="https://media.base44.com/images/public/6a5b9606e1931edeb474236e/158b07d77_file_000000002a6881f9ab3a86c6a8cc5a4b.png" alt="¡Pago verificado!" className="w-full h-full object-contain" />
                    </motion.div>
                    <h2 className="text-xl font-black text-foreground">¡Pago verificado!</h2>
                    <p className="text-sm text-muted-foreground -mt-2">Tu recarga está en proceso. Tiempo estimado de entrega: 1 a 2 horas.</p>
                    {botErrInfo && (
                      <p className="w-full text-xs leading-snug text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                        El despacho automático no respondió temporalmente: {botErrInfo}. Tu pedido quedó en cola para procesamiento manual y el administrador fue notificado.
                      </p>
                    )}
                    {logs && logs.length > 0 && (
                      <div className="w-full mt-2 pt-3 border-t border-border/20 space-y-1.5 text-left">
                        {logs.map((l, i) => <LogRow key={i} log={l} />)}
                      </div>
                    )}
                  </motion.div>
                )}

                {stage === "partial" && order && (
                  <motion.div key="partial" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-4">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 220, damping: 12 }}
                      className="w-24 h-24 rounded-full bg-primary/15 flex items-center justify-center overflow-hidden">
                      <img src="https://media.base44.com/images/public/6a5b9606e1931edeb474236e/ddcb14da3_file_000000009ac0822fb5054ec8ab8389e4.png" alt="Pago parcial" className="w-full h-full object-contain" />
                    </motion.div>
                    <h2 className="text-xl font-black text-foreground">Pago parcial verificado</h2>
                    <p className="text-sm text-muted-foreground -mt-2">
                      Pagaste <span className="text-primary font-bold">{(order.amount_paid ?? 0).toFixed(2)} {cur}</span> de un total de <span className="text-foreground font-bold">{(order.price ?? 0).toFixed(2)} {cur}</span>.
                    </p>
                    <p className="text-sm font-bold text-primary">Te faltan {(order.balance ?? 0).toFixed(2)} {cur} para completar tu recarga.</p>
                    <p className="text-xs text-muted-foreground -mt-1">Realiza un nuevo pago por el saldo y vuelve a reportarlo con tu número de pedido.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>            {(stage === "done" || stage === "manual" || stage === "partial") && order && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                className="border-t border-border p-5 space-y-3">
                <div className="bg-muted rounded-xl p-4 text-left space-y-2 text-sm num">
                  <Row k="Producto" v={order.product_name} />
                  <Row k="Monto" v={order.denomination} />
                  {order.player_id && <Row k="ID Jugador" v={order.player_id} />}
                  <Row k="Referencia" v={order.bank_reference} />
                  <div className="flex justify-between pt-2 border-t border-border/20"><span className="text-muted-foreground">Total</span><span className="text-primary font-bold">{formatPrice(order.price ?? 0)} {cur}</span></div>
                  {stage === "partial" && (
                    <>
                      <Row k="Pagado" v={`${formatPrice(order.amount_paid ?? 0)} ${cur}`} />
                      <Row k="Saldo por pagar" v={`${formatPrice(order.balance ?? 0)} ${cur}`} />
                      <Row k="Pedido #" v={String(order.id).slice(-8)} />
                    </>
                  )}
                </div>
                {(stage === "done" || stage === "manual") && isEmailDelivery(order?.product_slug) && (
                  <RedemptionGuide slug={order.product_slug} />
                )}
                {stage === "partial" ? (
                  <Link to={`/completar-pago/${order.id}`}>
                    <Button className="w-full h-11 font-bold">Completar pago</Button>
                  </Link>
                ) : (
                  <Button onClick={onHome} className="w-full h-11 font-bold">
                    <Home className="w-4 h-4 mr-2" /> Volver al inicio
                  </Button>
                )}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DeliveryCodeCard({ code, slug }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
      className="w-full rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
      <p className="text-[11px] font-bold text-primary uppercase tracking-wide mb-2">Tu código de canje</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-lg font-black text-foreground bg-muted rounded-lg px-3 py-2.5 break-all select-all">
          {code}
        </code>
        <button onClick={handleCopy}
          className="shrink-0 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors">
          {copied ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">También enviamos este código a tu correo como respaldo.</p>
    </motion.div>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="text-foreground font-semibold text-right">{v}</span></div>;
}

function LogRow({ log }) {
  const active = log.status === "active" && log.kind === "wait";
  const dotColor =
    log.kind === "ok" ? "bg-green-400" :
    log.kind === "warn" ? "bg-amber-400" :
    "bg-amber-400";
  const textClass =
    log.kind === "ok" ? "text-green-400" :
    log.kind === "warn" ? "text-amber-300" :
    log.status === "active" ? "text-amber-300 font-medium" :
    "text-muted-foreground";
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-2.5 text-sm">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${active ? "animate-pulse" : ""}`}
        style={log.kind === "ok" ? { boxShadow: "0 0 6px rgba(74,222,128,0.6)" } : { boxShadow: "0 0 6px rgba(251,191,36,0.5)" }} />
      <span className={textClass}>{log.step}</span>
    </motion.div>
  );
}