import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, Bot, User, Terminal, MessageSquare } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { callGemini } from "@/lib/geminiClient";
import { Button } from "@/components/ui/button";

const slug = (s = "") => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function fetchContext() {
  const [games, cards, services, settings, ordPend, ordProc, ordPart, creators, videos, prizeCodes] = await Promise.all([
    base44.entities.Game.list("-updated_date", 200).catch(() => []),
    base44.entities.GiftCard.list("-updated_date", 200).catch(() => []),
    base44.entities.Service.list("-updated_date", 200).catch(() => []),
    base44.entities.Setting.list("-updated_date", 200).catch(() => []),
    base44.entities.Order.filter({ status: "pending" }, "-created_date", 25).catch(() => []),
    base44.entities.Order.filter({ status: "processing" }, "-created_date", 15).catch(() => []),
    base44.entities.Order.filter({ status: "partial_payment" }, "-created_date", 15).catch(() => []),
    base44.entities.Creator.filter({ status: "pending" }, "-created_date", 25).catch(() => []),
    base44.entities.CreatorVideo.filter({ status: "pending" }, "-created_date", 25).catch(() => []),
    base44.entities.PrizeCode.list("-created_date", 100).catch(() => []),
  ]);
  const fmt = (arr) => (arr || []).map((p) => ({
    name: p.name, slug: p.slug, category: p.category, badge: p.badge,
    image_url: p.image_url || "",
    denominations: p.config?.denominations || [],
    requiresPlayerId: p.config?.requiresPlayerId || false,
  }));
  const fmtOrder = (o) => ({
    id: o.id, product_name: o.product_name, slug: o.product_slug,
    player_id: o.player_id, denomination: o.denomination,
    price: o.price, amount_paid: o.amount_paid, balance: o.balance,
    status: o.status, bank_reference: o.bank_reference,
    payment_method: o.payment_method, customer_email: o.customer_email,
    bot_tx_id: o.bot_tx_id, created_date: o.created_date,
  });
  const discounts = (settings || [])
    .filter((s) => s.key.startsWith("discount_"))
    .map((s) => ({ key: s.key, value: s.value }));
  const knownSettings = (settings || [])
    .filter((s) => !s.key.startsWith("discount_"))
    .reduce((acc, s) => { acc[s.key] = s.value; return acc; }, {});
  return {
    games: fmt(games), giftCards: fmt(cards), services: fmt(services),
    settings: knownSettings,
    discounts,
    orders: [...(ordPend || []), ...(ordProc || []), ...(ordPart || [])].map(fmtOrder),
    creators: (creators || []).map((c) => ({
      id: c.id, name: c.name, email: c.email, whatsapp: c.whatsapp,
      tiktok_handle: c.tiktok_handle, code: c.code, status: c.status, notes: c.notes,
    })),
    creatorVideos: (videos || []).map((v) => ({
      id: v.id, creator_email: v.creator_email, creator_name: v.creator_name,
      tiktok_url: v.tiktok_url, game: v.game, code: v.code,
      status: v.status, views_initial: v.views_initial, views_current: v.views_current,
      reward_tier: v.reward_tier, reward_label: v.reward_label,
    })),
    prizeCodes: (prizeCodes || []).map((pc) => ({
      id: pc.id, code: pc.code, prize_label: pc.prize_label, bot_product: pc.bot_product,
      max_uses: pc.max_uses, used_count: pc.used_count, status: pc.status,
      expires_date: pc.expires_date, notes: pc.notes,
    })),
    botProducts: [
      { key: "basica", nombre: "Tarjeta Básica" },
      { key: "semanal", nombre: "Tarjeta Semanal" },
      { key: "mensual", nombre: "Tarjeta Mensual" },
      { key: "booyah", nombre: "Pase Booyah" },
      { key: "nivel6", nombre: "Paquete Nivel 6" },
      { key: "nivel10", nombre: "Paquete Nivel 10" },
      { key: "nivel15", nombre: "Paquete Nivel 15" },
      { key: "nivel20", nombre: "Paquete Nivel 20" },
      { key: "nivel25", nombre: "Paquete Nivel 25" },
      { key: "nivel30", nombre: "Paquete Nivel 30" },
    ],
  };
}

