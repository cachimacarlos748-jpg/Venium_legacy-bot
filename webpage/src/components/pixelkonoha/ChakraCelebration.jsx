import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChakraSeal } from "./PixelAssets";

// Celebracion pixel art post-recarga (solo Free Fire).
// Reemplaza el confetti generico con: sello de chakra escalando + rotando,
// particulas pixeladas explosivas, y texto "¡RECARGA EXITOSA!" en fuente pixel.
// Se muestra como overlay fijo sobre el modal.

const PARTICLE_COLORS = ["#FF8C00", "#F59E0B", "#FFD700", "#7CB342", "#B0B8BC"];

function PixelParticles() {
  const particles = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        id: i,
        angle: (i / 24) * Math.PI * 2,
        distance: 120 + Math.random() * 160,
        size: 6 + Math.floor(Math.random() * 8),
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        delay: Math.random() * 0.15,
      })),
    []
  );
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute"
          style={{ width: p.size, height: p.size, backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{
            x: Math.cos(p.angle) * p.distance,
            y: Math.sin(p.angle) * p.distance,
            opacity: [1, 1, 0],
            scale: [1, 0.4, 0],
          }}
          transition={{ duration: 1.1, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

export default function ChakraCelebration({ show }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (show) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 2600);
      return () => clearTimeout(t);
    }
  }, [show]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center pointer-events-none"
        >
          {/* Sello de chakra escalando + rotando */}
          <motion.div
            initial={{ scale: 0, rotate: -90, opacity: 0 }}
            animate={{ scale: [0, 1.3, 1], rotate: [-90, 0, 360], opacity: [0, 1, 1] }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="relative"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="rounded-full"
                style={{
                  width: 200,
                  height: 200,
                  background: "radial-gradient(circle, rgba(255,140,0,0.3), transparent 70%)",
                }}
              />
            </div>
            <ChakraSeal size={180} className="relative z-10" />
            <PixelParticles />
          </motion.div>

          {/* Texto pixel "¡RECARGA EXITOSA!" */}
          <motion.h2
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.4, type: "spring", stiffness: 200 }}
            className="font-pixel text-[#FF8C00] text-center px-6 leading-relaxed mt-6"
            style={{ textShadow: "0 0 12px rgba(255,140,0,0.6), 2px 2px 0 #000" }}
          >
            ¡RECARGA<br />EXITOSA!
          </motion.h2>
        </motion.div>
      )}
    </AnimatePresence>
  );
}