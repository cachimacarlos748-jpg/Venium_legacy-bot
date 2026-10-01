import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, AlertTriangle, Lock, Zap, User, Package, ArrowRight, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { NexusBot, hasConfig } from "@/lib/nexusBotClient";
import { PRODUCT_MAP, isOncePerId, meta, LEVEL_PRODUCTS, BOT_PRODUCT_KEYS } from "@/lib/nexusProducts";
import ProcessingSticker from "@/components/purchase/ProcessingSticker";

const R = base44.entities.RechargeRecord;

export default function RecargarTab({ status, connErr, onRefresh }) {
  const [sel, setSel] = useState(null);
  const [playerId, setPlayerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [block, setBlock] = useState(false);
  const [checkingId, setCheckingId] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stage, setStage] = useState("idle"); // idle | processing | done | error
  const logTimerRef = useRef(null);
  const espSecRef = useRef(0);

  const stopEspTimer = () => {
    if (logTimerRef.current) { clearInterval(logTimerRef.current); logTimerRef.current = null; }
  };
  const startEspTimer = (idx) => {
    stopEspTimer();
    espSecRef.current = 0;
    const t0 = Date.now();
    logTimerRef.current = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      espSecRef.current = sec;
      setLogs((cur) => {
        const next = cur.slice();
        if (next[idx]) next[idx] = { ...next[idx], step: `Esperando respuesta ${sec}s...` };
        return next;
      });
    }, 1000);
  };

  // El bot no expone lista de productos en /health, así que usamos la lista
  // estática de nexusProducts.js como base.
  const products = status?.productos?.length ? status.productos : BOT_PRODUCT_KEYS;
  const pases = products.filter((p) => PRODUCT_MAP[p]?.tipo === "pase");
  const niveles = products.filter((p) => LEVEL_PRODUCTS.includes(p));
  const otros = products.filter((p) => !pases.includes(p) && !niveles.includes(p));

  async function checkBlock(producto, pid) {
    setCheckingId(true);
    setBlock(false);
    try {
      const recs = await R.filter({ player_id: pid, producto }).catch(() => []);
      if (recs?.some((r) => r.status === "completed")) setBlock(true);
    } finally {
      setCheckingId(false);
    }
  }

  useEffect(() => {
    if (sel && isOncePerId(sel) && playerId.trim()) {
      const t = setTimeout(() => checkBlock(sel, playerId.trim()), 250);
      return () => clearTimeout(t);
    }
    setBlock(false);
  }, [sel, playerId]);

  // Limpieza del cronómetro al desmontar
  useEffect(() => () => stopEspTimer(), []);

  if (!hasConfig()) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-amber-400" />
        </div>
        <p className="text-sm text-muted-foreground max-w-xs">
          Ve a la pestaña <b className="text-foreground">Config Bot</b> para conectar el NEXUS Razer Bot.
        </p>
      </div>
    );
  }

  if (!status && connErr) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-xs">{connErr}</p>
        <button onClick={onRefresh} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-semibold">
          <Loader2 className="w-4 h-4" /> Reintentar conexión
        </button>
      </div>
    );
  }

  async function recarga() {
    if (!sel || !playerId.trim()) return;
    setBusy(true);
    setResult(null);
    setStage("processing");

    // L1 — Conectando con el bot
    setLogs([{ step: "Conectando con el sistema...", kind: "wait", status: "active" }]);
    await new Promise((r) => setTimeout(r, 500));

    // L2 — Enviando pedido al servidor
    setLogs([
      { step: "Conectando con el bot...", kind: "ok", status: "done" },
      { step: "Enviando pedido al servidor...", kind: "wait", status: "active" },
    ]);
    await new Promise((r) => setTimeout(r, 400));

    // L3 — Esperando respuesta (contador en vivo)
    setLogs([
      { step: "Conectando con el bot...", kind: "ok", status: "done" },
      { step: "Enviando pedido al servidor...", kind: "ok", status: "done" },
      { step: "Esperando respuesta 0s...", kind: "wait", status: "active" },
    ]);
    const espIdx = 2;
    startEspTimer(espIdx);

    let botResult = null;
    try {
      botResult = await NexusBot.recargar({ producto: sel, id_juego: playerId.trim() });
    } catch (e) {
      botResult = { error: e?.message || "El bot no respondió" };
    }
    stopEspTimer();
    const secs = espSecRef.current || 0;
    const botSuccess = botResult && !botResult.error;

    // L4 — Respuesta recibida + desenlace
    const finishLogs = [
      { step: "Conectando con el bot...", kind: "ok", status: "done" },
      { step: "Enviando pedido al servidor...", kind: "ok", status: "done" },
      { step: `Esperando respuesta ${secs}s...`, kind: "ok", status: "done" },
      { step: `Respuesta recibida (${secs}s)`, kind: botSuccess ? "ok" : "warn", status: "done" },
      botSuccess
        ? { step: "Recarga exitosa ✓", kind: "ok", status: "done" }
        : { step: `El sistema no respondió: ${botResult?.error || ""}`, kind: "warn", status: "done" },
    ];
    setLogs(finishLogs);

    // Pausa para que el usuario lea el desenlace
    await new Promise((r) => setTimeout(r, 1000));

    // Persistir registro
    const tx = botResult?.tx_id || botResult?.orderDetails?.transactionId || "";
    try {
      await R.create({
        player_id: playerId.trim(),
        producto: sel,
        producto_nombre: botResult?.producto_nombre || PRODUCT_MAP[sel]?.nombre || sel,
        producto_tipo: isOncePerId(sel) ? "nivel" : "pase",
        tx_id: String(tx),
        amount: String(botResult?.orderDetails?.monto || ""),
        status: botSuccess ? "completed" : "failed",
      });
    } catch {}

    setResult({ ok: botSuccess, data: botResult, error: botResult?.error });
    setStage(botSuccess ? "done" : "error");
    if (botSuccess) {
      setPlayerId("");
      setSel(null);
    }
    setBusy(false);
  }

  const Group = ({ title, items, lock }) => (
    <div className="mb-5">
      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2.5 flex items-center gap-2">
        {title}
        {lock && <Lock className="w-3 h-3 text-amber-400" />}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {items.map((p) => (
          <button
            key={p}
            onClick={() => setSel(p)}
            className={`text-left p-3.5 rounded-2xl border transition-all duration-200 ${sel === p ? "border-primary bg-primary/10 shadow-lg shadow-primary/10" : "border-border/20 hover:border-border/50 bg-muted/30 hover:bg-muted/50"}`}
          >
            <div className="text-sm font-bold text-foreground">{PRODUCT_MAP[p]?.nombre || p}</div>
            <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/50" />
              {meta(p).grupo}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Selector de paquetes */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Selecciona el paquete</h3>
        </div>
        {pases.length > 0 && <Group title="Pases Booyah" items={pases} />}
        {niveles.length > 0 && <Group title="Paquetes de Nivel (1 por ID)" items={niveles} lock />}
        {otros.length > 0 && <Group title="Otros" items={otros} />}
        {products.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Package className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No se obtuvieron productos del bot.</p>
          </div>
        )}
      </div>

      {/* Panel de recarga */}
      {sel && (
        <div className="bg-card border border-border/20 rounded-2xl p-5 space-y-4">
          {/* Producto seleccionado */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Producto</p>
                <p className="text-sm font-bold text-foreground">{PRODUCT_MAP[sel]?.nombre || sel}</p>
              </div>
            </div>
            <button onClick={() => setSel(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Cambiar
            </button>
          </div>

          {/* Input ID */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <User className="w-3.5 h-3.5" /> ID del Jugador
            </label>
            <input
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value.replace(/\D/g, ""))}
              placeholder="Ej: 4475588285"
              inputMode="numeric"
              className="w-full bg-muted border border-border/30 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary font-mono tracking-wide transition-colors"
            />
            {isOncePerId(sel) && (
              <p className="text-[11px] text-amber-400 flex items-center gap-1.5 mt-2">
                <Lock className="w-3 h-3" /> Paquete de nivel: solo se puede comprar una vez por ID.
              </p>
            )}
            {checkingId && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Verificando registro...
              </p>
            )}
            {block && (
              <p className="text-xs text-red-400 flex items-center gap-1.5 mt-2 bg-red-500/10 px-3 py-2 rounded-lg">
                <Lock className="w-3.5 h-3.5" /> Este ID ya compró este paquete de nivel. Bloqueado.
              </p>
            )}
          </div>

          {/* Botón de recarga */}
          {stage !== "processing" && (
            <button
              onClick={recarga}
              disabled={busy || checkingId || block || !playerId.trim()}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3.5 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-all"
            >
              <Zap className="w-4 h-4" /> Recargar ahora <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {/* Feed de logs en vivo — mismo patrón que el flujo de compra del cliente */}
          {stage === "processing" && (
            <div className="bg-muted/30 border border-border/20 rounded-xl p-5 space-y-3">
              <ProcessingSticker logs={logs} />
              <p className="text-center text-xs text-muted-foreground -mt-1">Esto puede tardar hasta 60 segundos.</p>
              <div className="w-full space-y-1.5 text-left">
                {logs.map((log, i) => <LogRow key={i} log={log} />)}
              </div>
            </div>
          )}

          {/* Resultado final */}
          {stage === "done" && result && (
            <div className="rounded-xl p-4 border bg-green-500/10 border-green-500/30">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-green-500/20 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold text-green-300">✓ Recarga completada</p>
                  {result.data?.nickname && (
                    <p className="text-xs text-muted-foreground">Jugador: <span className="text-foreground font-medium">{result.data.nickname}</span></p>
                  )}
                  {result.data?.producto_nombre && (
                    <p className="text-xs text-muted-foreground">Producto: <span className="text-foreground">{result.data.producto_nombre}</span></p>
                  )}
                  {result.data?.orderDetails?.monto && (
                    <p className="text-xs text-muted-foreground">Monto: <span className="text-foreground">{result.data.orderDetails.monto}</span></p>
                  )}
                  {result.data?.orderDetails?.saldo_restante && (
                    <p className="text-xs text-muted-foreground">Saldo restante: <span className="text-foreground">{result.data.orderDetails.saldo_restante}</span></p>
                  )}
                  {result.data?.tx_id && (
                    <p className="text-[10px] text-muted-foreground font-mono break-all">Tx: {result.data.tx_id}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setStage("idle"); setResult(null); setLogs([]); }}
                className="w-full mt-3 text-xs font-semibold text-primary border border-primary/30 rounded-lg py-2 hover:bg-primary/10 transition-colors"
              >
                Hacer otra recarga
              </button>
            </div>
          )}

          {stage === "error" && result && (
            <div className="rounded-xl p-4 border bg-red-500/10 border-red-500/30">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-red-500/20 text-red-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold text-red-300">✗ Falló la recarga</p>
                  <p className="text-xs text-red-300/80 break-words">
                    {result.error || result.data?.error || "Error desconocido"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Si el paquete llegó al jugador, ignora este error. El sistema pudo haberlo procesado sin confirmar.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setStage("idle"); setResult(null); setLogs([]); }}
                  className="flex-1 text-xs font-semibold text-muted-foreground border border-border/30 rounded-lg py-2 hover:bg-muted/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={recarga}
                  className="flex-1 text-xs font-semibold text-primary-foreground bg-primary rounded-lg py-2 hover:bg-primary/90 transition-colors"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!sel && products.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/10 rounded-xl px-4 py-3">
          <Sparkles className="w-3.5 h-3.5 text-primary/60" />
          Selecciona un paquete arriba para ingresar el ID del jugador y recargar.
        </div>
      )}
    </div>
  );
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