async function applyAction(action) {
  const op = action.op;
  if (op === "update_setting") {
    const S = base44.entities.Setting;
    const existing = await S.filter({ key: action.key });
    if (existing?.length) await S.update(existing[0].id, { value: action.value });
    else await S.create({ key: action.key, value: action.value });
    return { ok: true, detail: `Ajuste ${action.key} actualizado` };
  }
  if (op === "update_order") {
    if (!action.id) return { ok: false, detail: "update_order requiere id" };
    const upd = {};
    for (const f of ["status", "bank_reference", "amount_paid", "balance", "price",
      "payment_method", "customer_email", "bot_tx_id", "player_id", "server", "denomination"]) {
      if (action[f] !== undefined) upd[f] = action[f];
    }
    await base44.entities.Order.update(action.id, upd);
    return { ok: true, detail: `Órden ${String(action.id).slice(-6)} actualizada` };
  }
  if (op === "delete_order") {
    if (!action.id) return { ok: false, detail: "delete_order requiere id" };
    await base44.entities.Order.delete(action.id);
    return { ok: true, detail: `Órden ${String(action.id).slice(-6)} eliminada` };
  }
  if (op === "create_discount" || op === "delete_discount") {
    const code = String(action.code || "").trim().toUpperCase();
    if (!code) return { ok: false, detail: `${op} requiere code` };
    const S = base44.entities.Setting;
    const key = `discount_${code}`;
    const existing = await S.filter({ key });
    if (op === "delete_discount") {
      if (!existing?.length) return { ok: false, detail: `Código ${code} no existe` };
      await S.delete(existing[0].id);
      return { ok: true, detail: `Código ${code} eliminado` };
    }
    const value = { kind: action.kind === "fixed" ? "fixed" : "percent", value: Number(action.value) || 0 };
    if (action.label) value.label = action.label;
    if (action.currency) value.currency = action.currency;
    if (existing?.length) await S.update(existing[0].id, { value: JSON.stringify(value) });
    else await S.create({ key, value: JSON.stringify(value) });
    return { ok: true, detail: `Código ${code} guardado (${value.kind} ${value.value})` };
  }
  if (op === "update_creator") {
    const E2 = base44.entities.Creator;
    let rec = action.id ? { id: action.id } : null;
    if (!rec && action.email) { const l = await E2.filter({ email: action.email }); rec = l?.[0]; }
    if (!rec) return { ok: false, detail: `Creador no encontrado: ${action.email || action.id || ""}` };
    const upd = {};
    for (const f of ["status", "notes", "panel_pin", "code", "tiktok_handle", "whatsapp"]) {
      if (action[f] !== undefined) upd[f] = action[f];
    }
    if (action.approved_date === "now" || upd.status === "approved") {
      upd.approved_date = new Date().toISOString();
    }
    await E2.update(rec.id, upd);
    return { ok: true, detail: `Creador ${rec.email || rec.id} actualizado (${upd.status || "ok"})` };
  }
  if (op === "update_creator_video") {
    if (!action.id) return { ok: false, detail: "update_creator_video requiere id" };
    const upd = {};
    for (const f of ["status", "reward_tier", "reward_label", "views_current", "views_initial", "manual_note"]) {
      if (action[f] !== undefined) upd[f] = action[f];
    }
    await base44.entities.CreatorVideo.update(action.id, upd);
    return { ok: true, detail: `Video ${String(action.id).slice(-6)} actualizado` };
  }
  if (op === "create_prize_code") {
    const E = base44.entities.PrizeCode;
    const prizeMap = {
      basica: "Tarjeta Básica", semanal: "Tarjeta Semanal",
      mensual: "Tarjeta Mensual", booyah: "Pase Booyah",
      nivel6: "Paquete Nivel 6", nivel10: "Paquete Nivel 10", nivel15: "Paquete Nivel 15",
      nivel20: "Paquete Nivel 20", nivel25: "Paquete Nivel 25", nivel30: "Paquete Nivel 30",
    };
    const botProduct = String(action.bot_product || "").trim();
    if (!prizeMap[botProduct]) return { ok: false, detail: `Producto de bot inválido: ${botProduct}` };
    const maxUses = Number(action.max_uses) || 1;
    const count = Math.min(Number(action.count) || 1, 50);
    const gen = () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let c = "LEGACY-";
      for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
      return c;
    };
    const records = [];
    for (let i = 0; i < count; i++) {
      records.push({
        code: action.code && count === 1 ? String(action.code).trim().toUpperCase() : gen(),
        prize_label: prizeMap[botProduct],
        bot_product: botProduct,
        max_uses: maxUses,
        used_count: 0,
        status: "active",
        expires_date: action.expires_date || undefined,
        notes: action.notes || "",
        redemption_log: [],
      });
    }
    if (records.length === 1) await E.create(records[0]);
    else await E.bulkCreate(records);
    const codesStr = records.map((r) => r.code).join(", ");
    return { ok: true, detail: `Código(s) creado(s): ${codesStr} (${prizeMap[botProduct]}, ${maxUses} uso(s) c/u)` };
  }
  if (op === "delete_prize_code") {
    const E = base44.entities.PrizeCode;
    let rec = action.id ? { id: action.id } : null;
    if (!rec && action.code) { const l = await E.filter({ code: String(action.code).trim().toUpperCase() }); rec = l?.[0]; }
    if (!rec) return { ok: false, detail: `Código no encontrado: ${action.code || action.id || ""}` };
    await E.delete(rec.id);
    return { ok: true, detail: `Código eliminado: ${action.code || rec.id}` };
  }
  if (op === "disable_prize_code") {
    const E = base44.entities.PrizeCode;
    let rec = action.id ? { id: action.id } : null;
    if (!rec && action.code) { const l = await E.filter({ code: String(action.code).trim().toUpperCase() }); rec = l?.[0]; }
    if (!rec) return { ok: false, detail: `Código no encontrado: ${action.code || action.id || ""}` };
    await E.update(rec.id, { status: "disabled" });
    return { ok: true, detail: `Código deshabilitado: ${action.code || rec.id}` };
  }

  const E = base44.entities[action.entity_type];
  if (!E) return { ok: false, detail: `Entidad inválida: ${action.entity_type}` };

  if (op === "create_product") {
    const data = {
      name: action.name,
      slug: action.slug || slug(action.name),
      image_url: action.image_url || "",
      category: action.category || "",
      badge: action.badge || "",
      description: action.description || "",
      config: action.config || { denominations: [] },
    };
    await E.create(data);
    return { ok: true, detail: `Creado ${action.entity_type}: ${action.name}` };
  }

  let record = action.id ? { id: action.id } : null;
  if (!record && action.identifier) {
    const list = await E.filter({ slug: action.identifier });
    record = list?.[0];
  }
  if (!record && action.name) {
    const list = await E.filter({ name: action.name });
    record = list?.[0];
  }
  if (!record) return { ok: false, detail: `No encontrado: ${action.identifier || action.name}` };

  if (op === "delete_product") {
    await E.delete(record.id);
    return { ok: true, detail: `Eliminado ${action.entity_type}: ${action.name || action.identifier}` };
  }
  if (op === "update_product") {
    const updates = {};
    for (const f of ["name", "slug", "image_url", "category", "badge", "description"]) {
      if (action[f] !== undefined) updates[f] = action[f];
    }
    if (action.config) updates.config = action.config;
    if (action.denominations) {
      const cur = record.config || {};
      updates.config = { ...cur, denominations: action.denominations };
    }
    await E.update(record.id, updates);
    return { ok: true, detail: `Actualizado ${action.entity_type}: ${action.name || action.identifier}` };
  }
  return { ok: false, detail: "Operación no soportada" };
}

