const $ = (id) => document.getElementById(id);
const state = { dashboard: null, orders: [], customers: [], filter: "" };

// ---- Realtime event log shared by the 'En vivo' view and sound alerts ----
state.liveEvents = [];
let liveConnected = false;

async function json(url, options) {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { error: text }; }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
function toast(msg, isError) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => { t.className = "toast"; }, 2600);
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtMoney(v) { return "Bs " + Number(v || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"; }
function shortId(id) { return String(id || "").slice(0, 8); }

const statusMap = {
  quote_created: ["quote_created", "warn"], awaiting_payment: ["esperando pago", "warn"],
  approved_for_venium: ["aprobado", "brand"], venium_pending: ["en cola (sin saldo)", "warn"], venium_processing: ["procesando Venium", "brand"],
  completed: ["completado", "ok"], delivered: ["entregado", "ok"], cancelled: ["cancelado", "bad"], refunded: ["reembolsado", "bad"],
};
function pillStatus(status) { const pair = statusMap[status] || [status, ""]; return `<span class="pill ${pair[1]}"><span class="dot"></span>${esc(pair[0])}</span>`; }
function pillPayment(ps) {
  const map = { not_submitted: ["sin pago", ""], checking: ["verificando", "brand"], verified_new: ["verificado", "ok"], suspicious: ["sospechoso", "bad"], duplicate: ["duplicado", "bad"], error: ["error", "bad"] };
  const pair = map[ps] || [ps, "warn"];
  return `<span class="pill ${pair[1]}">${esc(pair[0])}</span>`;
}
function providerPill(status) {
  const map = { live: ["live", "ok"], mock: ["mock", "warn"], disabled: ["off", ""], "missing-secret": ["falta clave", "bad"] };
  const pair = map[status] || [status, ""];
  return `<span class="pill ${pair[1]}">${esc(pair[0])}</span>`;
}
// WhatsApp no devuelve una simple etiqueta en /api/admin/status: devuelve su
// estado completo (modo + conexión). Sin esto la tabla imprimía [object Object].
function whatsappProviderCell(status) {
  if (!status || typeof status !== "object") return providerPill(status);
  const label = status.enabled === false ? "disabled" : "live";
  const conn = status.connection === "open" ? "conectado"
    : status.connection === "pairing" ? "esperando el vínculo"
      : status.connection === "connecting" ? "restaurando la sesión"
        : "desconectado";
  return `${providerPill(label)} <span class="muted" style="font-size:12.5px">· ${esc(conn)}</span>`;
}

/* ---------- navegación entre pantallas ----------
 * Cada sección es una pantalla de la app. La barra inferior solo existe en las
 * 4 pestañas raíz (Chats, Pedidos, Clientes, Ajustes); lo demás se abre desde
 * Ajustes o desde el menú ⋮ y se vuelve con la flecha. */
const ROOT_TABS = ["chats", "orders", "customers", "settings"];

function closeMenus() {
  document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
}

function showView(name) {
  if (!name) return;
  document.querySelectorAll(".screen.view").forEach((v) => v.classList.remove("active"));
  const screen = $("view-" + name);
  if (screen) {
    screen.classList.add("active");
    screen.scrollTop = 0;
    const body = screen.querySelector(".screen-body");
    if (body) body.scrollTop = 0;
  }
  document.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  const phone = $("phone");
  if (phone) phone.classList.toggle("root", ROOT_TABS.includes(name));
  // Cambiar de pantalla cierra la conversación y la ficha del cliente.
  document.body.classList.remove("chat-open");
  document.body.classList.remove("info-open");
  closeMenus();
  try { history.replaceState(null, "", "#" + name); } catch {}
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav && nav.dataset.view) {
    if (nav.dataset.closeMenu) closeMenus();
    showView(nav.dataset.view);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "order") openOrder(action.dataset.id);
  if (action.dataset.action === "retry-venium") retryVenium(action.dataset.id);
  if (action.dataset.action === "cancel-order") cancelOrder(action.dataset.id);
  if (action.dataset.action === "unblock") unblockCustomer(action.dataset.jid);
  if (action.dataset.action === "crm-block") crmBlockCustomer(action.dataset.jid);
  if (action.dataset.action === "sync-catalog") syncCatalog();
  if (action.dataset.action === "load-banks") loadBanks();
  if (action.dataset.action === "live-open") openThread(action.dataset.jid);
});

/* ---------- dashboard ---------- */
function renderDashboard(d) {
  const k = d.kpis;
  $("alerts").innerHTML = (d.alerts || []).map((a) => `<div class="alert ${a.level}"><span>${a.level === "critical" ? "🚨" : a.level === "warning" ? "⚠️" : "ℹ️"}</span><div><b>${esc(a.title)}.</b> ${esc(a.detail)}</div></div>`).join("");
  const cards = [
    ["Ventas hoy", fmtMoney(k.revenueBsToday), `${k.ordersToday} pedidos · $${k.revenueUsdToday}`],
    ["Ventas 7 días", fmtMoney(k.revenueBs7d), `${k.orders7d} pedidos · $${k.revenueUsd7d}`],
    ["Margen 7 días", `$${k.marginUsd7d}`, `costo $${k.costUsd7d} · ticket ${fmtMoney(k.averageTicketBs7d)}`],
    ["Conversión 7d", k.conversionRate7d + "%", `${k.ordersPendingPayment} sin pagar · ${k.ordersCompleted} completados`],
    ["Pedidos totales", k.totalOrders, `${k.activeCustomers} clientes`],
    ["En revisión", k.ordersSuspicious, "pagos sospechosos por revisar"],
    ["Clientes bloqueados", k.blockedUsers, "por moderación"],
    ["Webhooks fallidos", k.failedWebhooks, "eventos de Venium con error"],
  ];
  $("kpiCards").innerHTML = cards.map((c) => `<div class="card"><div class="k-l">${esc(c[0])}</div><div class="k-v">${esc(c[1])}</div><div class="k-s">${esc(c[2])}</div></div>`).join("");

  const max = Math.max(1, ...d.sales7d.map((s) => Number(s.revenueBs)));
  $("salesChart").innerHTML = d.sales7d.map((s) => {
    const h = Math.max(3, Math.round((Number(s.revenueBs) / max) * 100));
    return `<div class="bar-wrap" title="${esc(s.day)}: ${esc(s.revenueBs)} Bs · ${s.orders} pedidos"><span class="bar-value">${s.orders || ""}</span><div class="bar" style="height:${h}%"></div><span class="bar-label">${s.day.slice(5)}</span></div>`;
  }).join("");

  $("topPackages").innerHTML = d.topPackages.length
    ? d.topPackages.map((p, i) => `<div class="row"><span class="ico">#${i + 1}</span><span class="rt"><span class="t1">${esc(p.name)}</span><span class="t2">${p.orders} pedidos</span></span><span class="rv"><b>${fmtMoney(p.revenueBs)}</b></span></div>`).join("")
    : `<div class="empty">Aún no hay ventas registradas.</div>`;

  $("recentOrders").innerHTML = d.recentOrders.length
    ? d.recentOrders.map((o) => `<div class="row"><span class="ico">🧾</span><span class="rt"><span class="t1">${esc(o.productName)} · ${esc(o.packageName)}</span><span class="t2">${esc(o.whatsappJid || "—")} · ${shortId(o.id)}</span></span><span class="rv">${pillStatus(o.status)}<br /><b>${fmtMoney(o.salePriceBsTotal)}</b></span></div>`).join("")
    : `<div class="empty">Sin pedidos todavía. Escribe CATÁLOGO al bot para probar.</div>`;

  const prov = d.providers || {};
  $("providerRows").innerHTML = [
    ["Venium", prov.venium], ["Pabilo", prov.pabilo], ["Gemini", prov.gemini], ["WhatsApp", prov.whatsapp],
    ["BDV (banco)", prov.bdv],
  ].map((row) => `<div class="row"><span class="rt"><span class="t1">${esc(row[0])}</span></span><span class="rv">${providerPill(row[1])}</span></div>`).join("")
  + `<div class="row"><span class="rt"><span class="t1">Creación live de órdenes</span></span><span class="rv">${d.safety && d.safety.liveVeniumOrderCreation ? '<span class="pill ok">permitida</span>' : '<span class="pill warn">bloqueada</span>'}</span></div>`;

  const wa = d.whatsappStatus || {};
  $("connLabel").textContent = wa.connection === "open" ? "WhatsApp conectado" : `WhatsApp ${wa.connection || "desconectado"}`;
  const open = wa.connection === "open";
  const chip = $("connChip");
  if (chip) chip.className = "conn-chip" + (open ? " ok" : "");
  const dot = $("connDot");
  if (dot) dot.className = "live-dot" + (open ? " on" : "");
  const sub = $("settingsSub");
  if (sub) sub.textContent = open
    ? `Bot conectado · ${k.ordersToday} pedidos hoy`
    : `Bot ${wa.connection || "desconectado"} · ${k.ordersToday} pedidos hoy`;
  $("genLabel").textContent = "Datos de " + fmtDate(d.generatedAt);

  $("ordersBadge").style.display = k.ordersPendingPayment > 0 ? "" : "none";
  $("ordersBadge").textContent = k.ordersPendingPayment;
  $("secBadge").style.display = k.ordersSuspicious + k.failedWebhooks > 0 ? "" : "none";
  $("secBadge").textContent = k.ordersSuspicious + k.failedWebhooks;
}

