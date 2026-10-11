import { useState, useEffect } from "react";
import { Ticket, Plus, Trash2, Copy, Loader2, Check, Edit3, X, UserCheck, EyeOff, Tag, ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { getPurchaseConfig } from "@/data/purchaseConfig";
import { normalizeLabel } from "@/utils/normalizeLabel";

const Setting = base44.entities.Setting;

// Catálogo de paquetes AGRUPADO POR JUEGO para el selector de alcance.
// Prioridad: el catálogo REAL guardado en la DB (los labels que el cliente ve
// en el checkout, sincronizados desde Venium). El catálogo estático de
// purchaseConfig queda de respaldo por si la DB falla o falta algún producto.
// Devuelve [{ key, name, items: [label, ...] }] ordenado por nombre de juego.
async function loadCatalogGroups() {
  const groups = new Map();
  const add = (name, label) => {
    const gname = String(name || "").trim();
    const l = String(label || "").trim();
    if (!gname || !l) return;
    const key = normalizeLabel(gname);
    let g = groups.get(key);
    if (!g) { g = { key, name: gname, seen: new Set(), items: [] }; groups.set(key, g); }
    const lk = normalizeLabel(l);
    if (g.seen.has(lk)) return;
    g.seen.add(lk);
    g.items.push(l);
  };

  try {
    const entities = [base44.entities.Game, base44.entities.GiftCard, base44.entities.Service];
    for (const E of entities) {
      const list = await E.list("-updated_date", 200);
      (list || []).forEach((p) => {
        const name = p?.name || p?.slug || "";
        (p?.config?.denominations || []).forEach((d) => add(name, d?.label));
      });
    }
  } catch {}

  const games = ["free-fire", "mobile-legends", "wild-rift", "call-of-duty-mobile", "genshin-impact", "blood-strike"];
  const giftCards = ["apple-usa", "roblox-gift-card", "riot-access", "playstation", "steam-usa", "xbox-gift-card"];
  for (const slug of [...games, ...giftCards]) {
    try {
      const cfg = getPurchaseConfig(slug, slug);
      const items = Array.isArray(cfg?.denominations) ? cfg.denominations : [];
      for (const d of items) add(cfg?.title || slug, d?.label);
    } catch {}
  }

  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      name: g.name,
      items: g.items.sort((a, b) => a.localeCompare(b, "es")),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// Un paquete elegido se guarda con su juego delante ("Free Fire · 110 Diamantes")
// para que un precio fijo NO se cruce con un paquete que se llama igual en otro
// juego. Las entradas viejas (solo el label) siguen funcionando: aplican a ese
// paquete en cualquier juego.
function scopeEntry(groupName, option) {
  const g = String(groupName || "").trim();
  const o = String(option || "").trim();
  // El cajón de paquetes que ya no están en el catálogo guarda el label tal cual.
  if (!g || g === "Otros paquetes") return o;
  return `${g} · ${o}`;
}

// ¿Este paquete (de este juego) está dentro del alcance guardado?
function isSelected(option, groupName, list) {
  const nl = normalizeLabel(option);
  const ng = normalizeLabel(groupName);
  return (list || []).some((x) => {
    const e = String(x || "").trim();
    if (!e) return false;
    if (e.includes("·")) {
      const [g, l] = e.split("·");
      return normalizeLabel(g) === ng && normalizeLabel(l) === nl;
    }
    return normalizeLabel(e) === nl;
  });
}

// Lista de paquetes agrupada por juego: un encabezado por juego que se abre al
// tocarlo, para elegir el paquete exacto sin perderse entre los paquetes de
// todos los juegos mezclados en una sola lista.
// onToggle recibe (juego, paquete) para guardar la entrada con su juego.
function PackageScopePicker({ groups, selected, onToggle, openGroups, onToggleGroup }) {
  if (!groups.length) {
    return <div className="text-xs text-muted-foreground py-2 px-1">No hay paquetes disponibles.</div>;
  }
  return (
    <div className="border border-border/30 rounded-lg bg-muted/20 overflow-hidden">
      <div className="max-h-72 overflow-y-auto divide-y divide-border/20">
        {groups.map((g) => {
          const open = openGroups.has(g.key);
          const count = g.items.filter((it) => isSelected(it, g.name, selected)).length;
          return (
            <div key={g.key}>
              <button
                type="button"
                onClick={() => onToggleGroup(g.key)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
              >
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                <span className="text-sm font-bold text-foreground flex-1 truncate">{g.name}</span>
                {count > 0 && (
                  <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full shrink-0">
                    {count} elegido{count === 1 ? "" : "s"}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground shrink-0">{g.items.length}</span>
              </button>
              {open && (
                <div className="px-2 pb-2 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1 bg-card/40">
                  {g.items.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onToggle(g.name, option)}
                      className={[
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                        isSelected(option, g.name, selected)
                          ? "bg-primary/10 text-primary border border-primary/30"
                          : "bg-input border border-border/30 text-foreground hover:border-primary/50",
                      ].join(" ")}
                    >
                      <span className="shrink-0">
                        {isSelected(option, g.name, selected) ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <div className="w-4 h-4 rounded border border-current/40 flex items-center justify-center text-[10px]" />
                        )}
                      </span>
                      <span className="truncate">{option}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const [appliesToPackages, setAppliesToPackages] = useState([]);
  // Modo del monto fijo: "discount" resta del total; "price" fija el PRECIO
  // FINAL del paquete elegido (ej: 760 Bs al paquete de 110 diamantes).
  const [fixedMode, setFixedMode] = useState("discount");

  const [editValue, setEditValue] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editNewCustomerOnly, setEditNewCustomerOnly] = useState(false);
  const [editNotNewMessage, setEditNotNewMessage] = useState("");
  const [editAppliesToPackages, setEditAppliesToPackages] = useState([]);
  const [editFixedMode, setEditFixedMode] = useState("discount");

  const [showScope, setShowScope] = useState(false);
  // Catálogo agrupado por juego y qué juegos están abiertos en el selector.
  const [scopeGroups, setScopeGroups] = useState([]);
  const [openGroups, setOpenGroups] = useState(() => new Set());

  // Carga el catálogo agrupado una vez al abrir la sección.
  useEffect(() => {
    let active = true;
    loadCatalogGroups().then((list) => { if (active) setScopeGroups(list); });
    return () => { active = false; };
  }, []);

  function toggleGroup(key) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Abre solo los juegos que ya tienen paquetes elegidos (crear o editar): si
  // el código apunta a "110 Diamantes", Free Fire queda abierto de una.
  useEffect(() => {
    const selected = [...appliesToPackages, ...editAppliesToPackages];
    if (!selected.length) return;
    setOpenGroups((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const g of scopeGroups) {
        const hit = g.items.some((it) => isSelected(it, g.name, selected));
        if (hit && !next.has(g.key)) { next.add(g.key); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [scopeGroups, appliesToPackages, editAppliesToPackages]);

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
          const appliesToPackages = Array.isArray(cfg?.applies_to_packages) ? cfg.applies_to_packages : [];
          return {
            id: s.id,
            key: s.key,
            code: codeName,
            kind: cfg.kind === "fixed" ? "fixed" : "percent",
            mode: cfg.mode === "price" ? "price" : "discount",
            value: Number(cfg.value) || 0,
            label: cfg.label || "",
            currency: cfg.currency || "",
            new_customer_only: !!cfg.new_customer_only,
            not_new_message: cfg.not_new_message || "",
            applies_to_packages: appliesToPackages,
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
    if (kind === "fixed" && fixedMode === "price" && appliesToPackages.length === 0) {
      alert("Un precio fijo necesita al menos un paquete: elige a qué paquete se le aplica el monto.");
      return;
    }
    setSaving(true);
    try {
      const key = `discount_${c}`;
      const existing = await Setting.filter({ key });
      if (existing?.length) { alert("Ese código ya existe"); return; }
      const isPriceFixed = kind === "fixed" && fixedMode === "price";
      const cfg = {
        kind,
        mode: kind === "fixed" ? fixedMode : undefined,
        value: v,
        label: label || (isPriceFixed
          ? `Precio especial: ${v} ${currency}`
          : `${v}${kind === "percent" ? "%" : ` ${currency}`} de descuento`),
        currency: kind === "fixed" ? currency : undefined,
        new_customer_only: newCustomerOnly,
        not_new_message: newCustomerOnly ? notNewMessage : undefined,
        ...(kind === "fixed" && appliesToPackages.length ? { applies_to_packages: appliesToPackages } : {}),
      };
      await Setting.create({ key, value: JSON.stringify(cfg) });
      setCode(""); setValue(""); setLabel(""); setNewCustomerOnly(false); setNotNewMessage(""); setAppliesToPackages([]);
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
    // Los paquetes guardados en el código se suman al catálogo aunque ya no
    // estén en él (si no, el admin no podría quitarlos): van a "Otros paquetes".
    const saved = Array.isArray(c.applies_to_packages) ? c.applies_to_packages : [];
    setEditAppliesToPackages(saved);
    if (saved.length) {
      setScopeGroups((prev) => {
        const missing = saved.filter(
          (entry) => !prev.some((g) => g.items.some((it) => isSelected(it, g.name, [entry])))
        );
        if (!missing.length) return prev;
        const key = normalizeLabel("Otros paquetes");
        if (prev.some((g) => g.key === key)) {
          return prev.map((g) => g.key === key ? { ...g, items: [...g.items, ...missing] } : g);
        }
        return [...prev, { key, name: "Otros paquetes", items: missing }];
      });
    }
    setEditFixedMode(c.mode === "price" ? "price" : "discount");
    setShowScope(c.kind === "fixed");
  }

  async function handleSaveEdit(c) {
    const v = Number(editValue);
    if (!v || v <= 0) { alert("Valor inválido"); return; }
    if (c.kind === "fixed" && editFixedMode === "price" && editAppliesToPackages.length === 0) {
      alert("Un precio fijo necesita al menos un paquete: elige a qué paquete se le aplica el monto.");
      return;
    }
    setSaving(true);
    try {
      const isPriceFixed = c.kind === "fixed" && editFixedMode === "price";
      const cfg = {
        kind: c.kind,
        mode: c.kind === "fixed" ? editFixedMode : undefined,
        value: v,
        label: editLabel || (isPriceFixed
          ? `Precio especial: ${v} ${c.currency}`
          : `${v}${c.kind === "percent" ? "%" : ` ${c.currency}`} de descuento`),
        currency: c.kind === "fixed" ? c.currency : undefined,
        new_customer_only: editNewCustomerOnly,
        not_new_message: editNewCustomerOnly ? editNotNewMessage : undefined,
        ...(c.kind === "fixed" && editAppliesToPackages.length ? { applies_to_packages: editAppliesToPackages } : {}),
      };
      await Setting.update(c.id, { value: JSON.stringify(cfg) });
      setEditingId(null);
      setShowScope(false);
      await load();
    } catch (e) {
      alert("Error: " + (e.message || "no se pudo guardar"));
    } finally {
      setSaving(false);
    }
  }

  // Marca/desmarca un paquete dentro de su juego. Guarda "Juego · Paquete"
  // (salvo en "Otros paquetes", que mantiene el label original).
  function toggleInScope(list, setList, groupName, option) {
    const nl = normalizeLabel(option);
    const ng = normalizeLabel(groupName);
    const idx = list.findIndex((x) => {
      const e = String(x || "").trim();
      if (!e) return false;
      if (e.includes("·")) {
        const [g, l] = e.split("·");
        return normalizeLabel(g) === ng && normalizeLabel(l) === nl;
      }
      return normalizeLabel(e) === nl;
    });
    if (idx >= 0) {
      const next = list.slice();
      next.splice(idx, 1);
      setList(next);
      return;
    }
    setList([...list, scopeEntry(groupName, option)]);
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
              onChange={(e) => {
                setKind(e.target.value);
                setShowScope(e.target.value === "fixed");
              }}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="percent">Porcentaje (%)</option>
              <option value="fixed">Monto fijo</option>
            </select>
          </div>

          {kind === "fixed" && (
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">¿Cómo se aplica el monto fijo?</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFixedMode("discount")}
                  className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                    fixedMode === "discount" ? "border-primary/60 bg-primary/10" : "border-border/30 bg-input hover:border-primary/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    {fixedMode === "discount" && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                    Descuento (resta del total)
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    Al total del pedido se le resta el monto. Ej: total 1.000 Bs y monto 200 → paga 800 Bs.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { setFixedMode("price"); setShowScope(true); }}
                  className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                    fixedMode === "price" ? "border-primary/60 bg-primary/10" : "border-border/30 bg-input hover:border-primary/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    {fixedMode === "price" && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                    Precio fijo del paquete
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    El paquete elegido queda EXACTAMENTE en ese monto. Ej: 760 Bs al paquete de 110 diamantes.
                  </span>
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {kind === "percent" ? "Porcentaje (%)" : (fixedMode === "price" ? "Precio final del paquete" : "Monto a descontar")}
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "percent" ? "2" : "760"}
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
              placeholder="Ej: 10% de descuento en tu primera compra"
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Alcance por paquete (solo montos fijos) */}
          {kind === "fixed" && (
            <div className="sm:col-span-2">
              <div className="flex items-start justify-between gap-3 bg-muted/30 border border-border/30 rounded-lg p-3">
                <label className="flex flex-col min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <Tag className="w-3.5 h-3.5 text-primary" />
                    {fixedMode === "price" ? "Paquete(s) con este precio (obligatorio)" : "Aplica solo a estos paquetes"}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {fixedMode === "price"
                      ? "Elige el paquete exacto al que se le aplica el precio fijo. Solo ese paquete queda en el monto que definiste."
                      : "Opcional. Si eliges paquetes, el código se puede aplicar solo a esos productos. Si no eliges ninguno, aplica a todos los paquetes."}
                  </span>
                </label>
                {fixedMode === "price" ? (
                  <span className="mt-0.5 inline-flex items-center text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full shrink-0">
                    OBLIGATORIO
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={showScope}
                    onChange={(e) => setShowScope(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[hsl(var(--primary))] shrink-0"
                  />
                )}
              </div>

              {(showScope || fixedMode === "price") && (
                <div className="mt-3">
                  <PackageScopePicker
                    groups={scopeGroups}
                    selected={appliesToPackages}
                    onToggle={(groupName, option) => toggleInScope(appliesToPackages, setAppliesToPackages, groupName, option)}
                    openGroups={openGroups}
                    onToggleGroup={toggleGroup}
                  />
                </div>
              )}
            </div>
          )}

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
                        {c.kind === "percent" ? "Porcentaje" : (editFixedMode === "price" ? "Precio fijo del paquete" : "Monto fijo (descuento)")}
                      </span>
                    </div>

                    {c.kind === "fixed" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEditFixedMode("discount")}
                          className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                            editFixedMode === "discount" ? "border-primary/60 bg-primary/10" : "border-border/30 bg-input hover:border-primary/40"
                          }`}
                        >
                          <span className="block text-xs font-bold text-foreground">Descuento (resta del total)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditFixedMode("price")}
                          className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                            editFixedMode === "price" ? "border-primary/60 bg-primary/10" : "border-border/30 bg-input hover:border-primary/40"
                          }`}
                        >
                          <span className="block text-xs font-bold text-foreground">Precio fijo del paquete</span>
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          {c.kind === "percent" ? "Porcentaje (%)" : (editFixedMode === "price" ? "Precio final del paquete" : `Monto (${c.currency})`)}
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

                    {/* Alcance por paquete en edición (solo fijo) */}
                    {c.kind === "fixed" && (
                      <div className="sm:col-span-2">
                        <div className="flex items-start justify-between gap-3 bg-muted/30 border border-border/30 rounded-lg p-3">
                          <label className="flex flex-col min-w-0">
                            <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                              <Tag className="w-3.5 h-3.5 text-primary" />
                              {editFixedMode === "price" ? "Paquete(s) con este precio (obligatorio)" : "Aplica solo a estos paquetes"}
                            </span>
                            <span className="block text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              {editFixedMode === "price"
                                ? "Solo el paquete elegido queda en el monto del código."
                                : "Opcional: limita el código a los paquetes que elijas."}
                            </span>
                          </label>
                          {editFixedMode === "price" ? (
                            <span className="mt-0.5 inline-flex items-center text-[10px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full shrink-0">
                              OBLIGATORIO
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={editAppliesToPackages.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) setEditAppliesToPackages(editAppliesToPackages.length ? editAppliesToPackages : (scopeGroups[0]?.items?.[0] ? [scopeGroups[0].items[0]] : []));
                                else setEditAppliesToPackages([]);
                              }}
                              className="mt-0.5 w-4 h-4 accent-[hsl(var(--primary))] shrink-0"
                            />
                          )}
                        </div>

                        {(editAppliesToPackages.length > 0 || editFixedMode === "price") && (
                          <div className="mt-3">
                            <PackageScopePicker
                              groups={scopeGroups}
                              selected={editAppliesToPackages}
                              onToggle={(groupName, option) => toggleInScope(editAppliesToPackages, setEditAppliesToPackages, groupName, option)}
                              openGroups={openGroups}
                              onToggleGroup={toggleGroup}
                            />
                          </div>
                        )}
                      </div>
                    )}

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
                      {c.kind === "percent"
                        ? `${c.value}%`
                        : (c.mode === "price" ? `${c.value} ${c.currency} · PRECIO FIJO` : `${c.value} ${c.currency} de descuento`)}
                    </span>
                    {c.new_customer_only && (
                      <span
                        className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                        title="Solo funciona para quien nunca ha comprado y no se muestra en la portada"
                      >
                        <EyeOff className="w-3 h-3" /> SOLO NUEVOS
                      </span>
                    )}
                    {c.applies_to_packages && c.applies_to_packages.length > 0 && (
                      <span
                        className="text-[10px] font-medium text-muted-foreground bg-muted/50 border border-border/30 px-2 py-0.5 rounded-full truncate max-w-[260px]"
                        title={c.applies_to_packages.join(", ")}
                      >
                        {c.applies_to_packages.length === 1 ? c.applies_to_packages[0] : `${c.applies_to_packages.length} productos`}
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
