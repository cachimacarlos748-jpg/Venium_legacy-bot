import { useState } from "react";
import { Save, Trash2, Loader2, ChevronDown, Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import DenominationEditor from "./DenominationEditor";

const FIELD_VISIBILITY = {
  Game: { category: true, badge: true, description: true },
  GiftCard: { category: false, badge: false, description: false },
  Service: { category: false, badge: false, description: true },
};

export default function ProductEditor({ entityName, initial, onChanged }) {
  const Entity = base44.entities[entityName];
  const vis = FIELD_VISIBILITY[entityName] || {};
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set("image_url", file_url);
    } catch (err) {
      alert("Error al subir imagen: " + (err.message || ""));
    } finally {
      setUploading(false);
    }
  };
  const [form, setForm] = useState({
    name: initial.name || "",
    slug: initial.slug || "",
    image_url: initial.image_url || "",
    category: initial.category || "",
    badge: initial.badge || "",
    description: initial.description || "",
    config: {
      denominations: initial.config?.denominations || [],
      requiresPlayerId: initial.config?.requiresPlayerId ?? false,
      requiresServer: initial.config?.requiresServer ?? false,
      idLabel: initial.config?.idLabel || "ID de jugador",
      idHint: initial.config?.idHint || "",
    },
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setCfg = (k, v) => setForm((f) => ({ ...f, config: { ...f.config, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await Entity.update(initial.id, form);
      if (onChanged) onChanged();
      setOpen(false);
    } catch (e) {
      alert(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`¿Eliminar "${form.name}"?`)) return;
    try {
      await Entity.delete(initial.id);
      if (onChanged) onChanged();
    } catch (e) {
      alert(e.message || "Error al eliminar");
    }
  };

  return (
    <div className="bg-card border border-border/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <img src={form.image_url} alt="" className="w-10 h-10 rounded-lg object-cover bg-muted" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{form.name || "(sin nombre)"}</p>
          <p className="text-xs text-muted-foreground truncate">
            {form.config.denominations.length} denominaciones
            {form.config.requiresPlayerId ? " · requiere ID" : ""}
          </p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="p-2 text-muted-foreground hover:text-foreground">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button onClick={remove} className="p-2 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="p-3 pt-0 space-y-3 border-t border-border/10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
            <Field label="Nombre" value={form.name} onChange={(v) => set("name", v)} />
            <Field label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", v)} />
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground font-medium">Imagen (logo)</label>
              <div className="flex gap-2">
                <input
                  value={form.image_url}
                  onChange={(e) => set("image_url", e.target.value)}
                  placeholder="URL de la imagen o sube un archivo"
                  className="flex-1 bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                />
                <label className="shrink-0 inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-secondary/80 transition-colors">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? "Subiendo..." : "Subir"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
              </div>
              {form.image_url && (
                <img src={form.image_url} alt="" className="mt-2 w-20 h-20 rounded-lg object-cover border border-border/30 bg-muted" />
              )}
            </div>
            {vis.category && <Field label="Categoría" value={form.category} onChange={(v) => set("category", v)} />}
            {vis.badge && <Field label="Badge" value={form.badge} onChange={(v) => set("badge", v)} />}
            {vis.description && (
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground font-medium">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  rows={2}
                  className="w-full bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            )}
          </div>

          {entityName !== "Service" && (
            <>
              <DenominationEditor denominations={form.config.denominations} onChange={(d) => setCfg("denominations", d)} />
              <div className="flex flex-wrap gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.config.requiresPlayerId} onChange={(e) => setCfg("requiresPlayerId", e.target.checked)} />
                  Requiere ID de jugador
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.config.requiresServer} onChange={(e) => setCfg("requiresServer", e.target.checked)} />
                  Requiere zona/server
                </label>
              </div>
              {form.config.requiresPlayerId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Etiqueta ID" value={form.config.idLabel} onChange={(v) => setCfg("idLabel", v)} />
                  <div className="sm:col-span-2">
                    <Field label="Pista (hint)" value={form.config.idHint} onChange={(v) => setCfg("idHint", v)} full />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={save} disabled={saving} className="h-9">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, full }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
      />
    </div>
  );
}