/* ---------- orders ---------- */
// Los pedidos se muestran como tarjetas: en un teléfono una tabla de 9
// columnas no se lee, y así cada venta trae su estado y sus botones.
function renderOrders() {
  const f = state.filter.toLowerCase();
  const rows = state.orders.filter((o) => !f || JSON.stringify(o).toLowerCase().includes(f));
  $("ordersTable").innerHTML = rows.length
    ? rows.map((o) => {
      const player = o.playerData && typeof o.playerData === "object"
        ? Object.entries(o.playerData).map(([k, v]) => `${esc(k)}: <strong>${esc(v)}</strong>`).join(" · ")
        : "";
      return `<div class="ocard">
        <div class="top">
          <span class="ttl">${esc(o.productName)} · ${esc(o.packageName)}</span>
          ${pillStatus(o.status)}
        </div>
        <div class="meta">
          ${player ? `<div>Jugador: ${player}</div>` : ""}
          <div>Total: <strong>${fmtMoney(o.salePriceBsTotal)}</strong> · cantidad ${esc(o.quantity ?? 1)}</div>
          <div>Cliente: ${esc(o.whatsappJid || "—")}</div>
          <div>Pago: ${esc(o.paymentStatus)}${o.veniumOrderId ? ` · Venium ${esc(o.veniumOrderId)}` : ""}</div>
          <div>${fmtDate(o.createdAt)} · <span class="mono">${shortId(o.id)}</span></div>
        </div>
        <div class="acts">
          <button class="btn ghost" data-action="order" data-id="${esc(o.id)}">Ver detalle</button>
          ${o.status === "venium_pending" ? `<button class="btn" data-action="retry-venium" data-id="${esc(o.id)}">Reintentar</button>` : ""}
          ${!CANCELLABLE.has(o.status) ? `<button class="btn ghost danger" data-action="cancel-order" data-id="${esc(o.id)}">Cancelar</button>` : ""}
        </div>
      </div>`;
    }).join("")
    : `<div class="empty">Sin pedidos que coincidan.</div>`;
}
// Estados de los que NO se puede cancelar: ya son definitivos (venta hecha
// o pedido ya cancelado). Todo lo demás (quote_created, esperando pago, en
// cola, procesando) sí se puede cancelar desde el CRM.
const CANCELLABLE = new Set(["completed", "delivered", "delivered_code", "done", "success", "cancelled", "canceled", "refunded"]);
// Cancela un pedido desde el CRM: para cuando el dueño ya completó la recarga
// por fuera, o para frenar una recarga duplicada antes de que salga a Venium.
async function cancelOrder(id) {
  if (!confirm("¿Cancelar este pedido?\n\nQueda marcado como CANCELADO y el bot lo deja de reintentar/enviar a Venium. Usalo si ya completaste la recarga por fuera del panel o el pedido está duplicado.")) return;
  try {
    await json("/api/admin/orders/" + id + "/cancel", { method: "POST" });
    toast("✅ Pedido cancelado");
    state.orders = await json("/api/admin/orders");
    renderOrders();
  } catch (e) { toast(e.message, true); }
}
async function retryVenium(id) {
  try {
    const r = await json("/api/admin/orders/" + id + "/retry-venium", { method: "POST" });
    toast(r.retried ? "✅ Enviado a Venium: " + r.veniumOrder : "Sin cambios", false);
    state.orders = await json("/api/admin/orders");
    renderOrders();
  } catch (e) { toast(e.message, true); }
}
/* ---------- recargas en cola (procesado a mano) ---------- */
// El bot NO reenvía solo las recargas que quedaron esperando saldo: el dueño
// recarga la billetera y aprieta el botón. Así una recarga vieja (o una que
// salió mal) no se dispara sola en el momento en que entra saldo.
async function loadPendingVenium() {
  const btn = $("processPendingBtn");
  const hint = $("pendingVeniumHint");
  try {
    const d = await json("/api/admin/orders/pending-venium");
    const n = d.count || 0;
    const auto = d.autoRetry ? " · reenvío automático ACTIVADO" : " · nada sale hasta que pulses el botón";
    btn.disabled = n === 0;
    btn.textContent = n
      ? `⚡ Procesar ${n} recarga${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"}`
      : "⚡ Procesar recargas pendientes";
    if (!n) { hint.textContent = "Ninguna recarga en cola." + auto; return; }
    const detail = (d.orders || []).slice(0, 8)
      .map((o) => `${shortId(o.id)} · ${[o.productName, o.packageName].filter(Boolean).join(" ")} · ${fmtMoney(o.salePriceBsTotal)}`)
      .join("  |  ");
    hint.textContent = `${n} pedido${n === 1 ? "" : "s"} pagado${n === 1 ? "" : "s"} esperando saldo: ${detail}${n > 8 ? " …" : ""}${auto}`;
  } catch (e) {
    btn.disabled = true;
    hint.textContent = "No se pudo leer la cola: " + e.message;
  }
}
async function processPendingVenium() {
  const btn = $("processPendingBtn");
  if (!confirm("¿Ya recargaste la billetera de tu proveedor?\n\nSe enviarán a Venium TODAS las recargas en cola (no solo la última).")) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Procesando…";
  try {
    const r = await json("/api/admin/orders/process-pending", { method: "POST" });
    const failed = (r.results || []).filter((x) => !x.ok);
    if (r.sent) {
      toast(`✅ ${r.sent} recarga(s) enviada(s) a Venium${failed.length ? ` · ${failed.length} siguen en cola` : ""}`);
    } else {
      toast(failed.length ? `No se pudo enviar ninguna: ${failed[0].error || "sin saldo en Venium"}` : "No había recargas en cola", true);
    }
    if (failed.length) console.warn("[panel] recargas que siguen en cola:", failed);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.textContent = label;
    await loadOrders();
  }
}

async function openOrder(id) {
  try {
    const d = await json("/api/admin/orders/" + id);
    const o = d.order;
    const lines = [
      `Pedido ${o.id}`,
      `Cliente: ${o.whatsappJid || "—"}`,
      `Producto: ${o.productName} — ${o.packageName} (x${o.quantity})`,
      `Jugador: ${JSON.stringify(o.playerData)}`,
      `Total: ${fmtMoney(o.salePriceBsTotal)} (costo $${o.costUsdTotal})`,
      `Estado: ${o.status} · Pago: ${o.paymentStatus}`,
      o.veniumOrderId ? `Venium: ${o.veniumOrderId}` : "Venium: —",
      "",
      "Historial:",
      ...d.history.map((h) => `· ${fmtDate(h.createdAt)} ${h.fromStatus || "∅"} → ${h.toStatus} (${h.source})`),
    ];
    if (d.attempts.length) lines.push("", "Intentos de pago:", ...d.attempts.map((a) => `· ${fmtDate(a.createdAt)} ref ${a.reference} · ${a.amountBs} Bs · Pabilo: ${a.pabiloStatus}${a.antifraudReason ? " · " + a.antifraudReason : ""}`));
    alert(lines.join("\n"));
  } catch (e) { toast(e.message, true); }
}

/* ---------- chats (live inbox) ---------- */
let activeJid = null;
let lastMsgId = 0;
let pendingQuote = null;
state.chatQuery = "";
state.chatFilter = "all";
state.lastMsgMeta = null;
state.lastRenderedDay = "";

