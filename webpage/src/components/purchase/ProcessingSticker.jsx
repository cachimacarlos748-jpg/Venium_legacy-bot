import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";

const NARUTO_SPRITESHEET = "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/c6b1c3182_file_00000000b1dc81f5b67dbc51ebe5a0fe.png";

// Sticker animado para el estado "Procesando": Naruto corriendo (spritesheet
// 2×8 = 16 frames) con animación cuadro por cuadro + polvo detrás + barra de
// progreso que AVANZA CON LOS LOGS reales.
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

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Naruto corriendo — spritesheet 2×8 (16 frames) cuadro por cuadro */}
      <div className="relative w-24 h-28 flex items-end justify-center">
        <div
          className="animate-naruto-run w-full h-full"
          style={{
            backgroundImage: `url(${NARUTO_SPRITESHEET})`,
            mixBlendMode: "screen",
            filter: "drop-shadow(0 4px 10px rgba(255,140,0,0.35))",
          }}
          aria-label="Procesando recarga"
        />
        {/* Polvo detrás de los pies */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute bottom-1 rounded-full bg-white/60"
            style={{ width: 6 + i * 2, height: 6 + i * 2 }}
            initial={{ x: -10, opacity: 0.7 }}
            animate={{ x: [-10, -30 - i * 10], opacity: [0.7, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12, ease: "easeOut" }}
          />
        ))}
      </div>

      {/* Barra de progreso estilo Free Fire — sincronizada con los logs */}
      <div className="w-full max-w-[200px]">
        <div className="h-2 rounded-full bg-muted overflow-hidden border border-border/30">
          <motion.div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #FF9900, #FFB84D)",
              boxShadow: "0 0 8px rgba(255,153,0,0.5)",
            }}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-1.5 font-mono">
          {Math.round(progress)}%
        </p>
      </div>
    </div>
  );
}