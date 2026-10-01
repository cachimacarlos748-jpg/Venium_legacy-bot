import { Check, ChevronsLeftRight } from "lucide-react";

// Cuando hay un método seleccionado, solo se muestra ese (con su caja de datos
// debajo). Un botón "Cambiar" lo deselecciona para volver a ver todas las
// opciones, evitando el ruido visual del otro método.
export default function PaymentPicker({ methods, selected, onSelect }) {
  if (selected) {
    const m = selected;
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={() => onSelect(null)}
          className="flex items-center gap-3 rounded-xl border p-4 text-left transition-all w-full border-primary bg-primary/10 shadow-lg shadow-primary/10"
        >
          <span className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl flex-shrink-0 overflow-hidden border border-border/20">
            {m.image_url ? <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" /> : m.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-primary">{m.name}</p>
            <p className="text-xs text-muted-foreground truncate">{m.desc}</p>
          </div>
          <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <Check className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={3} />
          </span>
        </button>
        <button
          onClick={() => onSelect(null)}
          className="self-end inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ChevronsLeftRight className="w-3.5 h-3.5" /> Cambiar método
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {methods.map((m) => (
        <button
          key={m.id}
          onClick={() => onSelect(m)}
          className="flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200 border-border/30 bg-card hover:border-primary/50"
        >
          <span className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl flex-shrink-0 overflow-hidden border border-border/20">
            {m.image_url ? <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" /> : m.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">{m.name}</p>
            <p className="text-xs text-muted-foreground truncate">{m.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}