/* --- helpers de interfaz estilo WhatsApp --- */
const WA_COLORS = ["#00a884", "#53bdeb", "#7f66ff", "#e0a63c", "#d97373", "#43b581", "#c477e0"];
function waColor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WA_COLORS[h % WA_COLORS.length];
}
function waInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "#").toUpperCase();
}
function waAvatar(name, seed, size) {
  const s = size || 46;
  return `<div class="wa-avatar" style="width:${s}px;height:${s}px;background:${waColor(seed)};font-size:${Math.round(s * 0.34)}px">${esc(waInitials(name))}</div>`;
}
function fmtThreadTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Hoy";
  if (d.toDateString() === y.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-VE", { weekday: "long", day: "numeric", month: "long" });
}

async function loadChats() {
  const d = await json("/api/admin/chats");
  const threads = d.threads || [];
  state.chatThreads = threads;
  const badge = $("chatsBadge");
  badge.style.display = d.unread + d.handoff > 0 ? "" : "none";
  badge.textContent = d.unread + d.handoff;
  renderThreads();
}

/* Palomitas de WhatsApp: grises cuando responde el bot, azules cuando
   escribes tú (en WhatsApp el azul significa "leído"). */
function tickSvg(read) {
  return `<svg class="tick-svg${read ? " read" : ""}" viewBox="0 0 18 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M1 6.6l3.1 3.1L10.4 3.4"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M6.8 9.7l1.5 1.5L16.9 2.9"/></svg>`;
}

// El filtro y la búsqueda se resuelven en el navegador sobre lo que ya trajo el
// servidor: buscar un chat no dispara peticiones nuevas.
function visibleThreads() {
  const q = (state.chatQuery || "").trim().toLowerCase();
  const filter = state.chatFilter || "all";
  return (state.chatThreads || []).filter((t) => {
    if (filter === "unread" && !(t.unread > 0)) return false;
    if (filter === "mine" && !t.handoff) return false;
    if (filter === "bot" && t.handoff) return false;
    if (!q) return true;
    return [t.name, t.phoneDisplay, t.whatsappJid, t.lastMessage]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });
}

function renderThreads() {
  const threads = visibleThreads();
  const total = (state.chatThreads || []).length;
  $("chatThreads").innerHTML = threads.length
    ? threads.map((t) => {
      const active = t.whatsappJid === activeJid ? " active" : "";
      const name = t.name || t.phoneDisplay || t.whatsappJid;
      const out = t.lastDirection !== "in";
      const media = /Foto/.test(t.lastMessage || "") || /^\s*📎/.test(t.lastMessage || "");
      const text = esc((t.lastMessage || "").replace(/^📸\s*/, "").slice(0, 60));
      const preview = `<span class="txt">${text}</span>`;
      return `<div class="thread-item${active}" data-jid="${esc(t.whatsappJid)}">
        ${waAvatar(name, t.whatsappJid, 50)}
        <div class="t-body">
          <div class="t-row1"><span class="t-name">${esc(name)}</span><span class="t-time${t.unread > 0 ? " unread" : ""}">${fmtThreadTime(t.lastAt)}</span></div>
          <div class="t-row2">
            <span class="t-last">${t.handoff ? '<span class="t-hand" title="Lo atiendes tú">🙋</span>' : ""}${out ? tickSvg(t.lastSource === "human") : ""}${media ? "🏞" : ""}${preview}</span>
            ${t.unread > 0 ? `<span class="t-unread">${t.unread}</span>` : ""}
          </div>
        </div>
      </div>`;
    }).join("")
    : `<div class="empty">${total ? "Ningún chat coincide con la búsqueda o el filtro." : "Aún no hay conversaciones. Llegarán cuando escriban al bot."}</div>`;
  document.querySelectorAll(".thread-item").forEach((el) => {
    el.addEventListener("click", () => openThread(el.dataset.jid));
  });
  // La píldora "No leídos" lleva el número de chats, como en WhatsApp.
  const pill = $("pillUnread");
  if (pill) pill.textContent = (state.chatThreads || []).filter((t) => t.unread > 0).length;
}

async function openThread(jid) {
  activeJid = jid;
  lastMsgId = 0;
  document.body.classList.remove("info-open");
  document.body.classList.add("chat-open");
  renderThreads();
  const d = await json("/api/admin/chats/" + encodeURIComponent(jid) + "/messages");
  lastMsgId = (d.messages || []).length ? d.messages[d.messages.length - 1].id : 0;
  renderChatPanel(jid, d.messages || [], d.handoff);
}

function renderChatPanel(jid, messages, handoff) {
  const panel = $("chatPanel");
  const displayName = (state.chatThreads || []).find((t) => t.whatsappJid === jid)?.phoneDisplay || jid.split("@")[0];
  const thread = (state.chatThreads || []).find((t) => t.whatsappJid === jid);
  const threadName = thread?.name || displayName;
  state.chatMessages = messages;
  pendingQuote = null;
  panel.innerHTML = `
    <div class="chat-head">
      <button class="back-btn" id="chatBackBtn" title="Volver a la lista de chats" aria-label="Volver">←</button>
      <div class="chat-head-id" id="chatProfileBtn" title="Ver la ficha del cliente">
        ${waAvatar(threadName, jid, 40)}
        <div>
          <div class="nm">${esc(threadName)}</div>
          <div class="chat-head-sub">${handoff ? "En línea · 👤 Humano" : "En línea · 🤖 Bot"}</div>
        </div>
      </div>
      <div class="chat-head-actions">
        ${handoff
          ? `<button class="pill" id="resumeBotBtn" title="Devolver el chat al bot">🤖 Reanudar</button>`
          : `<button class="pill ok" id="takeoverBtn" title="Responder tú mismo">🙋 Atender yo</button>`}
        <button class="icon-btn" id="chatInfoBtn" title="Info del chat" aria-label="Info del chat">⋮</button>
      </div>
    </div>
    <div class="chat-msgs" id="chatMsgs">
      ${messages.length ? renderMessages(messages) : `<div class="empty">Sin mensajes todavía.</div>`}
    </div>
    <div class="quote-strip" id="quoteStrip" style="display:none"></div>
    <div class="emoji-panel" id="emojiPanel" style="display:none"></div>
    ${handoff ? "" : `<div class="composer-hint">🙋 Toca <b>Atender yo</b> para escribir como humano — mientras tanto responde el bot.</div>`}
    <div class="chat-input">
      <input type="file" id="imgFile" accept="image/jpeg,image/png,image/webp" style="display:none" />
      <input type="file" id="camFile" accept="image/*" capture="environment" style="display:none" />
      <button class="clip-btn" id="emojiBtn" title="Emojis">😊</button>
      <button class="clip-btn" id="stickerBtn" title="Stickers">🎨</button>
      <div class="field">
        <input type="text" id="replyInput" placeholder="Mensaje" ${handoff ? "" : "disabled title='Toma el control para responder como humano'"} />
        <button class="clip-btn" id="imgBtn" title="Adjuntar una imagen" ${handoff ? "" : "disabled"}>📎</button>
        <button class="clip-btn" id="camBtn" title="Hacer una foto" ${handoff ? "" : "disabled"}>📷</button>
      </div>
      <button class="send-btn" id="replyBtn" title="Enviar" ${handoff ? "" : "disabled"}>➤</button>
    </div>
  `;
  const box = $("chatMsgs");
  box.scrollTop = box.scrollHeight;
  const send = async () => {
    const input = $("replyInput");
    const text = input.value.trim();
    if (!text) return;
    const quote = pendingQuote ? `> ${String(pendingQuote).replace(/\s+/g, " ").slice(0, 120)}\n` : "";
    try {
      await json(`/api/admin/chats/${encodeURIComponent(jid)}/reply`, { method: "POST", body: JSON.stringify({ text: quote + text }) });
      input.value = "";
      pendingQuote = null;
      renderQuoteStrip();
      await openThread(jid);
    } catch (e) { toast(e.message, true); }
  };
  $("replyBtn").addEventListener("click", send);
  $("replyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  // Adjuntar imagen o hacer una foto con la cámara del teléfono
  const sendImageFile = async (input) => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast("Imagen demasiado grande (máx 8MB)", true); input.value = ""; return; }
    const caption = prompt("Texto opcional para la imagen:", "") ?? "";
    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result).split(",")[1];
      try {
        toast("Enviando imagen…");
        await json(`/api/admin/chats/${encodeURIComponent(jid)}/send-image`, { method: "POST", body: JSON.stringify({ data, mimetype: file.type, caption }) });
        toast("Imagen enviada ✅");
        await openThread(jid);
      } catch (e) { toast(e.message, true); }
    };
    reader.readAsDataURL(file);
    input.value = "";
  };
  $("imgBtn").addEventListener("click", () => $("imgFile").click());
  $("imgFile").addEventListener("change", () => sendImageFile($("imgFile")));
  $("camBtn").addEventListener("click", () => $("camFile").click());
  $("camFile").addEventListener("change", () => sendImageFile($("camFile")));
  const takeover = $("takeoverBtn");
  if (takeover) takeover.addEventListener("click", async () => {
    try { await json(`/api/admin/chats/${encodeURIComponent(jid)}/handoff`, { method: "POST" }); toast("Tomaste el control. El bot está en pausa."); await loadChats(); await openThread(jid); }
    catch (e) { toast(e.message, true); }
  });
  const resume = $("resumeBotBtn");
  if (resume) resume.addEventListener("click", async () => {
    try { await json(`/api/admin/chats/${encodeURIComponent(jid)}/resume`, { method: "POST" }); toast("Bot reanudado."); await loadChats(); await openThread(jid); }
    catch (e) { toast(e.message, true); }
  });
  // Ficha del cliente (panel lateral de información, igual que WhatsApp)
  $("chatProfileBtn").addEventListener("click", () => openContactInfo(jid, handoff));
  $("chatInfoBtn").addEventListener("click", () => openContactInfo(jid, handoff));
  $("chatBackBtn").addEventListener("click", () => document.body.classList.remove("chat-open"));
  // Emojis y stickers
  $("emojiBtn").addEventListener("click", () => toggleEmojiPanel(false, jid));
  $("stickerBtn").addEventListener("click", () => toggleEmojiPanel(true, jid));
  // Responder / reenviar (delegación sobre las burbujas)
  $("chatMsgs").addEventListener("click", (e) => {
    const btn = e.target.closest(".msg-act");
    if (!btn) return;
    const m = (state.chatMessages || []).find((x) => String(x.id) === btn.dataset.id);
    if (!m) return;
    if (btn.dataset.act === "reply") setQuote(m);
    if (btn.dataset.act === "forward") openForwardModal(jid, m);
  });
}

