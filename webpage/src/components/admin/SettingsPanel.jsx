import { useState, useEffect } from "react";
import { Save, Loader2, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { syncVeniumCatalog } from "@/lib/veniumClient";
import PaymentMethodsEditor from "@/components/admin/PaymentMethodsEditor";

const PLACEHOLDER = {
  base: "https://mobentas.com",
  markup: "5 (%)",
  currency: "Bs o USD",
  tasa: "Bs por USD (ej: 120)",
  proxy: "https://mobentas-proxy.tu-subdominio.workers.dev (Cloudflare Worker)",
  enabled: "true o false",
  user_bank_id: "ID de tu cuenta bancaria en Pabilo",
  whatsapp: "Ej: 584121234567 (sin + ni espacios)",
  channel_url: "Link de invitación a tu canal/comunidad",
  channel_name: "Nombre visible (ej: Comunidad Vex Store)",
  bot_token: "Token de tu bot de Telegram (creado con BotFather)",
  chat_id: "Chat ID o @nombreCanal donde recibes las notificaciones",
  instance_id: "ID de instancia de UltraMsg (ej: instance12345)",
  token: "Token de tu API de UltraMsg",
  admin_number: "Tu WhatsApp para recibir notificaciones (ej: 58412925597)",
};


const KEYS = [
  { key: "pago_movil", label: "Datos Pago Móvil", fields: ["banco", "titular", "cedula", "telefono"], json: true },
  { key: "pabilo", label: "Pabilo (verificación de pagos)", fields: ["api_key", "user_bank_id"], json: true },
  { key: "moogold", label: "MooGold (proveedor de recargas)", fields: ["user_id", "partner_id", "secret"], json: true },
  { key: "gemini", label: "Gemini API (asistente IA — expuesto)", fields: ["api_key", "base_url", "model"], json: true },
  { key: "support", label: "Soporte y Comunidad (WhatsApp + canal)", fields: ["whatsapp", "channel_url", "channel_name"], json: true },
  { key: "telegram", label: "Telegram (notificaciones de recargas)", fields: ["bot_token", "chat_id"], json: true },
  { key: "whatsapp_api", label: "WhatsApp API (envío automático + notificaciones admin)", fields: ["instance_id", "token", "admin_number"], json: true },
  { key: "mobentas", label: "Mobentas (verificación de ID + catálogo)", fields: ["enabled", "base", "markup", "currency", "tasa", "proxy"], json: true },
];

const Setting = base44.entities.Setting;

function SyncVeniumButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const run = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await syncVeniumCatalog();
      if (res?.ok) setMsg(`OK: ${res.created} nuevos · ${res.updated} actualizados · ${res.failed} fallidos`);
      else setMsg("Error: " + (res?.error || "no disponible"));
    } catch (e) { setMsg("Error: " + (e?.message || "")); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" onClick={run} disabled={busy} className="h-9">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
        {busy ? "Sincronizando..." : "Sincronizar catálogo"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}

export default function SettingsPanel() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const all = await Setting.list("-updated_date", 100).catch(() => []);
      const map = {};
      (all || []).forEach((s) => {
        if (KEYS.find((k) => k.key === s.key)) {
          map[s.key] = s;
        }
      });
      if (active) { setValues(map); setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const getForm = (k) => {
    const rec = values[k.key];
    if (k.json) {
      try { return rec?.value ? JSON.parse(rec.value) : {}; } catch { return {}; }
    }
    return { valor: rec?.value || "" };
  };

  const setField = (k, field, v) => {
    setValues((prev) => {
      const rec = prev[k.key];
      const form = getForm(k);
      form[field] = v;
      const value = k.json ? JSON.stringify(form) : form.valor;
      return { ...prev, [k.key]: { ...rec, value, key: k.key, id: rec?.id } };
    });
  };

  const save = async (k) => {
    setSaving(k.key);
    const rec = values[k.key];
    if (rec?.id) {
      await Setting.update(rec.id, { value: rec.value });
    } else {
      await Setting.create({ key: k.key, value: rec.value });
    }
    // reload to get id
    const all = await Setting.filter({ key: k.key });
    setValues((prev) => ({ ...prev, [k.key]: all?.[0] || prev[k.key] }));
    setSaving(null);
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="bg-card border border-border/20 rounded-xl p-4">
        <h3 className="text-sm font-bold text-foreground mb-1">Venium (proveedor de recargas)</h3>
        <p className="text-xs text-muted-foreground mb-3">Sincroniza el catálogo de juegos y precios desde Venium.</p>
        <SyncVeniumButton />
      </div>
      <PaymentMethodsEditor />
      {KEYS.map((k) => {
        const form = getForm(k);
        return (
          <div key={k.key} className="bg-card border border-border/20 rounded-xl p-4">
            <h3 className="text-sm font-bold text-foreground mb-3">{k.label}</h3>
            <div className="space-y-3">
              {k.fields.map((f) => (
                <div key={f}>
                  <label className="text-xs text-muted-foreground font-medium capitalize">{f}</label>
                  <input
                    value={form[f] || ""}
                    onChange={(e) => setField(k, f, e.target.value)}
                    placeholder={PLACEHOLDER[f] || ""}
                    className="w-full bg-muted border border-border/30 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end items-end gap-2 mt-3">

              <Button size="sm" onClick={() => save(k)} disabled={saving === k.key} className="h-9">
                {saving === k.key ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Guardar
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}