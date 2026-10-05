import { useState, useEffect } from "react";
import { Ticket, Plus, Trash2, Copy, Loader2, Check, Edit3, X, UserCheck, EyeOff } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

const Setting = base44.entities.Setting;

export default function DiscountCodesTab() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState("percent");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [newCustomerOnly, setNewCustomerOnly] = useState(false);
  const [notNewMessage, setNotNewMessage] = useState("");

  const [editValue, setEditValue] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editNewCustomerOnly, setEditNewCustomerOnly] = useState(false);
  const [editNotNewMessage, setEditNotNewMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const all = await Setting.list("-updated_date", 200);
      const found = (all || [])
        .filter((s) => s.key && s.key.startsWith("discount_"))
        .map((s) => {
          const codeName = s.key.replace("discount_", "");
          let cfg = {};
          try { cfg = JSON.parse(s.value); } catch {}
          return {
            id: s.id,
            key: s.key,
            code: codeName,
            kind: cfg.kind === "fixed" ? "fixed" : "percent",
            value: Number(cfg.value) || 0,
            label: cfg.label || "",
            currency: cfg.currency || "",
            new_customer_only: !!cfg.new_customer_only,
            not_new_message: cfg.not_new_message || "",
          };
        })
        .filter((c) => c.value > 0);
      setCodes(found);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const c = code.trim().toUpperCase();
    if (!c) { alert("Ingresa un código"); return; }
    const v = Number(value);
    if (!v || v <= 0) { alert("Ingresa un valor válido"); return; }
    setSaving(true);
    try {
      const key = `discount_${c}`;
      const existing = await Setting.filter({ key });
      if (existing?.length) { alert("Ese código ya existe"); return; }
      const cfg = {
        kind,
        value: v,
        label: label || `${v}${kind === "percent" ? "%" : ` ${currency}`} de descuento`,
        currency: kind === "fixed" ? currency : undefined,
        new_customer_only: newCustomerOnly,
        not_new_message: newCustomerOnly ? notNewMessage : undefined,
      };
      await Setting.create({ key, value: JSON.stringify(cfg) });
      setCode(""); setValue(""); setLabel(""); setNewCustomerOnly(false); setNotNewMessage("");
      await load();
    } catch (e) {
      alert("Error: " + (e.message || "no se pudo crear"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este código de descuento?")) return;
    await Setting.delete(id);
    await load();
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditValue(String(c.value));
    setEditLabel(c.label || "");
    setEditNewCustomerOnly(!!c.new_customer_only);
    setEditNotNewMessage(c.not_new_message || "");
  }

  async function handleSaveEdit(c) {
    const v = Number(editValue);
    if (!v || v <= 0) { alert("Valor inválido"); return; }
    setSaving(true);
    try {
      const cfg = {
        kind: c.kind,
        value: v,
        label: editLabel || `${v}${c.kind === "percent" ? "%" : ` ${c.currency}`} de descuento`,
        currency: c.kind === "fixed" ? c.currency : undefined,
        new_customer_only: editNewCustomerOnly,
        not_new_message: editNewCustomerOnly ? editNotNewMessage : undefined,
      };
      await Setting.update(c.id, { value: JSON.stringify(cfg) });
      setEditingId(null);
      await load();
    } catch (e) {
      alert("Error: " + (e.message || "no se pudo guardar"));
    } finally {
      setSaving(false);
    }
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="bg-card rounded-xl border border-border/30 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Ticket className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-foreground">Crear código de descuento</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Código</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="LEGACY"
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm font-bold tracking-wider text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tipo de descuento</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="percent">Porcentaje (%)</option>
              <option value="fixed">Monto fijo</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {kind === "percent" ? "Porcentaje (%)" : "Monto"}
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "percent" ? "2" : "50"}
              min="0"
              step={kind === "percent" ? "1" : "0.01"}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {kind === "fixed" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Moneda</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                <option value="USD">USD</option>
                <option value="VES">VES (Bs)</option>
              </select>
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Etiqueta (opcional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: 2% de descuento en tu próxima compra"
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="flex items-start gap-3 cursor-pointer bg-muted/30 border border-border/30 rounded-lg p-3 hover:border-primary/50 transition-colors">
              <input
                type="checkbox"
                checked={newCustomerOnly}
                onChange={(e) => setNewCustomerOnly(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[hsl(var(--primary))] shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                  <UserCheck className="w-3.5 h-3.5 text-primary" /> Solo para clientes nuevos
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Para códigos que se publican en publicidad. Solo funcionará a quien nunca ha
                  comprado: si el cliente ya tiene pedidos, verá una ventana diciéndole que el
                  código es solo de primera compra. Este código <strong>tampoco aparecerá</strong> en
                  la sección de cupones de la portada.
                </span>
              </span>
            </label>
          </div>

          {newCustomerOnly && (
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">
                Mensaje para quien ya compró (opcional)
              </label>
              <textarea
                value={notNewMessage}
                onChange={(e) => setNotNewMessage(e.target.value)}
                rows={2}
                placeholder="Este código es solo para tu primera compra. Como ya tienes pedidos con nosotros, no se puede aplicar."
                className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Si lo dejas vacío se usa un mensaje por defecto.
              </p>
            </div>
          )}
        </div>

        <Button onClick={handleCreate} disabled={saving} className="mt-4 w-full sm:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Crear código
        </Button>
      </div>

      {/* Codes list */}
      <div>
        <h2 className="font-bold text-foreground mb-3">Códigos activos ({codes.length})</h2>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : codes.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm bg-card rounded-xl border border-border/30">
            No hay códigos de descuento. Crea el primero arriba.
          </div>
        ) : (
          <div className="space-y-2">
            {codes.map((c) => (
              <div key={c.id} className="bg-card rounded-lg border border-border/30 p-3 sm:p-4">
                {editingId === c.id ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold text-foreground tracking-wider">{c.code}</code>
                      <span className="text-xs text-muted-foreground">
                        {c.kind === "percent" ? "Porcentaje" : "Monto fijo"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          {c.kind === "percent" ? "Porcentaje (%)" : `Monto (${c.currency})`}
                        </label>
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          min="0"
                          step={c.kind === "percent" ? "1" : "0.01"}
                          className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Etiqueta</label>
                        <input
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={editNewCustomerOnly}
                        onChange={(e) => setEditNewCustomerOnly(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[hsl(var(--primary))] shrink-0"
                      />
                      <span className="text-xs text-foreground font-medium leading-relaxed">
                        Solo para clientes nuevos (no aparece en la portada)
                      </span>
                    </label>
                    {editNewCustomerOnly && (
                      <div className="sm:col-span-2">
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Mensaje para quien ya compró
                        </label>
                        <textarea
                          value={editNotNewMessage}
                          onChange={(e) => setEditNotNewMessage(e.target.value)}
                          rows={2}
                          placeholder="Este código es solo para tu primera compra..."
                          className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button onClick={() => handleSaveEdit(c)} disabled={saving} size="sm">
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Guardar
                      </Button>
                      <Button onClick={() => setEditingId(null)} variant="outline" size="sm">
                        <X className="w-3.5 h-3.5" /> Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold text-foreground tracking-wider">{c.code}</code>
                      <button onClick={() => copyCode(c.code)} className="text-muted-foreground hover:text-primary">
                        {copied === c.code ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {c.kind === "percent" ? `${c.value}%` : `${c.value} ${c.currency}`}
                    </span>
                    {c.new_customer_only && (
                      <span
                        className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                        title="Solo funciona para quien nunca ha comprado y no se muestra en la portada"
                      >
                        <EyeOff className="w-3 h-3" /> SOLO NUEVOS
                      </span>
                    )}
                    {c.label && <span className="text-xs text-muted-foreground truncate">{c.label}</span>}
                    <div className="flex gap-1 ml-auto">
                      <button onClick={() => startEdit(c)} className="p-1.5 text-muted-foreground hover:text-primary rounded transition-colors" title="Editar">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 text-muted-foreground hover:text-red-400 rounded transition-colors" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}