function buildPrompt(userMessage, ctx) {
  return `Eres el asistente de administración todopoderoso de "Legacy Store", una tienda de recargas de videojuegos para Venezuela y LATAM. Tienes control total sobre el CATÁLOGO (juegos, gift cards y servicios), las ÓRDENES, los CREADORES (programa de creadores) y los videos de creadores, así como los AJUSTES generales y los CÓDIGOS DE DESCUENTO. Operas igual que un admin humano: lees el estado, decides y aplicas con acciones.

Estado actual (JSON):
${JSON.stringify(ctx, null, 0)}

Reglas:
- Cumple EXACTAMENTE el pedido del administrador. Razona brevemente en el reply.
- Para cambiar PRECIOS usa update_product con TODAS las denominaciones finales completas (label + price en USD). Recalcula si el admin pide subir/bajar un porcentaje.
- Para cambiar IMAGEN usa update_product con image_url (URL pública). No inventes URLs: si el admin no dio una, pídesela en el reply (no uses integraciones que consumen créditos; prefiere URL externa tipo catbox.moe o Unsplash).
- Para BUSCAR un producto usa identifier=slug o name.
- En update_product envía SOLO los campos que cambias; para denominaciones envía TODAS las finales.
- ÓRDENES: ya están en ctx.orders. Cambia estado, montos, referencia, email con update_order (id). Estados válidos: pending, processing, completed, cancelled, partial_payment.
- CREADORES: aprueba con update_creator status=approved (te asigna approved_date automático) o rechaza con status=rejected. Usa email como identificador.
- VIDEOS DE CREADORES: usa update_creator_video con status=approved|counting|manual|completed|rejected y reward_tier=none|inicial|intermedio|pro.
- CÓDIGOS DE DESCUENTO: créalos con create_discount { code, kind: "percent"|"fixed", value, label?, currency? } y elimínalos con delete_discount { code }.
- CÓDIGOS DE PREMIO (canjeables por productos del bot): créalos con create_prize_code { bot_product, max_uses, count?, code?, expires_date?, notes? }. bot_product debe ser uno de: basica, semanal, mensual, booyah, nivel6, nivel10, nivel15, nivel20, nivel25, nivel30. max_uses=1 para código único, N para multi-uso. count para generar lote (máx 50). Elimina con delete_prize_code { code } o deshabilita con disable_prize_code { code }.
- AJUSTES GENERALES: usa update_setting { key, value }. Para pago_movil, support, pabilo, gemini el value es un JSON stringificado. NO toques Settings con key que empiece por discount_ (usa create_discount/delete_discount).
- Si el admin solo pide ver/resumir info que ya está en ctx (órdenes pendientes, creadores pendientes), responde con un resumen legible sin crear acción.
- Responde en español, breve y orientado a acción.
- Devuelve SIEMPRE JSON: { reply: string, actions: array }.

Esquema de acciones:
- { "op": "create_product", "entity_type": "Game|GiftCard|Service", "name": "", "slug": "", "image_url": "", "category": "", "badge": "", "description": "", "config": { "denominations": [{"label":"","price":0}], "requiresPlayerId": false, "requiresServer": false, "idLabel": "", "idHint": "" } }
- { "op": "update_product", "entity_type": "Game|GiftCard|Service", "identifier": "slug", "name": "", "denominations": [{"label":"","price":0}], "config": {}, "image_url": "", "category": "", "badge": "", "description": "" }
- { "op": "delete_product", "entity_type": "Game|GiftCard|Service", "identifier": "slug", "name": "" }
- { "op": "update_order", "id": "", "status": "pending|processing|completed|cancelled|partial_payment", "bank_reference": "", "amount_paid": 0, "balance": 0, "price": 0, "payment_method": "", "customer_email": "", "bot_tx_id": "", "player_id": "", "server": "", "denomination": "" }
- { "op": "delete_order", "id": "" }
- { "op": "create_discount", "code": "NEXUS10", "kind": "percent|fixed", "value": 10, "label": "", "currency": "" }
- { "op": "delete_discount", "code": "NEXUS10" }
- { "op": "update_creator", "email": "", "status": "approved|rejected|pending", "notes": "", "panel_pin": "", "code": "", "tiktok_handle": "", "whatsapp": "", "approved_date": "now" }
- { "op": "update_creator_video", "id": "", "status": "approved|counting|manual|completed|rejected", "reward_tier": "none|inicial|intermedio|pro", "reward_label": "", "views_current": 0, "manual_note": "" }
- { "op": "update_setting", "key": "pago_movil", "value": "{json string}" }
- { "op": "create_prize_code", "bot_product": "mensual", "max_uses": 1, "count": 5, "notes": "Sorteo live" }
- { "op": "delete_prize_code", "code": "LEGACY-XXXXXX" }
- { "op": "disable_prize_code", "code": "LEGACY-XXXXXX" }

Pedido del administrador: "${userMessage}"`;
}

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  required: ["reply", "actions"],
};