function msgBubble(m, tail) {
  if (m.source === "system") return `<div class="bubble system">${esc(m.body)}</div>`;
  const out = m.direction !== "in";
  const cls = m.direction === "in" ? "in" : (m.source === "human" ? "out human" : "out");
  const who = m.direction === "in" ? "" : (m.source === "human" ? "Tú · " : "Bot · ");
  const time = new Date(m.createdAt).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
  const img = m.mediaPath
    ? `<img class="chat-img" src="/api/admin/chats/media/${esc(m.mediaPath)}" alt="adjunto" onclick="document.getElementById('lightboxImg').src=this.src;document.getElementById('lightbox').classList.add('open')" />`
    : "";
  const ticks = out ? tickSvg(m.source === "human") : "";
  const meta = `${who}${time}${ticks}`;
  const body = esc(m.body === "📸 Foto" ? "" : m.body);
  const tailCls = tail ? (out ? " tail-out" : " tail-in") : "";
  return `<div class="msg-row ${out ? "right" : "left"}">
    <div class="bubble ${cls}${tailCls}" data-body="${esc(m.body)}">${img}${body}<span class="b-meta">${meta}</span></div>
    <div class="msg-actions">
      <button class="msg-act" title="Responder" data-act="reply" data-id="${m.id}">↩</button>
      <button class="msg-act" title="Reenviar" data-act="forward" data-id="${m.id}">↪</button>
    </div>
  </div>`;
}

function renderMessages(messages) {
  let out = "";
  let lastDay = "";
  let prev = null;
  for (const m of messages) {
    if (m.source !== "system") {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        out += `<div class="day-sep">${esc(dayLabel(m.createdAt))}</div>`;
        prev = null;
      }
    }
    // Burbujas seguidas del mismo emisor en menos de 90s van pegadas y solo la
    // primera lleva la colita, igual que en WhatsApp.
    const sameGroup = Boolean(prev) && m.source !== "system" && prev.source === m.source
      && prev.direction === m.direction
      && (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 90000;
    out += msgBubble(m, !sameGroup);
    prev = m.source === "system" ? null : m;
  }
  state.lastRenderedDay = lastDay;
  state.lastMsgMeta = prev;
  return out;
}

function setQuote(m) {
  pendingQuote = m.body || "";
  renderQuoteStrip();
  const input = $("replyInput");
  if (input && !input.disabled) input.focus();
}

function renderQuoteStrip() {
  const strip = $("quoteStrip");
  if (!strip) return;
  if (!pendingQuote) { strip.style.display = "none"; strip.innerHTML = ""; return; }
  strip.style.display = "";
  strip.innerHTML = `<div class="q-body">${esc(pendingQuote).slice(0, 160)}</div><button class="q-close" id="quoteClose" title="Quitar">✕</button>`;
  $("quoteClose").addEventListener("click", () => { pendingQuote = null; renderQuoteStrip(); });
}

const WA_EMOJIS = ["😀", "😂", "🙏", "🔥", "💪", "👍", "❤️", "✅", "⚡", "🎉", "🤝", "😎", "🙌", "💎", "👑", "🛒", "💰", "📲", "🏦", "❓"];
const WA_STICKERS = ["🔥", "💎", "✅", "🎉", "🙌", "⚡", "👑", "😄", "👍", "🤝"];
function toggleEmojiPanel(isSticker, jid) {
  const panel = $("emojiPanel");
  if (!panel) return;
  const open = panel.style.display === "none";
  if (!open) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  const items = isSticker ? WA_STICKERS : WA_EMOJIS;
  panel.innerHTML = items.map((e) => `<button class="${isSticker ? "sticker" : ""}" data-e="${e}">${e}</button>`).join("");
  panel.style.display = "";
  panel.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
    const input = $("replyInput");
    if (isSticker) {
      if (!input || input.disabled) { toast("Toma el control para enviar stickers", true); return; }
      try {
        await json(`/api/admin/chats/${encodeURIComponent(jid)}/reply`, { method: "POST", body: JSON.stringify({ text: b.dataset.e }) });
        await openThread(jid);
      } catch (e) { toast(e.message, true); }
    } else if (input) {
      input.value += b.dataset.e;
      input.focus();
    }
  }));
}

function closeWaOverlay(overlay) {
  overlay.remove();
}

/* ---------- Info del chat: pantalla completa (igual que WhatsApp) ---------- */
function closeChatInfo() {
  document.body.classList.remove("info-open");
}

