import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Headphones, Loader2, MessageCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

const GAMES = [
  "Diamantes (Free Fire)",
  "Mobile Legends",
  "Blood Strike",
  "PUBG Mobile",
  "Honor of Kings",
  "Roblox",
  "Genshin Impact",
  "Otro",
];

const INPUT_CLASS = "w-full bg-muted border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary transition-colors";

export default function SupportWhatsapp({ triggerText = "Soporte" }) {
  const [open, setOpen] = useState(false);
  const [wa, setWa] = useState("");
  const [loadingWa, setLoadingWa] = useState(false);
  const [form, setForm] = useState({
    nombre: "", juego: "", playerId: "", articulo: "", referencia: "", monto: "", problema: "",
  });

  async function ensureWa() {
    if (wa) return wa;
    setLoadingWa(true);
    try {
      const recs = await base44.entities.Setting.filter({ key: "support" });
      const p = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
      const n = String(p.whatsapp || "").replace(/[^0-9]/g, "");
      setWa(n);
      return n;
    } catch { return ""; }
    finally { setLoadingWa(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const num = await ensureWa();
    if (!num) {
      alert("El número de soporte no está configurado todavía. El admin debe crear la Setting 'support' con el WhatsApp de atención.");
      return;
    }
    const msg = encodeURIComponent(
      "Hola, necesito soporte con una recarga\n\n" +
      `Nombre: ${form.nombre}\n` +
      `Juego: ${form.juego}\n` +
      `ID de jugador: ${form.playerId}\n` +
      `Artículo: ${form.articulo}\n` +
      `Referencia (últimos 6 dígitos): ${form.referencia}\n` +
      `Monto pagado: ${form.monto}\n` +
      `Problema: ${form.problema}`
    );
    window.open(`https://wa.me/${num}?text=${msg}`, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-muted-foreground hover:text-primary text-xs transition-colors duration-200">
          {triggerText}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-card border-border/40">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Headphones className="w-4 h-4 text-primary" /> Soporte Vex Store
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Antes de contactarnos: asegúrate de tener lista tu captura de pago y el número de referencia. Completa todos los campos para que podamos ayudarte más rápido.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3 text-sm mt-1">
          <Field label="Nombre y Apellido *">
            <input className={INPUT_CLASS} required value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </Field>
          <Field label="Juego *">
            <select className={INPUT_CLASS} required value={form.juego}
              onChange={(e) => setForm({ ...form, juego: e.target.value })}>
              <option value="">— Selecciona el juego —</option>
              {GAMES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="ID del Jugador *">
            <input className={INPUT_CLASS} required value={form.playerId}
              onChange={(e) => setForm({ ...form, playerId: e.target.value })} />
          </Field>
          <Field label="Artículo que intentas comprar *">
            <input className={INPUT_CLASS} required value={form.articulo}
              onChange={(e) => setForm({ ...form, articulo: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Referencia (6 dígitos) *">
              <input className={INPUT_CLASS} inputMode="numeric" required pattern="^\d{6,}$"
                value={form.referencia}
                onChange={(e) => setForm({ ...form, referencia: e.target.value.replace(/\D/g, "").slice(0, 9) })} />
            </Field>
            <Field label="Monto del pago *">
              <input className={INPUT_CLASS} inputMode="decimal" required value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })} />
            </Field>
          </div>
          <Field label="Problema que presenta *">
            <textarea className={INPUT_CLASS + " min-h-[80px] resize-y"} required value={form.problema}
              onChange={(e) => setForm({ ...form, problema: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={loadingWa} className="w-full h-11 font-bold">
              {loadingWa ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}
              Enviar a WhatsApp
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground font-medium mb-1.5">{label}</span>
      {children}
    </label>
  );
}