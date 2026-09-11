const $ = (id) => document.getElementById(id);
const state = { dashboard: null, orders: [], customers: [], filter: "" };

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
  approved_for_venium: ["aprobado", "brand"], venium_processing: ["procesando Venium", "brand"],
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

/* ---------- tabs (delegated, works even if other code fails) ---------- */
const titles = {
  dashboard: ["Dashboard", "Resumen general de tu negocio en tiempo real"],
  orders: ["Pedidos", "Todas las cotizaciones y ventas con su historial de pago"],
  chats: ["Chats", "Conversaciones en vivo de WhatsApp: responde tú cuando el bot necesite ayuda humana"],
  customers: ["Clientes", "Base de clientes construida desde las conversaciones de WhatsApp"],
  security: ["Seguridad", "Eventos antifraude, webhooks de Venium y usuarios bloqueados"],
  whatsapp: ["WhatsApp", "Vincula el dispositivo y vigila la conexión del bot"],
  settings: ["Precios y Pabilo", "Tasa, margen, redondeo y configuración de Pabilo"],
  moderation: ["Moderación", "Reglas anti-spam y usuarios bloqueados"],
  catalog: ["Catálogo", "Sincroniza paquetes desde Venium y verifica bancos de Pabilo"],
};
document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab && tab.dataset.view) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const view = $("view-" + tab.dataset.view);
    if (view) view.classList.add("active");
    const pair = titles[tab.dataset.view] || [tab.dataset.view, ""];
    $("viewTitle").textContent = pair[0];
    $("viewSub").textContent = pair[1];
    window.scrollTo({ top: 0 });
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "order") openOrder(action.dataset.id);
  if (action.dataset.action === "unblock") unblockCustomer(action.dataset.jid);
  if (action.dataset.action === "sync-catalog") syncCatalog();
  if (action.dataset.action === "load-banks") loadBanks();
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
  $("kpiCards").innerHTML = cards.map((c) => `<div class="card"><div class="kpi-label">${esc(c[0])}</div><div class="kpi">${esc(c[1])}</div><div><small class="muted">${esc(c[2])}</small></div></div>`).join("");

  const max = Math.max(1, ...d.sales7d.map((s) => Number(s.revenueBs)));
  $("salesChart").innerHTML = d.sales7d.map((s) => {
    const h = Math.max(3, Math.round((Number(s.revenueBs) / max) * 100));
    return `<div class="bar-wrap" title="${esc(s.day)}: ${esc(s.revenueBs)} Bs · ${s.orders} pedidos"><span class="bar-value">${s.orders || ""}</span><div class="bar" style="height:${h}%"></div><span class="bar-label">${s.day.slice(5)}</span></div>`;
  }).join("");

  $("topPackages").innerHTML = d.topPackages.length
    ? d.topPackages.map((p, i) => `<tr><td><b>#${i + 1}</b> ${esc(p.name)}</td><td>${p.orders} pedidos</td><td><b>${fmtMoney(p.revenueBs)}</b></td></tr>`).join("")
    : `<tr><td class="empty">Aún no hay ventas registradas.</td></tr>`;

  $("recentOrders").innerHTML = d.recentOrders.length
    ? d.recentOrders.map((o) => `<tr><td class="mono">${shortId(o.id)}</td><td>${esc(o.whatsappJid || "—")}</td><td>${esc(o.productName)} · ${esc(o.packageName)}</td><td><b>${fmtMoney(o.salePriceBsTotal)}</b></td><td>${pillStatus(o.status)}</td></tr>`).join("")
    : `<tr><td class="empty">Sin pedidos todavía. Escribe CATÁLOGO al bot para probar.</td></tr>`;

  const prov = d.providers || {};
  $("providerRows").innerHTML = [
    ["Venium", prov.venium], ["Pabilo", prov.pabilo], ["Gemini", prov.gemini], ["WhatsApp", prov.whatsapp],
  ].map((row) => `<tr><td><b>${row[0]}</b></td><td>${providerPill(row[1])}</td></tr>`).join("")
  + `<tr><td><b>Creación live de órdenes</b></td><td>${d.safety && d.safety.liveVeniumOrderCreation ? '<span class="pill ok">permitida</span>' : '<span class="pill warn">bloqueada</span>'}</td></tr>`;

  const wa = d.whatsappStatus || {};
  $("connLabel").textContent = wa.connection === "open" ? "WhatsApp conectado" : `WhatsApp ${wa.connection || "desconectado"}`;
  $("connLabel").style.color = wa.connection === "open" ? "var(--ok)" : "var(--warn)";
  $("genLabel").textContent = "Actualizado " + fmtDate(d.generatedAt);

  $("ordersBadge").style.display = k.ordersPendingPayment > 0 ? "" : "none";
  $("ordersBadge").textContent = k.ordersPendingPayment;
  $("secBadge").style.display = k.ordersSuspicious + k.failedWebhooks > 0 ? "" : "none";
  $("secBadge").textContent = k.ordersSuspicious + k.failedWebhooks;
}