function openContactInfo(jid, handoff) {
  const body = $("chatInfoBody");
  if (!body) return;
  const t = (state.chatThreads || []).find((x) => x.whatsappJid === jid) || {};
  const name = t.name || t.phoneDisplay || jid.split("@")[0];
  const phone = t.phoneDisplay || jid.split("@")[0];
  const media = (state.chatMessages || []).filter((m) => m.mediaPath);
  body.innerHTML = `
    <div class="info-hero">
      ${waAvatar(name, jid, 120)}
      <div class="nm">${esc(name)}</div>
      <div class="ph">${esc(phone)}</div>
      <div class="pill ${handoff ? "warn" : "ok"}" style="margin-top:6px">${handoff ? "👤 En tus manos" : "🤖 Atendiendo el bot"}</div>
    </div>
    ${media.length
      ? `<div class="media-strip">
          <div class="head"><span>Archivos, enlaces y docs.</span><span>${media.length} ›</span></div>
          <div class="media-grid">${media.slice(-8).map((m) => `<img src="/api/admin/chats/media/${esc(m.mediaPath)}" alt="adjunto" onclick="document.getElementById('lightboxImg').src=this.src;document.getElementById('lightbox').classList.add('open')" />`).join("")}</div>
        </div>`
      : ""}
    <div class="rows">
      <div class="row"><span class="ico">✉️</span><span class="rt"><span class="t1">Sin leer</span><span class="t2">${t.unread || 0} mensaje(s)</span></span></div>
      <div class="row"><span class="ico">🕘</span><span class="rt"><span class="t1">Último mensaje</span><span class="t2">${esc(fmtThreadTime(t.lastAt) || "—")}</span></span></div>
      <div class="row"><span class="ico">💬</span><span class="rt"><span class="t1">Mensajes cargados</span><span class="t2">${(state.chatMessages || []).length}</span></span></div>
      <div class="row"><span class="ico">🔗</span><span class="rt"><span class="t1">Identificador</span><span class="t2 mono">${esc(jid)}</span></span></div>
    </div>
    <div class="rows">
      ${handoff
        ? `<button class="row" id="infoResume"><span class="ico">🤖</span><span class="rt"><span class="t1">Reanudar el bot</span><span class="t2">El bot vuelve a responder este chat</span></span></button>`
        : `<button class="row" id="infoTakeover"><span class="ico">🙋</span><span class="rt"><span class="t1">Atender yo este chat</span><span class="t2">Pausa el bot y respondes tú</span></span></button>`}
      <button class="row" id="infoOrders"><span class="ico">🧾</span><span class="rt"><span class="t1">Ver los pedidos del cliente</span><span class="t2">Historial de compras y pagos</span></span><span class="chev">›</span></button>
      <button class="row" id="infoDownload"><span class="ico">⬇</span><span class="rt"><span class="t1">Descargar conversaciones (CSV)</span></span><span class="chev">›</span></button>
      <button class="row" id="infoBlock"><span class="ico">🚫</span><span class="rt"><span class="t1" style="color:var(--bad)">Bloquear a este cliente</span><span class="t2">El bot lo ignorará</span></span></button>
    </div>`;
  document.body.classList.add("info-open");
  $("infoBlock").addEventListener("click", () => { closeChatInfo(); crmBlockCustomer(jid); });
  $("infoDownload").addEventListener("click", () => window.open("/api/admin/export/chats.csv", "_blank"));
  $("infoOrders").addEventListener("click", () => {
    closeChatInfo();
    document.body.classList.remove("chat-open");
    showView("customers");
    const input = $("customerSearch");
    if (input) { input.value = phone; loadCustomers().catch((e) => toast(e.message, true)); }
  });
  const take = $("infoTakeover");
  if (take) take.addEventListener("click", async () => {
    try { await json(`/api/admin/chats/${encodeURIComponent(jid)}/handoff`, { method: "POST" }); toast("Tomaste el control. El bot está en pausa."); await loadChats(); await openThread(jid); }
    catch (e) { toast(e.message, true); }
  });
  const resume = $("infoResume");
  if (resume) resume.addEventListener("click", async () => {
    try { await json(`/api/admin/chats/${encodeURIComponent(jid)}/resume`, { method: "POST" }); toast("Bot reanudado."); await loadChats(); await openThread(jid); }
    catch (e) { toast(e.message, true); }
  });
}

