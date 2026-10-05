import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, Send, AlertTriangle, Plus, X } from "lucide-react";
import { sendWhatsAppMessage, getAdminNumber } from "@/lib/whatsappClient";

const GAMES = ["Free Fire", "Blood Strike", "Mobile Legends", "Roblox", "PUBG", "Honor of Kings"];

export default function SubmitVideoForm({ creator, videos, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    tiktok_url: "",
    game: creator?.tiktok_handle ? "Free Fire" : "Free Fire",
    game_id: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  // Máximo 2 videos activos (pending, approved, counting)
  const activeCount = (videos || []).filter((v) =>
    ["pending", "approved", "counting"].includes(v.status)
  ).length;
  const canSubmit = activeCount < 2;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!/tiktok\.com/i.test(form.tiktok_url)) {
      setErr("Ingresa un enlace de TikTok válido.");
      return;
    }
    if (!form.game_id) {
      setErr("Ingresa el ID de tu juego.");
      return;
    }
    if (!canSubmit) {
      setErr("Ya tienes 2 videos activos. Espera a que termine el plazo de 7 días.");
      return;
    }

    setSubmitting(true);
    try {
      await base44.entities.CreatorVideo.create({
        creator_email: creator.email,
        creator_name: creator.name || "",
        whatsapp: creator.whatsapp || "",
        tiktok_url: form.tiktok_url,
        game: form.game,
        game_id: form.game_id,
        status: "pending",
        views_initial: 0,
        views_current: 0,
        check_attempts: 0,
      });

      // Notificar al admin
      try {
        const adminNum = await getAdminNumber();
        if (adminNum) {
          const msg = [
            "🎬 *Nuevo video de creador* — Vex Store",
            "",
            `👤 ${creator.name || "—"}`,
            `📧 ${creator.email}`,
            `🎮 Juego: ${form.game}`,
            `🆔 ID: ${form.game_id}`,
            `🔗 ${form.tiktok_url}`,
            "",
            "Entra al panel para revisar el video.",
          ].join("\n");
          sendWhatsAppMessage(adminNum, msg).catch(() => {});
        }
      } catch {}

      setForm({ tiktok_url: "", game: "Free Fire", game_id: "" });
      setOpen(false);
      onSubmitted?.();
    } catch (e) {
      setErr(e.message || "No se pudo enviar el video.");
    }
    setSubmitting(false);
  };

  if (!canSubmit && !open) {
    return (
      <div className="bg-muted/30 border border-border/20 rounded-2xl p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Tienes <span className="font-bold text-amber-400">{activeCount} videos activos</span>. Espera a que termine el plazo de 7 días para subir uno nuevo.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-2xl py-3.5 text-sm font-bold hover:bg-primary/90 transition-colors"
      >
        <Plus className="w-4 h-4" /> Subir nuevo video
      </button>
    );
  }

  const input = "w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary";

  return (
    <form onSubmit={submit} className="bg-card border border-border/20 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Subir nuevo video</h3>
        <button type="button" onClick={() => { setOpen(false); setErr(""); }}
          className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="-mt-1 text-[11px] text-muted-foreground">Máximo 2 videos activos por semana. La recompensa se cuenta a los 7 días.</p>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground font-medium">Enlace del video de TikTok</span>
        <input value={form.tiktok_url} onChange={set("tiktok_url")} placeholder="https://www.tiktok.com/@tuvideo/1234567890" className={input} required />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Juego</span>
          <select value={form.game} onChange={set("game")} className={input}>
            {GAMES.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground font-medium">ID / Tag</span>
          <input value={form.game_id} onChange={set("game_id")} className={input} required />
        </label>
      </div>

      {err && <p className="text-xs text-destructive flex gap-1.5 items-start"><AlertTriangle className="w-4 h-4 mt-0.5" />{err}</p>}

      <Button type="submit" size="lg" disabled={submitting} className="w-full font-bold">
        {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />} Enviar video
      </Button>
    </form>
  );
}