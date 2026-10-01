import { useState, useEffect } from "react";
import { Save, Loader2, Upload, ImageIcon, Star } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

const Setting = base44.entities.Setting;
const UploadFile = base44.integrations.Core.UploadFile;

const KEYS = [
  { key: "carousel_creators", label: "Banner Creadores", hint: "Slide con botón “Postúlate aquí” fijo hacia /creadores. Sube tu imagen con el texto ya incluido." },
  { key: "carousel_1", label: "Banner 2", hint: "Banner promocional del carrusel." },
  { key: "carousel_2", label: "Banner 3", hint: "Banner promocional del carrusel." },
  { key: "carousel_3", label: "Banner 4", hint: "Banner promocional del carrusel." },
];

const RECOMMENDED = "864 × 323 px (o el doble 1728 × 646) — proporción ~2.67:1";

export default function CarouselEditor() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [creatorsEnabled, setCreatorsEnabled] = useState(true);

  // Sube la imagen con UploadFile (créditos de integración) y deja la URL en el
  // campo. Si falla o se acaban los créditos, el admin puede usar el botón
  // "Subir gratis" (catbox) y pegar la URL manualmente como respaldo.
  const onUpload = async (k, file) => {
    if (!file) return;
    setUploadingKey(k.key);
    try {
      const res = await UploadFile({ file });
      if (res?.file_url) setUrl(k, res.file_url);
      else alert("No se pudo subir la imagen. Usa el botón “Subir gratis” (catbox) como respaldo.");
    } catch (e) {
      alert("Subida falló. Usa el botón “Subir gratis” (catbox) como respaldo: " + (e?.message || ""));
    } finally {
      setUploadingKey(null);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const all = await Setting.list("-updated_date", 200).catch(() => []);
      if (!active) return;
      const map = {};
      (all || []).forEach((s) => { if (KEYS.find((k) => k.key === s.key)) map[s.key] = s; });
      setValues(map);
      const toggleRec = (all || []).find((s) => s.key === "carousel_creators_enabled");
      setCreatorsEnabled(toggleRec ? toggleRec.value !== "false" : true);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const setUrl = (k, url) => {
    setValues((prev) => {
      const rec = prev[k.key];
      return { ...prev, [k.key]: { ...rec, value: url, key: k.key, id: rec?.id } };
    });
  };

  const openHost = () => window.open("https://catbox.moe/", "_blank", "noopener,noreferrer");

  const save = async (k) => {
    setSaving(k.key);
    const rec = values[k.key];
    try {
      if (rec?.id) await Setting.update(rec.id, { value: rec.value || "" });
      else await Setting.create({ key: k.key, value: rec?.value || "" });
      const all = await Setting.filter({ key: k.key });
      setValues((prev) => ({ ...prev, [k.key]: all?.[0] || prev[k.key] }));
    } catch (e) {
      alert("Error al guardar: " + (e?.message || ""));
    } finally {
      setSaving(null);
    }
  };

  const toggleCreators = async (checked) => {
    setCreatorsEnabled(checked);
    try {
      const existing = await Setting.filter({ key: "carousel_creators_enabled" });
      if (existing?.[0]) await Setting.update(existing[0].id, { value: String(checked) });
      else await Setting.create({ key: "carousel_creators_enabled", value: String(checked) });
    } catch (e) {
      alert("No se pudo guardar el interruptor: " + (e?.message || ""));
      setCreatorsEnabled(!checked);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-muted/30 border border-border/20 rounded-xl p-4 text-xs text-muted-foreground">
        <span className="font-bold text-foreground">Tamaño recomendado: </span>{RECOMMENDED}.<br />
        Formato .webp o .png para mejor compresión. Sube tu imagen gratis en{" "}
        <a href="https://catbox.moe/" target="_blank" rel="noopener noreferrer" className="text-primary underline">catbox.moe</a>, copia el enlace y pégalo abajo (sin consumir créditos). El slide de Creadores siempre lleva el botón “Postúlate aquí”.
      </div>

      {KEYS.map((k) => {
        const rec = values[k.key];
        const url = rec?.value || "";
        return (
          <div key={k.key} className="bg-card border border-border/20 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                {k.key === "carousel_creators" && <Star className="w-4 h-4 text-pink-400" />}
                {k.label}
              </h3>
              {url && <img src={url} alt="preview" className="h-9 w-auto rounded border border-border/20 max-w-[140px] object-cover" />}
            </div>
            <p className="text-xs text-muted-foreground mb-3">{k.hint}</p>
            {k.key === "carousel_creators" && (
              <div className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2 mb-3">
                <span className="text-xs font-medium text-foreground">Mostrar evento en el carrusel</span>
                <Switch checked={creatorsEnabled} onCheckedChange={toggleCreators} />
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(k, e.target.value)}
                placeholder="Pega la URL (catbox) o súbelo con el botón"
                className="flex-1 bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
              />
              <label className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50">
                {uploadingKey === k.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingKey === k.key ? "Subiendo..." : "Subir"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) onUpload(k, e.target.files[0]); e.target.value = ""; }}
                />
              </label>
              <button type="button" onClick={openHost} className="inline-flex items-center justify-center gap-2 bg-secondary text-secondary-foreground border border-border/30 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-secondary/80 transition-colors">
                <Upload className="w-4 h-4" /> Subir gratis
              </button>
            </div>

            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={() => save(k)} disabled={saving === k.key} className="h-9">
                {saving === k.key ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Guardar
              </Button>
            </div>
          </div>
        );
      })}

      <p className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
        <ImageIcon className="w-3.5 h-3.5" /> Los cambios se reflejan en el carrusel del Home al recargar la tienda.
      </p>
    </div>
  );
}