function openForwardModal(fromJid, m) {
  const targets = (state.chatThreads || []).filter((t) => t.whatsappJid !== fromJid);
  const overlay = document.createElement("div");
  overlay.className = "wa-overlay";
  overlay.innerHTML = `<div class="wa-card">
    <h3>↪ Reenviar mensaje</h3>
    <div class="quote-strip" style="border-radius:10px;margin-bottom:10px"><div class="q-body">${esc(m.body || "(imagen)").slice(0, 120)}</div></div>
    ${targets.length
      ? targets.map((t) => {
        const nm = t.name || t.phoneDisplay || t.whatsappJid;
        return `<div class="wa-fwd-item" data-jid="${esc(t.whatsappJid)}">${waAvatar(nm, t.whatsappJid, 38)}<div><div class="n">${esc(nm)}</div><div class="s">${esc(fmtThreadTime(t.lastAt) || "")}</div></div></div>`;
      }).join("")
      : `<div class="empty">No hay otras conversaciones.</div>`}
    <button class="btn ghost" id="waFwdClose" style="margin-top:12px;width:100%">Cancelar</button>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", async (e) => {
    if (e.target === overlay) return closeWaOverlay(overlay);
    const item = e.target.closest(".wa-fwd-item");
    if (!item) return;
    try {
      await json(`/api/admin/chats/${encodeURIComponent(item.dataset.jid)}/reply`, { method: "POST", body: JSON.stringify({ text: m.body || "📎 Foto" }) });
      toast("Mensaje reenviado ✅");
    } catch (err) { toast(err.message, true); }
    closeWaOverlay(overlay);
  });
  $("waFwdClose").addEventListener("click", () => closeWaOverlay(overlay));
}

/* ---------- customers ---------- */
function renderCustomers() {
  $("customersTable").innerHTML = state.customers.length
    ? state.customers.map((c) => {
      const name = c.name || c.phoneDisplay || c.whatsappJid;
      const bits = [`${c.ordersCount} pedido(s)`, fmtMoney(c.revenueBs)];
      if (c.lastOrderAt) bits.push("último " + fmtDate(c.lastOrderAt));
      if (c.suspiciousCount > 0) bits.push(`⚠️ ${c.suspiciousCount} sospecha(s)`);
      if (c.isBlocked) bits.push("🚫 bloqueado");
      return `<div class="row">
        ${waAvatar(name, c.whatsappJid, 42)}
        <span class="rt"><span class="t1">${esc(name)}</span><span class="t2">${esc(bits.join(" · "))}</span></span>
        ${c.isBlocked
          ? `<button class="btn ghost" data-action="unblock" data-jid="${esc(c.whatsappJid)}">Desbloquear</button>`
          : `<button class="btn ghost" data-action="crm-block" data-jid="${esc(c.whatsappJid)}">🚫</button>`}
      </div>`;
    }).join("")
    : `<div class="empty">Aún no hay clientes. Llegarán solos cuando escriban al bot.</div>`;
}
async function crmBlockCustomer(jid) {
  const note = prompt("Motivo del bloqueo (opcional):", "");
  if (note === null) return;
  try { await json("/api/admin/customers/" + encodeURIComponent(jid) + "/block", { method: "POST", body: JSON.stringify({ note }) }); toast("Cliente bloqueado: el bot lo ignorará"); await loadCustomers(); }
  catch (e) { toast(e.message, true); }
}
async function unblockCustomer(jid) {
  try { await json("/api/admin/moderation/" + encodeURIComponent(jid) + "/unblock", { method: "POST" }); toast("Usuario desbloqueado"); await loadCustomers(); }
  catch (e) { toast(e.message, true); }
}

/* ---------- security ---------- */
async function loadSecurity() {
  const results = await Promise.all([
    json("/api/admin/payment-security-events"),
    json("/api/admin/webhook-events"),
    json("/api/admin/moderation/blocked"),
  ]);
  const events = results[0]; const webhooks = results[1]; const blocked = results[2];
  $("secEventsTable").innerHTML = events.length
    ? events.map((e) => `<div class="row">
        <span class="ico">${e.status === "confirmed" ? "✅" : "⚠️"}</span>
        <span class="rt"><span class="t1">${esc(e.reason || "evento")}</span><span class="t2">${esc(e.reference || "sin referencia")}${e.amountBs ? " · " + esc(e.amountBs) + " Bs" : ""} · ${fmtDate(e.createdAt)}</span></span>
        <span class="rv">${esc(e.status)}</span>
      </div>`).join("")
    : `<div class="empty">Sin eventos de seguridad. 🎉</div>`;
  $("webhooksTable").innerHTML = webhooks.length
    ? webhooks.map((w) => `<div class="row">
        <span class="ico">${w.processingStatus === "processed" ? "✅" : w.processingStatus === "failed" ? "❌" : "⏳"}</span>
        <span class="rt"><span class="t1">${esc(w.eventType || "evento")}</span><span class="t2 mono">${esc(w.veniumOrderId || "—")} · ${fmtDate(w.createdAt)}</span></span>
        <span class="rv">${esc(w.processingStatus)}</span>
      </div>`).join("")
    : `<div class="empty">Sin webhooks recibidos.</div>`;
  $("blockedBox").innerHTML = blocked.length
    ? blocked.map((b) => `<div class="alert warning"><div><b>${esc(b.whatsappJid)}</b><br /><span class="muted">${esc(b.blockReason || "sin motivo")} · hasta ${fmtDate(b.blockedUntil)}</span></div><button class="btn ghost" style="margin-left:auto" data-action="unblock" data-jid="${esc(b.whatsappJid)}">Desbloquear</button></div>`).join("")
    : "No hay usuarios bloqueados.";
}

/* ---------- verificador BDV ---------- */
/* Cuando el portal del banco cambia, el sintoma unico es que todas las
   referencias salen como "no encontrado". Aqui se ve SI el espejo se esta
   llenando y, si no, el motivo exacto de la ultima lectura fallida. */
async function loadBdv() {
  let s;
  try {
    s = await json("/api/admin/bdv/status");
  } catch (e) {
    $("bdvState").innerHTML = '<span class="dot"></span><span>No se pudo consultar el estado</span>';
    $("bdvMsg").textContent = e.message || "";
    return;
  }
  const m = s.mirror || {};
  // Verificador apagado (estado normal de la tienda): se dice de entrada, sin
  // tabla ni cron, para que nadie lo lea como "el banco no responde".
  if (s.enabled === false) {
    $("bdvState").className = "pill";
    $("bdvState").innerHTML = '<span class="dot"></span><span>Apagado · la tienda verifica con Pabilo</span>';
    $("bdvBadge").style.display = "none";
    $("bdvMsg").innerHTML = esc(s.note || "El verificador de BDVenlínea está apagado.");
    $("bdvTable").innerHTML = `<div class="empty">No se toca el portal del banco: no hay sesión abierta ni lecturas programadas.</div>`;
    return;
  }
  const ok = m.ok && m.movements > 0;
  $("bdvState").className = "pill " + (ok ? "ok" : "bad");
  $("bdvState").innerHTML = `<span class="dot"></span><span>${ok
    ? `Leyendo bien · ${m.movements} movimientos en el espejo`
    : m.syncedAt ? "El banco no se está leyendo" : "Sin lecturas todavía"}</span>`;
  $("bdvMsg").innerHTML = [
    `Modo: <b>${esc(s.mode)}</b> · diagnóstico: <b>${s.debug ? "activado" : "desactivado"}</b>`,
    `Última lectura: <b>${m.syncedAt ? fmtDate(m.syncedAt) : "nunca"}</b>`,
    m.error ? `<span style="color:#fca5a5">Motivo: ${esc(m.error)}</span>` : "",
  ].filter(Boolean).join("<br />");
  $("bdvBadge").style.display = ok ? "none" : "";
  $("bdvBadge").textContent = "!";
  const rows = s.sample || [];
  $("bdvTable").innerHTML = rows.length
    ? rows.map((r) => `<div class="row">
        <span class="ico">🏦</span>
        <span class="rt"><span class="t1">${r.amount == null ? "—" : esc(String(r.amount)) + " Bs"} <span class="mono muted">${esc(r.reference || "")}</span></span><span class="t2">${esc(r.description || "—")}</span></span>
        <span class="rv">${esc(r.date || "")}</span>
      </div>`).join("")
    : `<div class="empty">El espejo está vacío: ninguna lectura del banco ha funcionado todavía.</div>`;
}

/* ---------- whatsapp ---------- */
async function setPairingMode(mode) {
  try {
    await json("/api/admin/whatsapp/pairing-mode", { method: "POST", body: JSON.stringify({ mode }) });
    toast(mode === "phone" ? "Modo código de 8 dígitos activado. Generando código…" : "Modo QR activado. Generando QR…");
    setTimeout(() => loadDashboard().catch(() => {}), 4000);
  } catch (e) { toast(e.message, true); }
}

async function refreshPairing(kind) {
  try {
    if (kind === "code") {
      await json("/api/admin/whatsapp/refresh-pairing", { method: "POST" });
      toast("Generando código nuevo… aparece en unos segundos.");
    } else {
      // The QR is produced by the browser; a mode toggle to qr forces a fresh one.
      await setPairingMode("qr");
    }
    setTimeout(() => loadDashboard().catch(() => {}), 2500);
  } catch (e) { toast(e.message, true); }
}

async function resetWhatsAppSession() {
  if (!confirm("¿Seguro? Se borra la sesión guardada y tendrás que vincular el dispositivo otra vez (código o QR).")) return;
  try {
    await json("/api/admin/whatsapp/reset-session", { method: "POST" });
    toast("Sesión borrada. Vinculando de cero…");
    setTimeout(() => loadDashboard().catch(() => {}), 5000);
  } catch (e) { toast(e.message, true); }
}

function countdown(iso, seconds) {
  if (!iso) return "";
  const left = Math.max(0, seconds - Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return left > 0 ? `expira en ${left}s` : "expirado";
}

function renderWhatsApp(d) {
  const wa = d.whatsappStatus || {};
  const open = wa.connection === "open";
  const pairing = wa.connection === "pairing";
  const mode = wa.pairingMode === "qr" ? "qr" : "phone";
  $("waState").className = "pill " + (open ? "ok" : "warn");
  $("waState").innerHTML = `<span class="dot"></span><span>${open ? "Conectado" : pairing ? "Esperando vinculación…" : wa.connection === "connecting" ? "Restaurando sesión…" : "Desconectado"}</span>`;

  const codeBox = $("codeBox");
  const qrBox = $("qrBox");

  if (!wa.enabled) {
    codeBox.innerHTML = `<div>WhatsApp está en modo <b>disabled</b>.<br /><span class="muted">Configura WHATSAPP_MODE=live en las variables del servidor.</span></div>`;
    qrBox.innerHTML = `<div>WhatsApp está en modo <b>disabled</b>.<br /><span class="muted">Configura WHATSAPP_MODE=live en las variables del servidor.</span></div>`;
  } else if (open) {
    codeBox.innerHTML = `<div>✅<br /><b>WhatsApp vinculado.</b><br /><span class="muted">El bot está atendiendo mensajes.</span></div>`;
    qrBox.innerHTML = `<div>✅<br /><b>WhatsApp vinculado.</b><br /><span class="muted">No hace falta vincular nada más.</span></div>`;
  } else if (!pairing && wa.connection === "connecting") {
    // A saved session is being restored: no QR/code is expected at all.
    codeBox.innerHTML = `<div>🔄<br /><b>Restaurando la sesión guardada…</b><br /><span class="muted">Si tarda más de 2 minutos, pulsa <b>Reiniciar sesión</b> abajo para vincular de cero.</span></div>`;
    qrBox.innerHTML = `<div>🔄<br /><b>Restaurando la sesión guardada…</b><br /><span class="muted">No hace falta escanear nada: se está reutilizando el vínculo anterior.</span></div>`;
  } else {
    // Method 1: 8-digit code (shown only while actively pairing)
    codeBox.innerHTML = wa.pairingCode
      ? `<div>En tu teléfono: <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b> → <b>Vincular con el número de teléfono en su lugar</b>.<div class="pairing">${esc(wa.pairingCode)}</div><span class="muted">Código para tu número ${esc(wa.pairingPhone)} · ${countdown(wa.pairingCodeUpdatedAt, 60)}<br />¿Expiró o dio error? Pulsa <b>Nuevo código</b> abajo.</span></div>`
      : `<div>Generando código de 8 dígitos…<br /><span class="muted">Aparece aquí en menos de un minuto. También puedes usar el QR de al lado.</span></div>`;

    // Method 2: QR (only a LIVE qr render is shown — never a stale image)
    qrBox.innerHTML = wa.qrDataUrl
      ? `<img src="${wa.qrDataUrl}" alt="QR de WhatsApp" /><span class="muted" style="display:block;margin-top:8px">Válido ${countdown(wa.qrExpiresAt, 60)} · se renueva solo.</span>`
      : `<div>Generando QR…<br /><span class="muted">Si tarda más de un minuto, pulsa <b>Nuevo QR</b> o usa el código de 8 dígitos.</span></div>`;
  }

  const details = Object.assign({}, wa);
  delete details.qrDataUrl;
  $("waDetails").textContent = JSON.stringify(details, null, 2);
}

/* ---------- settings ---------- */
function fillForm(form, data) {
  for (const key of Object.keys(data)) {
    const input = form.querySelector(`[name="${key}"]`);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(data[key]);
    else input.value = data[key] ?? "";
  }
}
async function loadSettings() {
  const s = await json("/api/admin/settings");
  fillForm($("settingsForm"), s);
}
$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.pabiloEnabled = e.target.pabiloEnabled.checked;
  try { await json("/api/admin/settings", { method: "PUT", body: JSON.stringify(data) }); toast("Configuración guardada"); }
  catch (x) { toast(x.message, true); }
});

/* ---------- moderation ---------- */
async function loadModeration() {
  const results = await Promise.all([
    json("/api/admin/moderation/settings"),
    json("/api/admin/moderation/events"),
  ]);
  fillForm($("moderationForm"), results[0]);
  const events = results[1];
  $("modEventsTable").innerHTML = events.length
    ? events.map((ev) => `<div class="row">
        <span class="ico">${ev.action === "unblock" ? "🔓" : ev.action === "block" || ev.action === "blocked" ? "🚫" : "⚠️"}</span>
        <span class="rt"><span class="t1">${esc(ev.whatsappJid)}</span><span class="t2">${esc(ev.reason || "")} · ${fmtDate(ev.createdAt)}</span></span>
        <span class="rv">${esc(ev.action)}</span>
      </div>`).join("")
    : `<div class="empty">Sin eventos de moderación.</div>`;
}
$("moderationForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.enabled = e.target.enabled.checked;
  for (const k of ["windowSeconds", "maxMessages", "repeatedMessageLimit", "warningThreshold", "autoBlockThreshold", "cooldownSeconds", "blockDurationSeconds"]) data[k] = Number(data[k]);
  try { await json("/api/admin/moderation/settings", { method: "PUT", body: JSON.stringify(data) }); toast("Moderación guardada"); }
  catch (x) { toast(x.message, true); }
});

/* ---------- catalog ---------- */
async function loadCatalog() {
  const catalog = await json("/api/admin/catalog");
  $("catalogBox").innerHTML = catalog.length
    ? catalog.map((p) => `<div class="alert info"><div><b>${esc(p.name)}</b> <span class="muted">${esc(p.category)}</span><br />${p.packages.map((pk) => `<span class="pill brand" style="margin:2px 4px 0 0">${esc(pk.name)} · ${fmtMoney(pk.costUsd)}${pk.outOfStock ? " · sin stock" : ""}</span>`).join("")}</div></div>`).join("")
    : `<div class="empty">Catálogo vacío. Pulsa "Sincronizar" para traerlo de Venium.</div>`;
}
async function syncCatalog() {
  try { await json("/api/admin/catalog/sync", { method: "POST" }); toast("Catálogo sincronizado"); await loadCatalog(); }
  catch (x) { toast(x.message, true); }
}
async function loadBanks() {
  $("banksBox").textContent = "Consultando…";
  try { $("banksBox").textContent = JSON.stringify(await json("/api/admin/pabilo/banks"), null, 2); }
  catch (x) { $("banksBox").textContent = "Error: " + x.message; }
}

/* ---------- top actions ---------- */
$("refreshBtn").addEventListener("click", () => refreshAll());
$("exportBtn").addEventListener("click", () => window.open("/api/admin/export/orders.csv", "_blank"));

/* ---------- menú ⋮ y accesos de la pantalla de Ajustes ---------- */
function exportChats() { window.open("/api/admin/export/chats.csv", "_blank"); }
$("menuBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  const menu = $("mainMenu");
  const wasOpen = menu.classList.contains("open");
  closeMenus();
  if (!wasOpen) menu.classList.add("open");
});
// Cualquier opción del menú lo cierra al tocarla.
$("mainMenu").addEventListener("click", () => setTimeout(closeMenus, 0));
// Un toque fuera del menú también lo cierra.
document.addEventListener("click", (event) => { if (!event.target.closest(".menu-wrap")) closeMenus(); });
$("menuExport").addEventListener("click", exportChats);
$("settingsExport").addEventListener("click", exportChats);
$("menuAbout").addEventListener("click", () => toast("Vex CRM · panel del bot de WhatsApp: atender y vender desde el teléfono 📲"));
$("settingsNotif").addEventListener("click", () => setupPush().catch((e) => toast(e.message, true)));
$("settingsInstall").addEventListener("click", () => $("installBtn").click());
$("searchBtn").addEventListener("click", () => { showView("chats"); $("chatSearch").focus(); });
$("infoClose").addEventListener("click", closeChatInfo);

/* ---------- chats: búsqueda, filtros y tema claro/oscuro ---------- */
$("chatSearch").addEventListener("input", (e) => { state.chatQuery = e.target.value; renderThreads(); });
$("chatFilters").addEventListener("click", (e) => {
  const chip = e.target.closest(".pill");
  if (!chip) return;
  document.querySelectorAll("#chatFilters .pill").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  state.chatFilter = chip.dataset.filter;
  renderThreads();
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === "light";
  const icon = $("themeIcon");
  if (icon) icon.textContent = light ? "☀️" : "🌙";
  const label = light ? "Modo claro" : "Modo oscuro";
  const l1 = $("themeLabel");
  if (l1) l1.textContent = label;
  const l2 = $("themeLabel2");
  if (l2) l2.textContent = label;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#f0f2f5" : "#202c33");
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  try { localStorage.setItem("vex-crm-theme", next); } catch {}
}
$("themeBtn").addEventListener("click", toggleTheme);
$("settingsTheme").addEventListener("click", toggleTheme);
applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
$("processPendingBtn").addEventListener("click", () => processPendingVenium());
$("refreshCodeBtn").addEventListener("click", () => refreshPairing("code"));
$("newQrBtn").addEventListener("click", () => refreshPairing("qr"));
$("resetSessionBtn").addEventListener("click", () => resetWhatsAppSession());
$("ordersFilter").addEventListener("input", (e) => { state.filter = e.target.value; renderOrders(); });
$("customerSearchBtn").addEventListener("click", () => loadCustomers().catch((e) => toast(e.message, true)));
$("bdvReloadBtn").addEventListener("click", async () => {
  const btn = $("bdvReloadBtn");
  btn.disabled = true;
  btn.textContent = "Leyendo del banco… (puede tardar hasta 1 minuto)";
  try {
    const r = await json("/api/admin/bdv/movements?days=3");
    const rows = r.movements || [];
    // listMovements devuelve una fila de error en vez de lanzar: asi el motivo
    // real (parser obsoleto, sesion, banco caido) llega hasta aqui.
    const fallo = rows.find((x) => String(x.description || "").startsWith("ERROR:"));
    if (fallo) toast(String(fallo.description).slice(0, 220), true);
    else toast(rows.length ? `${rows.length} movimientos leídos` : "El banco no devolvió movimientos");
  } catch (e) {
    toast(e.message || "No se pudo leer el banco", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Leer movimientos del banco ahora";
    await loadBdv();
  }
});
$("bdvLogoutBtn").addEventListener("click", async () => {
  try {
    const r = await json("/api/admin/bdv/logout", { method: "POST" });
    toast(r.note || (r.ok ? "Sesión cerrada" : "No se pudo cerrar la sesión"));
  } catch (e) {
    toast(e.message || "No se pudo cerrar la sesión", true);
  }
});
$("customerSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") loadCustomers().catch((x) => toast(x.message, true)); });

/* ---------- loaders ---------- */
async function loadDashboard() {
  const d = await json("/api/admin/dashboard");
  state.dashboard = d;
  renderDashboard(d);
  renderWhatsApp(d);
}
async function loadOrders() {
  state.orders = await json("/api/admin/orders");
  renderOrders();
  await loadPendingVenium();
}
// Live polling of the open thread so the inbox feels real-time. Se anexan solo
// los mensajes nuevos (no se re-renderiza el chat completo) para no borrar lo
// que estés escribiendo; las burbujas se agrupan con la anterior.
setInterval(async () => {
  if (!activeJid || document.hidden) return;
  try {
    const d = await json("/api/admin/chats/" + encodeURIComponent(activeJid) + "/messages?after=" + lastMsgId);
    const fresh = d.messages || [];
    if (!fresh.length) return;
    lastMsgId = fresh[fresh.length - 1].id;
    const box = $("chatMsgs");
    if (!box) return;
    if (box.querySelector(".empty")) box.innerHTML = "";
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 180;
    let html = "";
    let prev = state.lastMsgMeta || null;
    for (const m of fresh) {
      if (m.source !== "system") {
        const day = new Date(m.createdAt).toDateString();
        if (day !== state.lastRenderedDay) {
          html += `<div class="day-sep">${esc(dayLabel(m.createdAt))}</div>`;
          state.lastRenderedDay = day;
          prev = null;
        }
      }
      const sameGroup = Boolean(prev) && m.source !== "system" && prev.source === m.source
        && prev.direction === m.direction
        && (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 90000;
      html += msgBubble(m, !sameGroup);
      prev = m.source === "system" ? null : m;
    }
    state.lastMsgMeta = prev;
    box.insertAdjacentHTML("beforeend", html);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  } catch {}
}, 4000);
async function loadCustomers() {
  const q = $("customerSearch").value.trim();
  state.customers = await json("/api/admin/customers" + (q ? "?search=" + encodeURIComponent(q) : ""));
  renderCustomers();
}
async function loadHealth() {
  const s = await json("/api/admin/status");
  const p = s.providers || {};
  $("healthRows").innerHTML = [
    ["Venium", providerPill(p.venium)], ["Pabilo", providerPill(p.pabilo)],
    ["Gemini", providerPill(p.gemini)], ["WhatsApp", whatsappProviderCell(p.whatsapp)],
    ["BDV (banco)", providerPill(p.bdv)],
    ["Base URL Pabilo", esc((s.pabilo && s.pabilo.baseUrl) || "—")],
    ["User Bank ID", s.pabilo && s.pabilo.userBankIdConfigured ? '<span class="pill ok">configurado</span>' : '<span class="pill bad">sin configurar</span>'],
  ].map((row) => `<div class="row"><span class="rt"><span class="t1">${row[0]}</span></span><span class="rv">${row[1]}</span></div>`).join("");
}

let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  $("refreshBtn").innerHTML = "Actualizando…";
  const jobs = [loadDashboard, loadOrders, loadChats, loadCustomers, loadSettings, loadModeration, loadCatalog, loadSecurity, loadHealth, loadBdv];
  const results = await Promise.allSettled(jobs.map((job) => job()));
  const failed = results.find((r) => r.status === "rejected");
  if (failed) toast(failed.reason && failed.reason.message ? failed.reason.message : "Error cargando datos", true);
  refreshing = false;
  $("refreshBtn").textContent = "↻ Actualizar";
}

refreshAll();
setInterval(() => {
  loadDashboard().catch(() => {});
  loadChats().catch(() => {});
}, 5000);

/* ---------- Pantalla inicial: la lista de chats (como WhatsApp) ----------
 * El CRM abre en la lista de conversaciones, no dentro de un chat: el dueño
 * elige a quién responder. Un #hash guardado (p. ej. #orders) manda. */
(function activateInitialView() {
  const requested = (location.hash || "").replace(/^#/, "").trim();
  const known = requested && document.querySelector(`[data-view="${requested}"]`);
  showView(known ? requested : "chats");
})();

/* ================= REALTIME (SSE) + NOTIFICATIONS + PWA ================= */

const LIVE_META = {
  message_in: ["💬", "Cliente escribió", "warn"],
  message_out: ["🤖", "Bot respondió", ""],
  order_created: ["🧾", "Nuevo pedido", "brand"],
  payment_verified: ["✅", "Pago verificado", "ok"],
  order_completed: ["🎉", "Recarga completada", "ok"],
  survey_response: ["📊", "Encuesta de satisfacción", "ok"],
  payment_review: ["⚠️", "Pago en revisión", "bad"],
  handoff_on: ["🙋", "Pidió soporte humano", "warn"],
  handoff_off: ["🤖", "Bot retomó el chat", ""],
  user_blocked: ["🚫", "Usuario bloqueado", "bad"],
  user_unblocked: ["🔓", "Usuario desbloqueado", "ok"],
  order_stuck: ["⏰", "Pedido pendiente", "bad"],
  provider_alert: ["🏦", "Verificación de pagos caída", "bad"],
  multi_number: ["📱", "Mismo cliente, dos números", "warn"],
  bot_error: ["🔥", "Error del bot", "bad"],
};

function liveItemHtml(ev, isNew) {
  const meta = LIVE_META[ev.type] || ["⚡", ev.type, ""];
  const time = new Date(ev.at).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `<div class="live-item${isNew ? " new" : ""}" ${ev.jid && ev.jid.includes("@") ? `data-action="live-open" data-jid="${esc(ev.jid)}"` : ""}>
    <span class="l-ico">${meta[0]}</span>
    <div class="l-body">
      <div class="l-title">${esc(meta[1])} · <span class="mono">${esc(ev.phone)}</span></div>
      <div class="l-text">${esc(ev.preview || "")}</div>
    </div>
    <span class="l-time">${time}</span>
  </div>`;
}

function renderLiveFeed() {
  const box = $("liveFeed");
  if (!box) return;
  box.innerHTML = state.liveEvents.length
    ? state.liveEvents.map((ev) => liveItemHtml(ev, false)).join("")
    : `<div class="empty">Sin actividad todavía. Cuando alguien escriba al bot aparecerá aquí al instante ⚡</div>`;
}

function pushLiveEvent(ev) {
  state.liveEvents.unshift(ev);
  if (state.liveEvents.length > 80) state.liveEvents.pop();
  const box = $("liveFeed");
  if (box && document.querySelector("#view-live")) {
    const empty = box.querySelector(".empty");
    if (empty) empty.remove();
    box.insertAdjacentHTML("afterbegin", liveItemHtml(ev, true));
    while (box.children.length > 80) box.lastChild.remove();
  }
  const badge = $("liveBadge");
  if (ev.type !== "message_out") {
    badge.style.display = "";
    badge.textContent = Math.min(99, (Number(badge.textContent) || 0) + 1);
  }
  // Reset badge when the live view is visible.
  if (document.querySelector("#view-live.active")) badge.style.display = "none";
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  if (t.dataset.view === "live") $("liveBadge").style.display = "none";
}));

// ---- Sonido: tono suave cuando hay actividad del cliente ----
// Se sintetiza con WebAudio en vez de un <audio> con data URI: así funciona
// incluso con la política de contenido del panel (que bloquea medios en línea).
let audioCtx = null;
function audioContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { audioCtx = new Ctx(); } catch { audioCtx = null; }
  return audioCtx;
}
function playDing() {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    // Dos notas cortas, como el tono de WhatsApp.
    [[880, 0], [1174.7, 0.13]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.4);
    });
  } catch {}
}

// El navegador solo deja sonar audio después del primer toque: aquí se crea y
// se reanuda el contexto en el primer gesto del dueño.
window.addEventListener("pointerdown", () => {
  try { const ctx = audioContext(); if (ctx && ctx.state === "suspended") void ctx.resume(); } catch {}
}, { once: true });

// ---- Notifications button: permission + push subscription ----
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function setupPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("Tu navegador no soporta notificaciones push", true);
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const cfg = await json("/api/admin/push/key").catch(() => null);
  if (!cfg || !cfg.configured) {
    toast("El servidor aún no tiene claves VAPID configuradas", true);
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Permiso de notificaciones denegado", true);
    return;
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) });
  }
  await json("/api/admin/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  toast("🔔 Listo: tu teléfono sonará con cada cliente ⚡");
  const test = await json("/api/admin/push/test", { method: "POST" }).catch(() => null);
  if (test && test.delivered > 0) toast("Notificación de prueba enviada 📲");
}

$("notifBtn").addEventListener("click", () => setupPush().catch((e) => toast(e.message, true)));

// ---- PWA install button ----
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("installBtn").style.display = "";
  $("settingsInstall").style.display = "";
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  $("installBtn").style.display = "none";
});
window.addEventListener("appinstalled", () => { $("installBtn").style.display = "none"; $("settingsInstall").style.display = "none"; toast("📲 App instalada: búscala en tu teléfono como 'Vex CRM'"); });

// ---- PWA: registrar el service worker (notificaciones push + instalable) ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// SW sound relay (push arrives while app is open).
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data && event.data.type === "play-ring") playDing();
});

// ---- SSE: connect the realtime channel ----
function connectLive() {
  const es = new EventSource("/api/admin/stream");
  es.onopen = () => { liveConnected = true; };
  es.onerror = () => {
    liveConnected = false;
    es.close();
    setTimeout(connectLive, 5000); // auto-reconnect
  };
  es.onmessage = (event) => {
    try {
      const ev = JSON.parse(event.data);
      if (!ev || !ev.type) return;
      pushLiveEvent(ev);
      // In-app sound for customer events while the panel is open.
      if (["message_in", "order_created", "payment_verified", "order_completed", "handoff_on", "order_stuck", "provider_alert", "multi_number", "bot_error"].includes(ev.type)) playDing();
      // Refresh chats when there is new customer activity so the inbox badge stays true.
      if (ev.type === "message_in" || ev.type === "handoff_on") loadChats().catch(() => {});
    } catch {}
  };
}
connectLive();

// Seed the live feed with recent events once connected.
json("/api/admin/events").then((d) => {
  state.liveEvents = (d.events || []).slice(0, 40);
  renderLiveFeed();
}).catch(() => {});
