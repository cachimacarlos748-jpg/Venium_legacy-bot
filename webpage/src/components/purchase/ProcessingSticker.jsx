import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";

// Indicador del verificador de pagos: anillo girando alrededor de un escudo
// mientras el bot consulta el banco, con barra de progreso que AVANZA CON LOS
// LOGS reales.
//
// La barra sincroniza con la lógica de segundos del log "Esperando respuesta Xs"
// que copiamos del bot de Nexus:
//   - Pasos 1-6 completados (buscando pago, verificando banco, conectando
//     proveedor, etc.) = 0% → 50% (cada paso ~8%).
//   - "Esperando respuesta Xs..." = 50% → 90% según los segundos contados
//     (X/60 * 40%). A 60s llega a 90% y se queda ahí.
//   - "Recarga exitosa ✓" = 100%.
export default function ProcessingSticker({ logs = [] }) {
  const [progress, setProgress] = useState(0);

  // Calcula el progreso objetivo desde los logs en vivo.
  const target = useMemo(() => {
    // ¿Llegó el "Recarga exitosa ✓"? → 100%
    if (logs.some((l) => /exitosa/i.test(l.step))) return 100;

    // ¿Estamos en "Esperando respuesta Xs..."? → 50% + (X/60)*40%
    const espLog = logs.find((l) => /Esperando respuesta\s+(\d+)s/i.test(l.step));
    if (espLog) {
      const m = espLog.step.match(/(\d+)s/);
      const secs = m ? parseInt(m[1], 10) : 0;
      return Math.min(90, 50 + (secs / 60) * 40);
    }

    // Antes de "Esperando respuesta": cada log completado = ~8% (máx 50%)
    const doneCount = logs.filter((l) => l.status === "done").length;
    return Math.min(50, doneCount * 8);
  }, [logs]);

  // Interpolación suave hacia el objetivo (rAF).
  useEffect(() => {
    let raf;
    const tick = () => {
      setProgress((prev) => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.4) return target;
        return prev + diff * 0.08;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const R = 42;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      {/* Anillo + escudo: el gesto visual del verificador */}
      <div className="relative w-28 h-28 flex items-center justify-center">
        {/* Halo que late detrás */}
        <span className="absolute inset-2 rounded-full bg-primary/40 blur-2xl animate-verify-halo" />

        {/* Pista del anillo */}
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        </svg>

        {/* Arco que gira */}
        <svg className="absolute inset-0 w-full h-full animate-verify-spin" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50" cy="50" r={R} fill="none"
            stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${CIRC * 0.28} ${CIRC * 0.72}`}
          />
        </svg>

        {/* Círculo interior opaco + escudo */}
        <div className="relative w-[68px] h-[68px] rounded-full bg-card border border-border flex items-center justify-center shadow-[0_0_30px_-8px_hsl(var(--primary)/0.7)]">
          <ShieldCheck className="w-7 h-7 text-primary" strokeWidth={2.2} />
        </div>
      </div>

      <div className="text-center space-y-1">
        <h2 className="text-base font-black text-foreground uppercase tracking-wider">Verificando transacción</h2>
        <p className="text-xs text-muted-foreground">Buscando la transferencia en el banco…</p>
      </div>

      {/* Barra de progreso sincronizada con los logs */}
      <div className="w-full max-w-[240px]">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden border border-border/60">
          <motion.div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))",
              boxShadow: "0 0 10px hsl(var(--primary) / 0.6)",
            }}
          />
        </div>
        <p className="text-center text-[11px] text-muted-foreground mt-2 num font-semibold">
          {Math.round(progress)}%
        </p>
      </div>
    </div>
  );
}
