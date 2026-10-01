import { useMemo } from "react";
import { motion } from "framer-motion";
import { KonohaLeaf } from "./PixelAssets";

// Hojas pixeladas de Konoha cayendo de fondo — verdes + secas (marron claro)
// 12 hojas con posicion/velocidad/rotacion aleatoria, loop infinito, pointer-events-none.
// Baja opacidad para no saturar. Performance: CSS transforms, sin layout thrash.

// Mezcla de hojas de arce y ovaladas en colores de otoño (verde, amarillo, naranja, rojo, marron)
const LEAF_COMBOS = [
  { type: "maple", color: "green" },
  { type: "maple", color: "yellow" },
  { type: "maple", color: "orange" },
  { type: "maple", color: "red" },
  { type: "maple", color: "brown" },
  { type: "oval", color: "green" },
  { type: "oval", color: "yellow" },
  { type: "oval", color: "orange" },
];

function randomLeaves(count) {
  return Array.from({ length: count }, (_, i) => {
    const combo = LEAF_COMBOS[Math.floor(Math.random() * LEAF_COMBOS.length)];
    return {
      id: i,
      left: Math.random() * 100, // %
      size: 20 + Math.floor(Math.random() * 16), // 20-36px
      duration: 8 + Math.random() * 10, // 8-18s
      delay: Math.random() * 12, // stagger
      drift: (Math.random() - 0.5) * 120, // deriva horizontal px
      rotate: Math.random() * 720 - 360, // rotacion total
      type: combo.type,
      color: combo.color,
      opacity: 0.4 + Math.random() * 0.3, // 0.4-0.70 (al frente, visibles)
      sway: 20 + Math.random() * 30, // balanceo horizontal
    };
  });
}

export default function FallingLeaves({ count = 12 }) {
  const leaves = useMemo(() => randomLeaves(count), [count]);
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-40" aria-hidden>
      {leaves.map((l) => (
        <motion.div
          key={l.id}
          className="absolute top-[-40px]"
          style={{ left: `${l.left}%`, opacity: l.opacity }}
          initial={{ y: -40, x: 0, rotate: 0 }}
          animate={{
            y: ["0vh", "110vh"],
            x: [0, l.sway, -l.sway, l.drift],
            rotate: l.rotate,
          }}
          transition={{
            duration: l.duration,
            delay: l.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          <KonohaLeaf size={l.size} type={l.type} color={l.color} />
        </motion.div>
      ))}
    </div>
  );
}