const EXAMPLES = [
  "Cambia el precio de 240 Diamantes de Free Fire a $3.50",
  "Agrega 5000 Diamantes a Free Fire a $70",
  "Sube el precio de todas las gift cards de Roblox 10%",
  "Crea un nuevo juego: Clash Royale con denominaciones 500 Gemas $5, 1200 Gemas $10",
  "Genera 10 códigos de premio para Tarjeta Mensual, 1 uso cada uno",
  "Crea un código LEGACY-VIP para Pase Booyah con 5 usos",
];

export default function AIAssistant() {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hola 👋 Soy el asistente de Legacy Store. Dime qué quieres cambiar en el catálogo (precios, denoms, nuevos productos) y lo aplico." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("chat");
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setBusy(true);
    try {
      const ctx = await fetchContext();
      const res = await callGemini({
        prompt: buildPrompt(msg, ctx),
        responseJsonSchema: SCHEMA,
      });
      const reply = res?.reply || "Listo.";
      let results = [];
      if (Array.isArray(res?.actions) && res.actions.length) {
        for (const a of res.actions) {
          try {
            results.push(await applyAction(a));
          } catch (e) {
            results.push({ ok: false, detail: e.message || "error" });
          }
        }
        window.dispatchEvent(new Event("catalog-changed"));
      }
      const summary = results.length
        ? "\n\n✅ " + results.filter((r) => r.ok).map((r) => r.detail).join("\n✅ ") +
          (results.some((r) => !r.ok) ? "\n\n⚠️ " + results.filter((r) => !r.ok).map((r) => r.detail).join("\n⚠️ ") : "")
        : "";
      setMessages((m) => [...m, { role: "assistant", text: reply + summary }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: "Error: " + (e.message || "no pude procesar") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[70vh]">
      <div className="flex items-center gap-1 mb-3 p-1 bg-muted rounded-lg border border-border/30 w-fit text-xs">
        <button onClick={() => setMode("chat")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${mode === "chat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </button>
        <button onClick={() => setMode("terminal")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${mode === "terminal" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          <Terminal className="w-3.5 h-3.5" /> Terminal
        </button>
      </div>
      {mode === "terminal" ? (
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-black/70 rounded-lg p-3 font-mono text-xs scrollbar-hide border border-border/40 space-y-1">
          {messages.map((m, i) => (
            <div key={i} className="whitespace-pre-wrap leading-relaxed">
              <span className={m.role === "user" ? "text-primary" : "text-green-400"}>{m.role === "user" ? "$ " : "› "}</span>
              <span className={m.role === "user" ? "text-foreground" : "text-muted-foreground"}>{m.text}</span>
            </div>
          ))}
          {busy && <div className="text-yellow-400">› ejecutando...</div>}
        </div>
      ) : (
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-hide">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
            }`}>
              {m.text}
            </div>
            {m.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            </div>
            <div className="bg-muted rounded-2xl px-4 py-2.5 text-sm text-muted-foreground">Pensando y aplicando cambios...</div>
          </div>
        )}
      </div>
      )}

      {messages.length <= 1 && !busy && (
        <div className="flex flex-wrap gap-2 py-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => send(ex)}
              className="text-xs bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-full border border-border/30 flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3 text-primary" /> {ex}
            </button>
          ))}
        </div>
      )}

      <div className={`flex gap-2 pt-3 border-t border-border/20 ${mode === "terminal" ? "items-center bg-black/70 rounded-lg px-3 py-2 border border-border/40" : ""}`}>
        {mode === "terminal" && <span className="text-primary font-mono text-sm select-none">$</span>}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={mode === "terminal" ? "escribe un comando..." : "Ej: Sube el precio de Free Fire 10%..."}
          className={mode === "terminal"
            ? "flex-1 bg-transparent border-none font-mono text-sm text-green-100 placeholder:text-muted-foreground/60 focus:outline-none px-0 py-1"
            : "flex-1 bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"}
        />
        <Button onClick={() => send()} disabled={busy} className="h-11 px-4">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}