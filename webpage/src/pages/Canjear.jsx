import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Gift, Loader2, CheckCircle2, AlertCircle, ArrowLeft, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { NexusBot } from "@/lib/nexusBotClient";
import { Button } from "@/components/ui/button";
import ProcessingSticker from "@/components/purchase/ProcessingSticker";

function LogRow({ log }) {
  const active = log.status === "active" && log.kind === "wait";
  const dotColor = log.kind === "ok" ? "bg-green-400" : "bg-amber-400";
  const textClass = log.kind === "ok" ? "text-green-400" : log.status === "active" ? "text-amber-300 font-medium" : "text-muted-foreground";
  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="flex items-center gap-2.5 text-sm">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${active ? "animate-pulse" : ""}`}
        style={log.kind === "ok" ? { boxShadow: "0 0 6px rgba(74,222,128,0.6)" } : { boxShadow: "0 0 6px rgba(251,191,36,0.5)" }} />
      <span className={textClass}>{log.step}</span>
    </motion.div>
  );
}

export default function Canjear() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1=code, 2=playerId, 3=confirm, 4=delivering, 5=success, 6=error
  const [code, setCode] = useState("");
  const [prizeCode, setPrizeCode] = useState(null);
  const [playerId, setPlayerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [botResult, setBotResult] = useState(null);
  const [verifyingId, setVerifyingId] = useState(false);
  const [logs, setLogs] = useState([]);
  const timersRef = useRef([]);

  async function validateCode() {
    setError("");
    const c = code.trim().toUpperCase();
    if (!c) { setError("Ingresa un código"); return; }
    try {
      const list = await base44.entities.PrizeCode.filter({ code: c });
      const rec = list?.[0];
      if (!rec) { setError("Código no encontrado. Verifica que esté bien escrito."); return; }
      if (rec.status === "disabled") { setError("Este código está deshabilitado."); return; }
      if (rec.expires_date && new Date(rec.expires_date) < new Date()) { setError("Este código ha expirado."); return; }
      if (rec.used_count >= rec.max_uses) { setError("Este código ya fue canjeado el máximo de veces."); return; }
      setPrizeCode(rec);
      setStep(2);
    } catch (e) {
      setError("No se pudo validar el código. Intenta de nuevo.");
    }
  }

  async function verifyPlayer() {
    setError("");
    const id = playerId.trim();
    if (!id) { setError("Ingresa tu ID de Free Fire"); return; }
    setNickname("");
    setStep(3);
  }

  // Limpia timers pendientes al desmontar.
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  function addLog(step, kind = "wait", status = "active") {
    setLogs((prev) => [...prev, { step, kind, status }]);
  }
  function updateLastLog(kind, status) {
    setLogs((prev) => {
      if (!prev.length) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = { ...copy[copy.length - 1], kind, status };
      return copy;
    });
  }

  async function deliver() {
    setStep(4);
    setError("");
    setLogs([]);

    // Logs progresivos que entretienen la espera (estilo VerifyModal).
    const t1 = setTimeout(() => addLog("Conectando con el bot..."), 200);
    const t2 = setTimeout(() => updateLastLog("wait", "done"), 900);
    const t3 = setTimeout(() => addLog("Verificando cuenta de Free Fire..."), 1100);
    const t4 = setTimeout(() => updateLastLog("wait", "done"), 1800);
    const t5 = setTimeout(() => addLog("Enviando premio..."), 2000);
    const t6 = setTimeout(() => updateLastLog("wait", "done"), 2700);
    // Contador de segundos mientras el bot procesa.
    let secs = 0;
    const waitTimer = setInterval(() => {
      secs += 1;
      setLogs((prev) => {
        const hasWait = prev.some((l) => /Esperando respuesta/.test(l.step));
        if (!hasWait) return [...prev, { step: `Esperando respuesta ${secs}s...`, kind: "wait", status: "active" }];
        return prev.map((l) => /Esperando respuesta/.test(l.step) ? { ...l, step: `Esperando respuesta ${secs}s...` } : l);
      });
    }, 1000);
    const t7 = setTimeout(() => { addLog("Esperando respuesta del servidor..."); }, 2900);
    timersRef.current = [t1, t2, t3, t4, t5, t6, t7, waitTimer];

    try {
      const result = await NexusBot.recargar({
        producto: prizeCode.bot_product,
        id_juego: playerId.trim(),
      });
      // Limpiar timers.
      timersRef.current.forEach((t) => { clearTimeout(t); clearInterval(t); });
      timersRef.current = [];

      if (result.error || !result.ok) {
        setBotResult({ ok: false, error: result.error || "El bot no pudo entregar el premio" });
        setStep(6);
        return;
      }
      // Marcar log final como exitoso.
      setLogs((prev) => prev.map((l) => /Esperando respuesta/.test(l.step) ? { ...l, step: "Esperando respuesta ✓", kind: "wait", status: "done" } : l));
      addLog("¡Premio entregado!", "ok", "done");

      // Update code: increment used_count and add to log
      const newCount = (prizeCode.used_count || 0) + 1;
      const log = [...(prizeCode.redemption_log || []), {
        player_id: playerId.trim(),
        nickname: nickname || result.nickname || "",
        timestamp: new Date().toISOString(),
        tx_id: result.tx_id || "",
        result: "ok",
      }];
      const newStatus = newCount >= prizeCode.max_uses ? "exhausted" : prizeCode.status;
      await base44.entities.PrizeCode.update(prizeCode.id, {
        used_count: newCount,
        status: newStatus,
        redemption_log: log,
      });
      setBotResult({ ok: true, tx_id: result.tx_id, nickname: result.nickname });
      // Pequeña pausa para que el usuario vea el "¡Premio entregado!" en los logs.
      setTimeout(() => setStep(5), 800);
    } catch (e) {
      timersRef.current.forEach((t) => { clearTimeout(t); clearInterval(t); });
      timersRef.current = [];
      setBotResult({ ok: false, error: e.message || "Error inesperado" });
      setStep(6);
    }
  }

  function reset() {
    setStep(1); setCode(""); setPrizeCode(null); setPlayerId(""); setNickname(""); setError(""); setBotResult(null); setLogs([]);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-black text-foreground mb-1">Canjear Premio</h1>
          <p className="text-sm text-muted-foreground">Ingresa tu código y recibe tu premio al instante</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1.5 rounded-full transition-all ${step >= s ? "bg-primary w-12" : "bg-muted w-6"}`} />
          ))}
        </div>

        <div className="bg-card rounded-2xl border border-border/30 p-6">
          {/* Step 1: Code input */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Código del premio</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && validateCode()}
                  placeholder="LEGACY-XXXXXX"
                  className="w-full bg-input border border-border/30 rounded-xl px-4 py-3 text-sm font-bold tracking-wider text-foreground text-center uppercase focus:outline-none focus:border-primary"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-400 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
              <Button onClick={validateCode} className="w-full" size="lg">
                Verificar código
              </Button>
            </div>
          )}

          {/* Step 2: Player ID */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-primary/10 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Premio:</p>
                <p className="text-sm font-bold text-foreground">{prizeCode?.prize_label}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Tu ID de Free Fire</label>
                <input
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && verifyPlayer()}
                  placeholder="Ej: 6068831320"
                  className="w-full bg-input border border-border/30 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-400 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setStep(1); setError(""); }} className="flex-1" disabled={verifyingId}>
                  <ArrowLeft className="w-4 h-4" /> Atrás
                </Button>
                <Button onClick={verifyPlayer} className="flex-1" disabled={verifyingId}>
                  {verifyingId ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</> : "Verificar ID"}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="text-center">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-1">Jugador verificado</p>
                <p className="text-lg font-bold text-foreground">{nickname || "Jugador"}</p>
                <p className="text-xs text-muted-foreground">ID: {playerId}</p>
              </div>
              <div className="bg-primary/10 rounded-lg p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Vas a recibir:</p>
                <p className="text-base font-bold text-primary">{prizeCode?.prize_label}</p>
              </div>
              <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-3">
                <p className="text-xs text-yellow-400/90 text-center">
                  ⚠️ Revisa que sea tu cuenta. El premio se entrega ahí y no se puede cambiar.
                </p>
              </div>
              {error && <p className="text-sm text-red-400 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setStep(2); setError(""); setNickname(""); }} className="flex-1">
                  <ArrowLeft className="w-4 h-4" /> Cambiar ID
                </Button>
                <Button onClick={deliver} className="flex-1">
                  <Sparkles className="w-4 h-4" /> Recibir premio
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Delivering */}
          {step === 4 && (
            <div className="flex flex-col items-center gap-4 py-4">
              <ProcessingSticker logs={logs} />
              <h2 className="text-xl font-black text-foreground">Entregando tu premio</h2>
              <p className="text-xs text-muted-foreground -mt-2">Esto puede tardar hasta 60 segundos.</p>
              <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2.5 items-start text-left">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs leading-snug">
                  <p className="font-bold text-amber-300">No cierres esta pestaña</p>
                  <p className="text-amber-300/80 mt-0.5">Si sales, el canje se cancelará y tendrás que empezar de nuevo.</p>
                </div>
              </div>
              <div className="w-full space-y-1.5 text-left">
                {logs.map((log, i) => <LogRow key={i} log={log} />)}
              </div>
            </div>
          )}

          {/* Step 5: Success */}
          {step === 5 && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-400/15 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-black text-foreground mb-1">¡Premio entregado!</h2>
                <p className="text-sm text-muted-foreground">{prizeCode?.prize_label}</p>
                {botResult?.nickname && <p className="text-xs text-muted-foreground mt-1">Para: {botResult.nickname}</p>}
                {botResult?.tx_id && <p className="text-xs text-muted-foreground mt-1">Tx: {botResult.tx_id}</p>}
              </div>
              <Button onClick={() => navigate("/")} className="w-full">
                Volver al inicio
              </Button>
            </div>
          )}

          {/* Step 6: Error */}
          {step === 6 && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-400/15 flex items-center justify-center mx-auto">
                <AlertCircle className="w-9 h-9 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-black text-foreground mb-1">No se pudo entregar</h2>
                <p className="text-sm text-muted-foreground">{botResult?.error || "Error inesperado"}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset} className="flex-1">Intentar de nuevo</Button>
                <Button onClick={() => navigate("/")} className="flex-1">Inicio</Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          ¿Problemas? Escríbenos por WhatsApp
        </p>
      </div>
    </div>
  );
}