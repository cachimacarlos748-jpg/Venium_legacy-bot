import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";

// Icono flotante de la Trivia diaria en el Home: compacto, a la izquierda
// (el botón de soporte de WhatsApp vive a la derecha). Vivo/badge verde si la
// sala está abierta; si no, muestra el horario al pasar el dedo/cursor.
const BOT_HOST = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BOT_API) || "";
const botUrl = (path) => `${String(BOT_HOST).replace(/\/$/, "")}${path}`;

export default function TriviaFloatButton() {
  const [openRoom, setOpenRoom] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!BOT_HOST) return;
      try {
        const r = await fetch(botUrl("/api/trivia/health"));
        const j = await r.json();
        const s = j.session ?? j.status;
        if (alive) setOpenRoom(s === "lobby" || s === "countdown" || s === "playing");
      } catch { /* sin conexión al bot: queda en modo horario */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.8 }}
      className="fixed left-4 z-40"
      style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
    >
      <Link to="/trivia" aria-label="Trivia diaria Vex Store" title="Trivia diaria · hoy 8:00 PM · 500 💎">
        <motion.div
          animate={openRoom ? { scale: [1, 1.12, 1] } : {}}
          transition={openRoom ? { repeat: Infinity, duration: 1.6 } : {}}
          className={`w-12 h-12 rounded-full border-2 flex items-center justify-center shadow-lg transition-colors ${
            openRoom
              ? "bg-emerald-500 border-emerald-300 text-black shadow-emerald-500/40"
              : "bg-gradient-to-br from-amber-400 to-amber-600 border-amber-300/60 text-black shadow-amber-600/30"
          }`}
        >
          <Trophy className="w-6 h-6" strokeWidth={2.2} />
        </motion.div>
        {openRoom && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-background" />
        )}
      </Link>
    </motion.div>
  );
}
