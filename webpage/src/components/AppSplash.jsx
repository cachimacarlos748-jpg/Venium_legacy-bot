// Splash de bienvenida SOLO en modo app (dentro del envoltorio Android).
// Fiel a la marca: fondo casi negro, acento violeta #7c3aed, tipografía Outfit.
// En la web normal este componente no se renderiza nunca.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function AppSplash({ onFinish }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 1700);
    const t2 = setTimeout(() => onFinish?.(), 2150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onFinish]);

  if (leaving) {
    return (
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background overflow-hidden"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-hidden="true"
    >
      {/* Halo animado de marca */}
      <motion.div
        className="absolute w-[520px] h-[520px] rounded-full bg-primary/20 blur-[140px]"
        animate={{ scale: [0.9, 1.15, 0.95], opacity: [0.35, 0.65, 0.4] }}
        transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        className="absolute w-[300px] h-[300px] rounded-full bg-accent/15 blur-[100px]"
        animate={{ x: [-60, 60, -60], y: [40, -40, 40] }}
        transition={{ duration: 5, ease: "easeInOut", repeat: Infinity }}
      />

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo: anillo girando alrededor de la V de marca */}
        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 160, damping: 15 }}
          className="relative w-24 h-24 mb-6"
        >
          <motion.span
            className="absolute inset-0 rounded-3xl border-2 border-primary/60"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.2, ease: "linear", repeat: Infinity }}
            style={{ borderStyle: "dashed" }}
          />
          <div className="absolute inset-2 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center glow-primary">
            <span className="text-4xl font-black text-primary-foreground select-none">V</span>
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="text-3xl font-black tracking-tight text-foreground"
        >
          Vex <span className="text-primary">Store</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-2 text-sm text-muted-foreground"
        >
          Recargas y gift cards al instante
        </motion.p>

        {/* Barra de progreso */}
        <div className="mt-8 h-1.5 w-44 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
  );
}