/* ---------- orders ---------- */
function renderOrders() {
  const f = state.filter.toLowerCase();
  const rows = state.orders.filter((o) => !f || JSON.stringify(o).toLowerCase().includes(f));
  $("ordersTable").innerHTML = rows.length
    ? rows.map((o) => `<tr>
        <td class="mono">${shortId(o.id)}</td>
        <td>${esc(o.whatsappJid || "—")}</td>
        <td>${esc(o.productName)} · ${esc(o.packageName)}</td>
        <td><b>${fmtMoney(o.salePriceBsTotal)}</b></td>
        <td>${pillPayment(o.paymentStatus)}</td>
        <td>${pillStatus(o.status)}</td>
        <td class="mono">${esc(o.veniumOrderId || "—")}</td>
        <td class="muted">${fmtDate(o.createdAt)}</td>
        <td><button class="btn ghost" data-action="order" data-id="${esc(o.id)}">Ver</button></td>
      </tr>`).join("")
    : `<tr><td colspan="9" class="empty">Sin pedidos que coincidan.</td></tr>`;
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

async function loadChats() {
  const d = await json("/api/admin/chats");
  const threads = d.threads || [];
  state.chatThreads = threads;
  const badge = $("chatsBadge");
  badge.style.display = d.unread + d.handoff > 0 ? "" : "none";
  badge.textContent = d.unread + d.handoff;
  renderThreads(threads);
}

function renderThreads(threads) {
  $("chatThreads").innerHTML = threads.length
    ? threads.map((t) => {
      const active = t.whatsappJid === activeJid ? " active" : "";
      return `<div class="thread-item${active}" data-jid="${esc(t.whatsappJid)}">
        <div class="t-name"><span>${esc(t.phoneDisplay || t.whatsappJid)}</span>${t.unread > 0 ? `<span class="t-unread">${t.unread}</span>` : ""}</div>
        <div class="t-last">${t.handoff ? '<span class="t-hand">🙋 humano</span> · ' : ""}${esc(t.lastMessage.slice(0, 60))}</div>
      </div>`;
    }).join("")
    : `<div class="empty">Aún no hay conversaciones. Llegarán cuando escriban al bot.</div>`;
  document.querySelectorAll(".thread-item").forEach((el) => {
    el.addEventListener("click", () => openThread(el.dataset.jid));
  });
}

async function openThread(jid) {
  activeJid = jid;
  lastMsgId = 0;
  renderThreads(state.chatThreads || []);
  const d = await json("/api/admin/chats/" + encodeURIComponent(jid) + "/messages");
  lastMsgId = (d.messages || []).length ? d.messages[d.messages.length - 1].id : 0;
  renderChatPanel(jid, d.messages || [], d.handoff);
}

function renderChatPanel(jid, messages, handoff) {
  const panel = $("chatPanel");
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><b>${esc(jid.split("@")[0])}</b> <span class="muted" style="font-size:12px">WhatsApp</span></div>
      <div style="display:flex;gap:6px">
        ${handoff
          ? `<button class="btn ghost" id="resumeBotBtn">🤖 Reanudar bot</button>`
          : `<button class="btn ghost" id="takeoverBtn">🙋 Atender yo</button>`}
      </div>
    </div>
    <div class="chat-msgs" id="chatMsgs">
      ${messages.length ? messages.map(msgBubble).join("") : `<div class="empty">Sin mensajes todavía.</div>`}
    </div>
    <div class="chat-input">
      <input id="replyInput" placeholder="Escribe tu respuesta como soporte humano…" ${handoff ? "" : "disabled title='Toma el control para responder como humano'"} />
      <button class="btn" id="replyBtn" ${handoff ? "" : "disabled"}>Enviar</button>
    </div>
    <div class="muted" style="font-size:11.5px;margin-top:6px">${handoff
      ? "Tienes el control: el bot está en pausa para este chat."
      : "El bot está atendiendo. Toma el control para responder tú."}</div>
  `;
  const box = $("chatMsgs");
  box.scrollTop = box.scrollHeight;
  const send = async () => {
    const input = $("replyInput");
    const text = input.value.trim();
    if (!text) return;
    try {
      await json(`/api/admin/chats/${encodeURIComponent(jid)}/reply`, { method: "POST", body: JSON.stringify({ text }) });
      input.value = "";
      await openThread(jid);
    } catch (e) { toast(e.message, true); }
  };
  $("replyBtn").addEventListener("click", send);
  $("replyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
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
}

function msgBubble(m) {
  if (m.source === "system") return `<div class="bubble system">${esc(m.body)}</div>`;
  const cls = m.direction === "in" ? "in" : (m.source === "human" ? "out human" : "out");
  const who = m.direction === "in" ? "Cliente" : (m.source === "human" ? "Tú (humano)" : "Bot");
  return `<div class="bubble ${cls}">${esc(m.body)}<div class="b-meta">${who} · ${fmtDate(m.createdAt)}</div></div>`;
}

/* ---------- customers ---------- */
function renderCustomers() {
  $("customersTable").innerHTML = state.customers.length
    ? state.customers.map((c) => `<tr>
        <td>${esc(c.phoneDisplay || c.whatsappJid)}</td>
        <td>${esc(c.name || "—")}</td>
        <td>${c.ordersCount}</td>
        <td><b>${fmtMoney(c.revenueBs)}</b></td>
        <td class="muted">${fmtDate(c.lastOrderAt)}</td>
        <td>${c.suspiciousCount > 0 ? `<span class="pill bad">${c.suspiciousCount}</span>` : "—"}</td>
        <td>${c.isBlocked ? `<span class="pill bad">bloqueado</span> <button class="btn ghost" data-action="unblock" data-jid="${esc(c.whatsappJid)}">Desbloquear</button>` : '<span class="pill ok">activo</span>'}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">Aún no hay clientes. Llegarán solos cuando escriban al bot.</td></tr>`;
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
    ? events.map((e) => `<tr><td class="muted">${fmtDate(e.createdAt)}</td><td class="mono">${esc(e.reference || "—")}</td><td>${e.amountBs ? esc(e.amountBs) + " Bs" : "—"}</td><td class="mono">${esc(e.reason || "")}</td><td><span class="pill warn">${esc(e.status)}</span></td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">Sin eventos de seguridad. 🎉</td></tr>`;
  $("webhooksTable").innerHTML = webhooks.length
    ? webhooks.map((w) => `<tr><td class="muted">${fmtDate(w.createdAt)}</td><td>${esc(w.eventType || "—")}</td><td class="mono">${esc(w.veniumOrderId || "—")}</td><td><span class="pill ${w.processingStatus === "processed" ? "ok" : w.processingStatus === "failed" ? "bad" : "warn"}">${esc(w.processingStatus)}</span></td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">Sin webhooks recibidos.</td></tr>`;
  $("blockedBox").innerHTML = blocked.length
    ? blocked.map((b) => `<div class="alert warning"><div><b>${esc(b.whatsappJid)}</b><br /><span class="muted">${esc(b.blockReason || "sin motivo")} · hasta ${fmtDate(b.blockedUntil)}</span></div><button class="btn ghost" style="margin-left:auto" data-action="unblock" data-jid="${esc(b.whatsappJid)}">Desbloquear</button></div>`).join("")
    : "No hay usuarios bloqueados.";
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
  const mode = wa.pairingMode === "qr" ? "qr" : "phone";
  $("waState").className = "pill " + (open ? "ok" : "warn");
  $("waState").innerHTML = `<span class="dot"></span><span>${open ? "Conectado" : wa.connection === "connecting" ? "Conectando…" : "Desconectado"}</span>`;

  const codeBox = $("codeBox");
  const qrBox = $("qrBox");

  if (!wa.enabled) {
    codeBox.innerHTML = `<div>WhatsApp está en modo <b>disabled</b>.<br /><span class="muted">Configura WHATSAPP_MODE=live en las variables del servidor.</span></div>`;
    qrBox.innerHTML = `<div>WhatsApp está en modo <b>disabled</b>.<br /><span class="muted">Configura WHATSAPP_MODE=live en las variables del servidor.</span></div>`;
  } else if (open) {
    codeBox.innerHTML = `<div>✅<br /><b>WhatsApp vinculado.</b><br /><span class="muted">El bot está atendiendo mensajes.</span></div>`;
    qrBox.innerHTML = `<div>✅<br /><b>WhatsApp vinculado.</b><br /><span class="muted">No hace falta vincular nada más.</span></div>`;
  } else {
    // Method 1: 8-digit code
    codeBox.innerHTML = wa.pairingCode
      ? `<div>En tu teléfono: <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b> → <b>Vincular con el número de teléfono en su lugar</b>.<div class="pairing">${esc(wa.pairingCode)}</div><span class="muted">Código para tu número ${esc(wa.pairingPhone)} · ${countdown(wa.pairingCodeUpdatedAt, 60)}<br />¿Expiró o dio error? Pulsa <b>Nuevo código</b> abajo.</span></div>`
      : `<div>Generando código de 8 dígitos…<br /><span class="muted">Aparece aquí en menos de un minuto. También puedes usar el QR de al lado.</span></div>`;

    // Method 2: QR (always generated by the browser while unpaired)
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
    ? events.map((ev) => `<tr><td class="muted">${fmtDate(ev.createdAt)}</td><td>${esc(ev.whatsappJid)}</td><td class="mono">${esc(ev.reason || "")}</td><td><span class="pill ${ev.action === "unblock" ? "ok" : ev.action === "block" || ev.action === "blocked" ? "bad" : "warn"}">${esc(ev.action)}</span></td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">Sin eventos de moderación.</td></tr>`;
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
$("refreshCodeBtn").addEventListener("click", () => refreshPairing("code"));
$("newQrBtn").addEventListener("click", () => refreshPairing("qr"));
$("resetSessionBtn").addEventListener("click", () => resetWhatsAppSession());
$("ordersFilter").addEventListener("input", (e) => { state.filter = e.target.value; renderOrders(); });
$("customerSearchBtn").addEventListener("click", () => loadCustomers().catch((e) => toast(e.message, true)));
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
}
// Live polling of the open thread so the inbox feels real-time.
setInterval(async () => {
  if (!activeJid || document.hidden) return;
  try {
    const d = await json("/api/admin/chats/" + encodeURIComponent(activeJid) + "/messages?after=" + lastMsgId);
    if (d.messages && d.messages.length) {
      lastMsgId = d.messages[d.messages.length - 1].id;
      const box = $("chatMsgs");
      if (box) {
        if (box.querySelector(".empty")) box.innerHTML = "";
        box.insertAdjacentHTML("beforeend", d.messages.map(msgBubble).join(""));
        box.scrollTop = box.scrollHeight;
      }
    }
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
    ["Gemini", providerPill(p.gemini)], ["WhatsApp", providerPill(p.whatsapp)],
    ["Base URL Pabilo", esc((s.pabilo && s.pabilo.baseUrl) || "—")],
    ["User Bank ID", s.pabilo && s.pabilo.userBankIdConfigured ? '<span class="pill ok">configurado</span>' : '<span class="pill bad">sin configurar</span>'],
  ].map((row) => `<tr><td><b>${row[0]}</b></td><td>${row[1]}</td></tr>`).join("");
}

let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  $("refreshBtn").innerHTML = "Actualizando…";
  const jobs = [loadDashboard, loadOrders, loadChats, loadCustomers, loadSettings, loadModeration, loadCatalog, loadSecurity, loadHealth];
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
