import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { User, Save, Loader2, AlertTriangle, Check } from "lucide-react";

export default function ProfileEditor({ creator, loading, onSaved }) {
  const [form, setForm] = useState({
    name: creator?.name || "",
    whatsapp: creator?.whatsapp || "",
    tiktok_handle: creator?.tiktok_handle || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  // Sincroniza el form si el creator llega después (loading async)
  useEffect(() => {
    if (creator) {
      setForm({
        name: creator.name || "",
        whatsapp: creator.whatsapp || "",
        tiktok_handle: creator.tiktok_handle || "",
      });
    }
  }, [creator?.id]);

  const save = async () => {
    setSaving(true); setErr(""); setOk(false);
    try {
      await base44.entities.Creator.update(creator.id, {
        name: form.name, whatsapp: form.whatsapp, tiktok_handle: form.tiktok_handle,
      });
      setOk(true);
      setTimeout(() => setOk(false), 2500);
      onSaved?.();
    } catch (e) {
      setErr(e?.message || "No se pudo guardar. Si persiste, contáctanos por WhatsApp.");
    }
    setSaving(false);
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <Loader2 className="w-6 h-6 text-primary animate-spin" />
      <p className="text-xs text-muted-foreground">Cargando perfil...</p>
    </div>
  );
  if (!creator) return (
    <div className="bg-card border border-border/20 rounded-2xl p-6 text-center">
      <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">No se encontró tu perfil de creador. Verifica que tu correo coincida con el que usaste al postular.</p>
    </div>
  );
  const input = "w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary";

  return (
    <div className="bg-card border border-border/20 rounded-2xl p-4 space-y-3">
      <p className="text-[11px] text-muted-foreground font-bold uppercase flex items-center gap-1"><User className="w-3.5 h-3.5" /> Mi perfil</p>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground font-medium">Nombre / Apodo</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} /></label>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground font-medium">WhatsApp</span><input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className={input} /></label>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground font-medium">TikTok @usuario</span><input value={form.tiktok_handle} onChange={(e) => setForm({ ...form, tiktok_handle: e.target.value })} className={input} /></label>
      {err && <p className="text-xs text-destructive flex gap-1 items-start"><AlertTriangle className="w-4 h-4 mt-0.5" />{err}</p>}
      {ok && <p className="text-xs text-green-400 flex gap-1 items-center"><Check className="w-4 h-4" /> Perfil actualizado</p>}
      <Button onClick={save} disabled={saving} className="w-full font-bold">{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Guardar cambios</Button>
    </div>
  );
}