// Requisitos del video, términos del programa y gestion desde el panel.
// Bloque informativo (sin lógica) que se anuncia en /creadores.
import { Film, Hash, AtSign, ShieldCheck, Clock, Sparkles, MessageCircle, Layers } from "lucide-react";

const REQUISITOS = [
  { icon: Film, title: "Formato", text: "Video vertical (9:16), mínimo 15 segundos, audio claro y buena iluminación." },
  { icon: Sparkles, title: "Contenido", text: "Menciona o muestra Vex Store, dice qué recargamos (diamantes, gift cards, pases) y muestra tu código de creador dentro del video." },
  { icon: AtSign, title: "Mención", text: "Incluye @legacy_store.vzla en el texto del video. Es obligatorio para validar la postulación." },
  { icon: Hash, title: "Hashtag", text: "Usa el hashtag #legacystorevzl. Nos permite encontrar tu clip y darte la recompensa." },
];

const TERMINOS = [
  { icon: Clock, title: "Medición", text: "Las vistas se contabilizan una sola vez a los 7 días posteriores a tu aprobación. Después se cierra el video." },
  { icon: Layers, title: "Límite", text: "Máximo 2 videos activos por semana por creador. Si tienes más, esperan en cola a que termine el anterior." },
  { icon: ShieldCheck, title: "Anti-fraude", text: "Si detectamos likes o vistas con bots, el video se descarta sin recompensa. La interacción debe verse natural." },
  { icon: ShieldCheck, title: "Originalidad", text: "No se aceptan clips reciclados de otros canales. Tu rostro o tu voz validan tu autoría." },
];

const GESTION = [
  { cmd: "1. Postula aquí", desc: "Envía tu video desde esta página y el equipo lo revisa." },
  { cmd: "2. Espera el PIN", desc: "Si lo aprobamos, te lo mandamos por WhatsApp." },
  { cmd: "3. Entra a tu panel", desc: "Con tu correo y el PIN ves tus estadísticas y retiros." },
  { cmd: "4. Elige tu código", desc: "Creas tu código de creador y lo usas en tus videos." },
];

export default function TermsCard() {
  return (
    <div className="mt-10 space-y-6">
      {/* Requisitos */}
      <div className="bg-muted/30 border border-border/20 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-3">Requisitos del video</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {REQUISITOS.map((r) => (
            <div key={r.title} className="bg-card border border-border/20 rounded-lg p-3 flex gap-2.5 items-start text-xs">
              <r.icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-foreground">{r.title}</p>
                <p className="text-muted-foreground mt-0.5 leading-snug">{r.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Términos */}
      <div className="bg-muted/30 border border-border/20 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-3">Términos del sistema</h3>
        <div className="space-y-2">
          {TERMINOS.map((t) => (
            <div key={t.title} className="bg-card border border-border/20 rounded-lg p-3 flex gap-2.5 items-start text-xs">
              <t.icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-foreground">{t.title}</p>
                <p className="text-muted-foreground mt-0.5 leading-snug">{t.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gestión */}
      <div className="bg-muted/30 border border-border/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Cómo funciona tu postulación</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Todo se hace desde aquí y por WhatsApp. Escribe cualquier duda al bot y te responde al instante.</p>
        <div className="space-y-1.5">
          {GESTION.map((c) => (
            <div key={c.cmd} className="bg-card border border-border/20 rounded-lg px-3 py-2 flex flex-wrap gap-3 justify-between text-xs">
              <code className="text-primary font-bold whitespace-nowrap">{c.cmd}</code>
              <span className="text-muted-foreground flex-1">{c.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}