import { Plus, X } from "lucide-react";

export default function DenominationEditor({ denominations = [], onChange }) {
  const update = (i, field, value) => {
    const next = [...denominations];
    next[i] = { ...next[i], [field]: field === "price" ? Number(value) : value };
    onChange(next);
  };
  const remove = (i) => onChange(denominations.filter((_, idx) => idx !== i));
  const add = () => onChange([...denominations, { label: "", price: 0 }]);

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground font-medium">Denominaciones</label>
      {denominations.map((d, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            value={d.label}
            onChange={(e) => update(i, "label", e.target.value)}
            placeholder="Ej: 240 Diamantes"
            className="flex-1 bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <input
            type="number"
            step="0.1"
            value={d.price}
            onChange={(e) => update(i, "price", e.target.value)}
            placeholder="0.00"
            className="w-24 bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <button onClick={() => remove(i)} className="p-1.5 text-muted-foreground hover:text-destructive">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium">
        <Plus className="w-3.5 h-3.5" /> Agregar denominación
      </button>
    </div>
  );
}