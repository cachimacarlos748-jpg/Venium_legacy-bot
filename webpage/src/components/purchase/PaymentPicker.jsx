import { Check } from "lucide-react";

// Métodos de pago como tarjetas horizontales en 2 columnas: logo + nombre +
// detalle. Antes era una lista vertical y, al elegir, se colapsaba a una sola
// fila con un botón "Cambiar". Con la cuadrícula se ven todas las opciones de
// un vistazo y el elegido queda marcado en ámbar, igual que el paquete.
export default function PaymentPicker({ methods, selected, onSelect }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {methods.map((m) => {
        const active = !!selected && (selected.id ? selected.id === m.id : selected.name === m.name);
        return (
          <button
            key={m.id || m.name}
            onClick={() => onSelect(m)}
            className={`tap flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-200 ${
              active
                ? "border-amber-500/70 bg-amber-500/10 glow-amber"
                : "border-border bg-card hover:border-amber-500/40"
            }`}
          >
            <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-lg flex-shrink-0 overflow-hidden border border-border">
              {m.image_url ? <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" /> : m.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground truncate">{m.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{m.desc}</p>
            </div>
            {active && <Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
