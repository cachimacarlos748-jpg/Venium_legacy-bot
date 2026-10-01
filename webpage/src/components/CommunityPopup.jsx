import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";

const STORAGE_KEY = "legacyCommunityPopupShown";

// Modal de invitación a la comunidad: aparece una sola vez al entrar al sitio
// (persiste la decisión en localStorage). Solo se muestra si el admin configuró
// el link del canal en Settings → Soporte y Comunidad.
export default function CommunityPopup() {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState({ url: "", name: "nuestra comunidad" });

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    let active = true;
    base44.entities.Setting
      .filter({ key: "support" })
      .then((recs) => {
        if (!active) return;
        try {
          const p = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
          if (p.channel_url) {
            setChannel({ url: p.channel_url, name: p.channel_name || "nuestra comunidad" });
            setOpen(true);
            localStorage.setItem(STORAGE_KEY, "1");
          }
        } catch {}
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const close = () => setOpen(false);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="max-w-md w-full bg-card border border-border/30 rounded-2xl overflow-hidden shadow-2xl relative"
          >
            <button
              onClick={close}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-black text-foreground mb-2">¡Únete a {channel.name}!</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Forma parte de nuestra comunidad para recibir ofertas exclusivas, soporte y novedades sobre tus recargas favoritas.
              </p>
              <a
                href={channel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground font-bold py-3 rounded-xl hover:bg-primary/90 transition-colors"
              >
                Unirme ahora
              </a>
              <button
                onClick={close}
                className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Ahora no, gracias
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}