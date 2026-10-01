import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { PlayCircle, BookOpen } from "lucide-react";
import { base44 } from "@/api/base44Client";

const DEFAULT_VIDEO_ID = "YZONnkvoWZU"; // tutorial demo (YouTube short)

function extractYouTubeId(value) {
  if (!value) return "";
  const m1 = String(value).match(/(?:youtu\.be\/|embed\/|v=|shorts\/)([A-Za-z0-9_-]{6,})/);
  if (m1) return m1[1];
  if (/^[A-Za-z0-9_-]{6,}$/.test(value)) return value;
  return "";
}

// Sección de "Cómo recargar" en el Home. El video se configura desde el Admin
// creando la Setting `tutorial_video` con el ID o URL de YouTube. Si no está
// configurado, usa el video por defecto.
export default function TutorialVideo() {
  const [videoId, setVideoId] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    base44.entities.Setting.filter({ key: "tutorial_video" })
      .then((recs) => {
        if (!active) return;
        const id = extractYouTubeId(recs?.[0]?.value || "");
        setVideoId(id || DEFAULT_VIDEO_ID);
      })
      .catch(() => { if (active) setVideoId(DEFAULT_VIDEO_ID); });
    return () => { active = false; };
  }, []);

  return (
    <section className="bg-background py-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight flex items-center justify-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" /> ¿Cómo recargar en Legacy?
          </h2>
          <p className="text-muted-foreground text-sm mt-2">
            Mira el tutorial completo — te muestra todos los pasos para recargar correctamente.
          </p>
        </div>

        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative block w-full aspect-[16/9] rounded-2xl overflow-hidden border border-border/30 group shadow-xl hover:shadow-primary/20 transition-all duration-500"
        >
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt="Tutorial de recarga"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors duration-500" />
          <div className="absolute inset-0 flex items-center justify-center">
            <PlayCircle className="w-16 h-16 text-white/90 group-hover:scale-110 transition-transform duration-500 drop-shadow-lg" />
          </div>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-4 py-2 rounded-full">
            ▶ Ver tutorial
          </span>
        </motion.button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="aspect-video w-full rounded-2xl overflow-hidden shadow-2xl bg-black">
              <iframe
                className="w-full h-full"
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                title="Tutorial de recarga Legacy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <button onClick={() => setOpen(false)} className="mt-4 mx-auto block text-muted-foreground hover:text-primary text-sm transition-colors">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}