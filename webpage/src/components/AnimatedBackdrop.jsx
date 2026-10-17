// Fondo animado decorativo SOLO en modo app. Orbes de luz de marca flotando
// con blur, muy tenues para no competir con el contenido. En la web normal
// no se renderiza (el fondo de la web queda como está).
import { motion } from "framer-motion";

export default function AnimatedBackdrop() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
      <motion.div
        className="absolute -top-40 -left-32 w-[420px] h-[420px] rounded-full bg-primary/10 blur-[130px]"
        animate={{ y: [0, 40, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 14, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        className="absolute top-1/3 -right-40 w-[360px] h-[360px] rounded-full bg-accent/10 blur-[120px]"
        animate={{ y: [0, -50, 0], x: [0, 25, 0] }}
        transition={{ duration: 18, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        className="absolute -bottom-48 left-1/4 w-[480px] h-[480px] rounded-full bg-primary/8 blur-[150px]"
        animate={{ y: [0, -35, 0], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 16, ease: "easeInOut", repeat: Infinity }}
      />
    </div>
  );
}
