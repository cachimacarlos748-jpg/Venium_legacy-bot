import { useState, useEffect } from "react";
import { Loader2, Save, Plus, Trash2, Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAYMENT_METHODS, PAYMENT_TYPES } from "@/lib/paymentMethods";

const Setting = base44.entities.Setting;

export default function PaymentMethodsEditor() {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rec, setRec] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const recs = await Setting.filter({ key: "payment_methods" }).catch(() => []);
      const r = recs?.[0];
      setRec(r);
      if (r?.value) {
        try { setMethods(JSON.parse(r.value)); } catch { setMethods([]); }
      }
      setLoading(false);
    })();
  }, []);

  const upload = async (i, file) => {
    if (!file) return;
    setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, _uploading: true } : m)));
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, image_url: file_url, _uploading: false } : m)));
    } catch {
      setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, _uploading: false } : m)));
      setMsg("No se pudo subir el logo. Verifica tu conexión.");
    }
  };

  const uploadQR = async (i, file) => {
    if (!file) return;
    setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, _qrUploading: true } : m)));
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, qr_url: file_url, _qrUploading: false } : m)));
    } catch {
      setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, _qrUploading: false } : m)));
      setMsg("No se pudo subir el QR. Verifica tu conexión.");
    }
  };

  const update = (i, field, v) => setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: v } : m)));
  const updateField = (i, key, v) =>
    setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, fields: { ...(m.fields || {}), [key]: v } } : m)));
  const add = () =>
    setMethods((prev) => [
      ...prev,
      { id: "nuevo-" + Date.now(), type: "otro", name: "Nuevo método", desc: "", icon: "💳", image_url: "", fields: {} },
    ]);
  const remove = (i) => setMethods((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    const clean = methods.map(({ _uploading, _qrUploading, ...rest }) => ({
      ...rest,
      id: (rest.id || rest.name || "metodo")
        .toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "metodo",
    }));
    const value = JSON.stringify(clean);
    try {
      if (rec?.id) await Setting.update(rec.id, { value });
      else { const c = await Setting.create({ key: "payment_methods", value }); setRec(c); }
      setMethods(clean);
      setMsg("Guardado");
    } catch (e) {
      setMsg("Error: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>;

  return (
    <div className="bg-card border border-border/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Métodos de pago</h3>
          <p className="text-xs text-muted-foreground">Elige el tipo de cada método y completa los datos que verá el cliente.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={add}><Plus className="w-4 h-4 mr-1" /> Agregar</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Guardar
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {methods.map((m, i) => {
          const type = PAYMENT_TYPES[m.type] || PAYMENT_TYPES.otro;
          return (
            <div key={i} className="border border-border/20 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 border border-border/20">
                  {m.image_url ? <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" /> : <span className="text-xl">{m.icon || "💳"}</span>}
                </div>
                <input value={m.name} onChange={(e) => update(i, "name", e.target.value)} placeholder="Nombre (ej: Pago Móvil)" className="flex-1 min-w-0 bg-muted border border-border/30 rounded-lg px-2.5 py-2 text-sm text-foreground" />
                <button onClick={() => remove(i)} className="text-destructive hover:bg-destructive/10 rounded-md p-1.5 flex-shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <input value={m.desc} onChange={(e) => update(i, "desc", e.target.value)} placeholder="Descripción corta" className="w-full bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground" />

              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer px-2 py-1.5 rounded-lg border border-border/30 hover:bg-muted whitespace-nowrap">
                  {m._uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Subir logo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(i, e.target.files[0])} />
                </label>
                <input value={m.image_url} onChange={(e) => update(i, "image_url", e.target.value)} placeholder="o pega la URL del logo" className="flex-1 min-w-0 bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground" />
              </div>

              {type.qr && (
                <div className="border-t border-border/10 pt-2 space-y-2">
                  <span className="text-xs text-muted-foreground font-medium">Código QR</span>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer px-2 py-1.5 rounded-lg border border-border/30 hover:bg-muted whitespace-nowrap">
                      {m._qrUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      Subir QR
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadQR(i, e.target.files[0])} />
                    </label>
                    <input value={m.qr_url || ""} onChange={(e) => update(i, "qr_url", e.target.value)} placeholder="o pega la URL del QR" className="flex-1 min-w-0 bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground" />
                  </div>
                  {m.qr_url && <img src={m.qr_url} alt="QR" className="w-24 h-24 rounded-lg object-contain border border-border/30 bg-white p-1" />}
                </div>
              )}

              <div className="border-t border-border/10 pt-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-muted-foreground font-medium">Tipo de pago</span>
                  <select
                    value={m.type || "otro"}
                    onChange={(e) => update(i, "type", e.target.value)}
                    className="bg-muted border border-border/30 rounded-lg px-2 py-1.5 text-sm text-foreground"
                  >
                    {Object.entries(PAYMENT_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {type.fields.map((f) => (
                    <div key={f.key}>
                      <label className="text-xs text-muted-foreground font-medium">{f.label}</label>
                      <input
                        value={m.fields?.[f.key] || ""}
                        onChange={(e) => updateField(i, f.key, e.target.value)}
                        placeholder={f.label}
                        className="w-full bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {methods.length === 0 && (
          <p className="text-xs text-muted-foreground">No hay métodos. Pulsa “Agregar” para crear uno.</p>
        )}
      </div>
      {msg && <p className="text-xs text-muted-foreground mt-2">{msg}</p>}
    </div>
  );
}