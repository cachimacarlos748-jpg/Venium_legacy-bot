import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowRight, ShieldCheck, Zap, BadgeCheck, Loader2,
  User, AlertCircle, Lock, Check, Clock, Wallet, ShoppingCart, ChevronDown, X,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import DenominationPicker from "@/components/purchase/DenominationPicker";
import ProductImage from "@/components/ProductImage";
import PaymentPicker from "@/components/purchase/PaymentPicker";
import PaymentDetails from "@/components/purchase/PaymentDetails";
import PaymentForm from "@/components/purchase/PaymentForm";
import VerifyModal from "@/components/purchase/VerifyModal";
import SummaryCard from "@/components/purchase/SummaryCard";
import { useReceiptUpload } from "@/components/purchase/ReceiptStep";
import { useAuth } from "@/lib/AuthContext";
import { getPurchaseConfig, resolveConfig, getCurrencyLabel } from "@/data/purchaseConfig";
import { getTasa } from "@/lib/tasaClient";
import { verificarId, verifyCfgForSlug } from "@/lib/mobentasClient";
import { Venium, getVeniumConfig } from "@/lib/veniumClient";
import { getPaymentMethods } from "@/lib/paymentMethods";
import { verifyPayment, friendlyPabiloError } from "@/lib/pabiloClient";
import { sendWhatsAppMessage, paymentVerifiedMessage, completionMessage, notifyWhatsAppOrder } from "@/lib/whatsappClient";

import { computeDiscount } from "@/lib/discountClient";
import { isEmailDelivery } from "@/lib/redemptionGuide";
import EmailDeliveryStep from "@/components/purchase/EmailDeliveryStep";
import { loadBlocklist, isBlocked } from "@/lib/blocklistClient";
import BlockScreen from "@/components/purchase/BlockScreen";
import { detectUserIp } from "@/lib/ipDetect";
import { callGemini } from "@/lib/geminiClient";
import { reportFraudToAdmin } from "@/lib/errorReportClient";
import { sendOrderEmail, paymentVerifiedEmail, completionEmail } from "@/lib/emailClient";
import { creditCommission, logCodeUsage } from "@/lib/creatorCommission";
import { addPendingOrder } from "@/lib/pendingPayments";
import { getActiveEventsForSlug, consumeEventStock } from "@/lib/nightEventClient";
import { formatPrice } from "@/lib/priceFormat";
import DiscountCode from "@/components/purchase/DiscountCode";

const fadeIn = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

// Fila del resumen plegable de la pantalla de pago.
function SummaryRow({ k, v }) {
  if (!v) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className="font-bold text-foreground text-right break-words">{v}</span>
    </div>
  );
}

// La compra son tres pantallas (paquetes → método → datos del pago). La última
// vive en su propia ruta, así que la selección se guarda en la sesión: si se
// pierde, el cliente vuelve al inicio en vez de ver una pantalla vacía.
const CHECKOUT_KEY = "vex_checkout_state";
function saveCheckout(data) { try { sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(data)); } catch {} }
function readCheckout() { try { return JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || "null"); } catch { return null; } }
function clearCheckout() { try { sessionStorage.removeItem(CHECKOUT_KEY); } catch {} }

// Revisión IA de la captura subida. Usa la API de Gemini del admin (no
// consume créditos de Base44). Si la IA confirma que NO es un comprobante de
// pago válido (subió meme / foto de otro tema), disparamos la advertencia con
// la IP+ubicación. Errores honestos (tipeo, banco caído) NO la disparan.
async function visionCheckReceipt(receiptUrl, receiptB64) {
  if (!receiptUrl && !receiptB64) return { done: false, skipped: true };
  const today = new Date().toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const prompt = `Analiza la imagen adjunta. IMPORTANTE: Hoy es ${today}. ¿Es un comprobante o captura válida de un PAGO BANCARIO o TRANSFERENCIA (Pago Móvil venezolano, transferencia bancaria, Zinli, Binance, etc.) que muestra claramente una referencia de operación, un monto y datos bancarios visibles? Un comprobante con fecha de HOY o de días anteriores es PERFECTAMENTE VÁLIDO. NO lo rechaces por tener una fecha del año 2026 o cercana a hoy. Solo marca is_payment=false si la imagen claramente NO es un comprobante de pago (es un meme, foto irrelevante, captura de otro tema). Responde en JSON: { is_payment: boolean, confidence: 0-100, reason: string }.`;
  const schema = {
    type: "object",
    properties: {
      is_payment: { type: "boolean" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["is_payment", "confidence", "reason"],
  };
  // 1) Intenta con la API de Gemini externa del admin (no consume créditos Base44).
  try {
    // Si tenemos el base64 (del paso de compresión al subir), lo pasamos directo
    // a Gemini — evita re-descargar la URL de tmpfiles.org (CORS bloqueado).
    const imageInput = receiptB64 ? { b64: receiptB64, mimeType: "image/jpeg" } : receiptUrl;
    console.log("[vision] intentando Gemini externo:", receiptB64 ? "base64 directo" : "URL");
    const res = await callGemini({ prompt, images: [imageInput], responseJsonSchema: schema });
    console.log("[vision] Gemini externo OK:", res);
    return { done: true, is_payment: res.is_payment === true, confidence: Number(res.confidence) || 0, reason: res.reason || "" };
  } catch (e) {
    console.warn("[vision] Gemini externo falló:", e?.message || e);
    // 2) Respaldo: InvokeLLM de Base44 (consume créditos pero garantiza la
    //    revisión anti-fraude cuando la API externa no responde).
    try {
      console.log("[vision] intentando respaldo InvokeLLM...");
      const res = await base44.integrations.Core.InvokeLLM({
        prompt, file_urls: [receiptUrl], model: "gemini_3_flash",
        response_json_schema: schema,
      });
      console.log("[vision] InvokeLLM OK:", res);
      return { done: true, is_payment: res.is_payment === true, confidence: Number(res.confidence) || 0, reason: res.reason || "", fallback: true };
    } catch (e2) {
      console.error("[vision] InvokeLLM también falló:", e2?.message || e2);
      // 3) Si ambos fallan, no podemos castigar al cliente legítimo.
      return { done: false, error: e2?.message || e?.message || "vision LLM error" };
    }
  }
}

function StepBadge({ n, done }) {
  return (
    <span className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${done ? "bg-primary text-primary-foreground" : "bg-primary/40 text-foreground"}`}>
      {done ? <Check className="w-4 h-4" strokeWidth={3} /> : n}
    </span>
  );
}

export default function Comprar() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // La pantalla de datos del pago tiene su propia ruta (/pagar/:slug), como en
  // el checkout del proveedor: el cliente no desliza para llegar al pago.
  const isPayScreen = location.pathname.startsWith("/pagar/");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [product, setProduct] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const [playerId, setPlayerId] = useState(() => {
    try { return localStorage.getItem("legacy_last_player_id") || ""; } catch { return ""; }
  });
  const [discount, setDiscount] = useState(null);
  const [playerIdVerified, setPlayerIdVerified] = useState(false);
  const [server, setServer] = useState("");
  const [denomIndex, setDenomIndex] = useState(null);
  const [payment, setPayment] = useState(null);
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [bankRef, setBankRef] = useState("");
  // Pantalla activa dentro de la ruta del producto: "packages" | "metodo".
  const [stage, setStage] = useState("packages");
  // Ventana superpuesta "Ya pagué": solo referencia y teléfono.
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [pagoMovilFallback, setPagoMovilFallback] = useState(null);
  const [payMethods, setPayMethods] = useState([]);

  // Producto en vivo desde Venium (para stock en tiempo real)
  const [veniumProduct, setVeniumProduct] = useState(null);
  const [veniumBalance, setVeniumBalance] = useState(null); // saldo USD de la wallet
  const [denomsLoading, setDenomsLoading] = useState(false);
  const [tasa, setTasa] = useState(0);
  const [topSeller, setTopSeller] = useState("");
  const [verifyingId, setVerifyingId] = useState(false);
  const [nick, setNick] = useState("");
  const [verifyErr, setVerifyErr] = useState("");

  // Niveles ya comprados por este ID
  const [boughtLevels, setBoughtLevels] = useState(new Set());
  const [levelBlocked, setLevelBlocked] = useState("");

  // Modal de verificación
  const [modal, setModal] = useState({ open: false, stage: "verifying", errorMsg: "", debugInfo: "", order: null });
  const [reporting, setReporting] = useState(false);
  const [pendingDebt, setPendingDebt] = useState(null);
  const [blocklist, setBlocklist] = useState([]);
  const [blockedInfo, setBlockedInfo] = useState(null);
  const [userIp, setUserIp] = useState(null);
  const [nightEvents, setNightEvents] = useState([]);

  const verifyCfg = verifyCfgForSlug(slug);
  const emailDelivery = isEmailDelivery(slug);
  const cur = tasa > 0 ? "Bs" : "USD";
  const showBs = (usd) => (tasa > 0 ? +(Number(usd) * tasa).toFixed(2) : +Number(usd).toFixed(2));

  const receipt = useReceiptUpload();
  const restoredRef = useRef(false);

  useEffect(() => {
    loadBlocklist().then(setBlocklist).catch(() => {});
    detectUserIp().then((ip) => setUserIp(ip)).catch(() => {});
  }, []);

  useEffect(() => {
    if (blocklist.length && userIp?.ip) {
      const hit = isBlocked(blocklist, { ip: userIp.ip });
      if (hit) setBlockedInfo(hit);
    }
  }, [blocklist, userIp]);

  useEffect(() => {
    base44.entities.Setting.filter({ key: "pago_movil" })
      .then((r) => { if (r[0]?.value) { try { setPagoMovilFallback(JSON.parse(r[0].value)); } catch {} } })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const entities = [base44.entities.Game, base44.entities.GiftCard, base44.entities.Service];
      let found = null;
      for (const E of entities) {
        try { const list = await E.filter({ slug }); if (list && list.length) { found = list[0]; break; } } catch {}
      }
      if (!active) return;
      if (found) { setProduct(found); setConfig(resolveConfig(found, slug)); }
      else setConfig(getPurchaseConfig(slug, slug));
      setLoading(false);

      const vcfg = await getVeniumConfig(); if (!active) return;
      const t = await getTasa(); if (!active) return; setTasa(t);
      const pm = await getPaymentMethods(); if (!active) return; setPayMethods(pm);

      // Paquete más vendido de este producto, contado sobre los pedidos reales.
      // Es un dato del negocio, no una etiqueta inventada: sin historial
      // suficiente (3 pedidos) no se marca nada.
      try {
        const orders = await base44.entities.Order.filter({ product_slug: slug });
        const counts = {};
        (orders || []).forEach((o) => {
          const k = String(o.denomination || "").trim();
          if (k) counts[k] = (counts[k] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (active && top && top[1] >= 3) setTopSeller(top[0]);
      } catch { /* sin historial: la tarjeta se queda sin etiqueta */ }

      // Eventos nocturnos activos para este producto (uno por paquete)
      try {
        const evs = await getActiveEventsForSlug(slug);
        if (active) setNightEvents(evs || []);
      } catch { if (active) setNightEvents([]); }

      // Catálogo en vivo desde Venium (para stock en tiempo real)
      setDenomsLoading(true);
      try {
        const vProd = await Venium.getProduct(found?.config?.venium_product_id || slug);
        if (active) setVeniumProduct(vProd);
      } catch { if (active) setVeniumProduct(null); }
      // Saldo de la wallet Venium (USD) — define qué paquetes son instantáneos.
      try {
        const bal = await Venium.getBalance();
        if (active) setVeniumBalance(bal);
      } catch { if (active) setVeniumBalance(null); }
      if (active) setDenomsLoading(false);
    })();
    return () => { active = false; };
  }, [slug]);

  // Denominaciones con moneda configurada. Prioridad: en vivo desde Mobentas;
  // si falla, usa las guardadas en DB (o el fallback estático de purchaseConfig).
  // Mientras el scrape en vivo está cargando, NO mostramos los precios
  // guardados en la BD (tienen el markup/cálculo viejo y confunden al
  // cliente). Solo caemos al fallback si el scrape falló realmente.
  // Denominaciones desde Venium (sincronizadas en DB). Cada paquete trae su
  // package_id para crear el pedido automáticamente en Venium.
  const baseDenoms = config?.denominations || [];
  const denoms = baseDenoms
    .map((d, i) => {
      const rawUsd = +(d.price || 0).toFixed(2);
      const normalPrice = showBs(rawUsd);
      // Evento nocturno: si este paquete tiene un evento activo, el precio
      // del evento pisa el precio normal. El evento se define en Bs fijos.
      const evMatch = nightEvents.find((e) => {
        if (d.package_id && e.package_id && String(e.package_id) === String(d.package_id)) return true;
        if (e.package_label && e.package_label === d.label) return true;
        return false;
      });
      const isEvent = !!evMatch && (evMatch.stock_sold || 0) < (evMatch.stock_total || 0);
      const price = isEvent ? Number(evMatch.event_price) : normalPrice;
      const currency = isEvent ? "Bs" : (tasa > 0 ? "Bs" : "USD");
      const originalPrice = isEvent ? normalPrice : (d.original_price || 0);
      const isLevel = /nivel\s*\d/i.test(d.label || "");
      // Stock en vivo desde Venium: si el paquete está agotado, se oculta.
      const vPkg = veniumProduct?.packages?.find((p) => p.packageId === d.package_id);
      const outOfStock = d.out_of_stock || (vPkg && vPkg.outOfStock);
      // ¿El saldo de la wallet alcanza para despachar este paquete al instante?
      // venium_price = costo reseller en USD guardado al sincronizar el catálogo.
      const cost = Number(d.venium_price || 0);
      const bal = veniumBalance?.balance != null ? Number(veniumBalance.balance) : null;
      const instant = cost > 0 && bal != null && bal >= cost;
      return { ...d,
        _i: i,
        price, currency,
        original_price: originalPrice,
        _isEvent: isEvent,
        _eventId: isEvent ? evMatch.id : "",
        _packageId: d.package_id,
        _isLevel: isLevel,
        _dispatch: instant ? "venium-instant" : "venium-manual",
        _instant: instant,
        _outOfStock: outOfStock,
      };
    })
    .filter((d) => !d._outOfStock);
  const denomination = denomIndex != null ? denoms.find((d) => d._i === denomIndex) : null;

  // Rearma el pedido al entrar (o recargar) la ruta de pago: sin esto, cambiar
  // de ruta perdería el paquete, el ID y el método elegidos. Si no hay nada
  // guardado, devolvemos al cliente al inicio en vez de mostrar una pantalla vacía.
  useEffect(() => {
    if (!isPayScreen || restoredRef.current || !config || !denoms.length) return;
    const saved = readCheckout();
    const idx = saved && saved.slug === slug
      ? denoms.find((d) => String(d.package_id || d._packageId) === String(saved.packageId))?._i
      : null;
    if (idx == null) { navigate(`/comprar/${slug}`, { replace: true }); return; }
    restoredRef.current = true;
    setPlayerId(saved.playerId || "");
    setServer(saved.server || "");
    setNick(saved.nick || "");
    setPlayerIdVerified(!!saved.verified);
    setEmail(saved.email || "");
    setWhatsapp(saved.whatsapp || "");
    setDenomIndex(idx);
  }, [isPayScreen, config, denoms, slug, navigate]);

  // El método de pago se restaura aparte: la lista de métodos llega después del
  // catálogo, y si el método ya no existe devolvemos al cliente a elegir otro
  // en vez de mostrarle una pantalla de pago vacía.
  useEffect(() => {
    if (!isPayScreen || payment || !payMethods.length) return; // aún cargando
    const saved = readCheckout();
    if (!saved || saved.slug !== slug) return;
    const m = payMethods.find((x) => (x.id || x.name) === saved.paymentId);
    if (m) setPayment(m);
    else navigate(`/comprar/${slug}`, { replace: true });
  }, [isPayScreen, payment, payMethods, slug, navigate]);

  // El margen (5%) ya viene incluido en el precio del scrape; el total es el
  // precio que ve el cliente (sin línea de comisión aparte).
  const fullTotal = denomination ? +denomination.price.toFixed(2) : 0;
  // Aplica el código de descuento si el cliente cargó uno válido.
  const { discountAmount, total } = computeDiscount(fullTotal, discount);
  // Binance se paga en USDT: el resumen muestra el equivalente en USDT.
  const isBinance = !!(payment && (payment.id === "binance" || payment.type === "binance" || /binance/i.test(`${payment.name || ""}`)));
  const totalUsdt = denomination && denomination.currency === "Bs" && tasa > 0 ? +(total / tasa).toFixed(2) : total;

  const canVerifyId = config?.requiresPlayerId ? playerId.trim().length >= 4 : true;

  const loadBoughtLevels = async (pid) => {
    try {
      const recs = await base44.entities.RechargeRecord.filter({ player_id: pid, status: "completed" });
      setBoughtLevels(new Set((recs || []).map((r) => r.producto)));
    } catch { setBoughtLevels(new Set()); }
  };

  const checkPendingDebt = async (pid) => {
    try {
      const list = await base44.entities.Order.filter({ player_id: pid, status: "partial_payment" });
      setPendingDebt(list && list.length ? list[0] : null);
    } catch { setPendingDebt(null); }
  };

  const handleVerifyId = async () => {
    if (!canVerifyId) return;
    setVerifyErr("");
    const pidHit = isBlocked(blocklist, { playerId: playerId.trim() });
    if (pidHit) { setBlockedInfo(pidHit); return; }
    if (!verifyCfg) { setPlayerIdVerified(true); checkPendingDebt(playerId.trim()); return; }
    setVerifyingId(true);
    setNick("");
    const res = await verificarId(slug, playerId.trim(), config.requiresServer ? server.trim() : "");
    setVerifyingId(false);
    if (res.ok) { setNick(res.nickname || ""); setPlayerIdVerified(true); loadBoughtLevels(playerId.trim()); checkPendingDebt(playerId.trim()); }
    else { setPlayerIdVerified(false); setVerifyErr(res.offline ? "No se pudo verificar ahora. Reintenta." : (res.error || "ID no verificado")); }
  };

  const handleSelectDenom = (d) => {
    if (d._isLevel && boughtLevels.has(d.label)) {
      setLevelBlocked(`El paquete ${d.label} ya fue adquirido para este ID de jugador.`);
      setDenomIndex(null); return;
    }
    setLevelBlocked("");
    setDenomIndex(d._i);
    setPayment(null); setBankRef("");
  };

  const emailStepComplete = !emailDelivery || /\S+@\S+\.\S+/.test(email);
  const idStepComplete = (!config?.requiresPlayerId || playerIdVerified) && emailStepComplete;
  const denomStepComplete = denomination != null;
  const payStepComplete = !!payment;

  // Streaming logs del modal "Procesando Recarga" — feed en vivo.
  const logTimerRef = useRef(null);
  const espSecRef = useRef(0);
  const stopEspTimer = () => {
    if (logTimerRef.current) { clearInterval(logTimerRef.current); logTimerRef.current = null; }
  };
  const setLogs = (updater) => setModal((m) => {
    const cur = m.logs || [];
    const next = typeof updater === "function" ? updater(cur) : updater;
    return { ...m, logs: Array.isArray(next) ? next : [] };
  });
  const startEspTimer = (idx) => {
    stopEspTimer();
    espSecRef.current = 0;
    const t0 = Date.now();
    logTimerRef.current = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      espSecRef.current = sec;
      setLogs((cur) => {
        const next = cur.slice();
        if (next[idx]) next[idx] = { ...next[idx], step: `Esperando respuesta ${sec}s...` };
        return next;
      });
    }, 1000);
  };
  useEffect(() => () => stopEspTimer(), []);

  // ===== Reportar pago: feed de logs en vivo hasta "Recarga exitosa ✓" =====
  const handleReport = async (paidAmount) => {
    const paidNum = Number(paidAmount) || 0;
    // El correo pasó a ser opcional (el proveedor no lo pide): solo es
    // obligatorio cuando el producto se entrega por correo.
    if (!/^\d{6,9}$/.test(bankRef) || paidNum <= 0 || whatsapp.replace(/\D/g, "").length < 8) return;
    if (emailDelivery && !email.includes("@")) return;
    setReporting(true);
    const hit = isBlocked(blocklist, { playerId: playerId.trim(), ip: userIp?.ip, email: email.trim(), whatsapp: whatsapp.replace(/\D/g, "") });
    if (hit) { setBlockedInfo(hit); setReporting(false); return; }
    stopEspTimer();
    // Disparamos la detección de IP lo antes posible (anti-fraude: si el
    // comprobante resulta falso, le mostramos su IP y ubicación al cliente).
    const ipPromise = detectUserIp();

    // L1 — Buscando pago en el sistema (anti-fraude + banco)
    setModal({ open: true, stage: "processing", errorMsg: "", debugInfo: "", order: null, botErrInfo: "", ipInfo: null,
      logs: [{ step: "Buscando pago en el sistema...", kind: "wait", status: "active" }] });

    try {
      const existing = await base44.entities.Order.filter({ bank_reference: bankRef });
      // Cualquier coincidencia en otro pedido es fraude: en este punto aún no
      // creamos el Order, así que cualquier match es de un pedido anterior.
      if (existing && existing.length > 0) {
        setReporting(false);
        setModal({ open: true, stage: "error", order: null,
          errorMsg: "Ups! Este pago ya fue utilizado en un pedido anterior.", debugInfo: "" });
        return;
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 400));

    // 🆕 L1b — Revisión IA de la captura: si el cliente subió una imagen que NO
    // corresponde a un comprobante de pago (intentó engañarnos con foto de
    // otro tema), disparamos la advertencia con la IP+ubicación. Esto NO se
    // dispara por errores de tipeo o por fallos honestos del banco: solo ante
    // evidencia clara de comprobante falso.
    if (receipt.receiptUrl) {
      setLogs(() => [
        { step: "Buscando pago en el sistema...", kind: "ok", status: "done" },
        { step: "Revisando captura del comprobante...", kind: "wait", status: "active" },
      ]);

      const vision = await visionCheckReceipt(receipt.receiptUrl, receipt.receiptB64);
      console.log("[vision]", vision);

      // Solo disparamos la advertencia si la IA confirma explícitamente que la
      // imagen no es un comprobante. Errores de red/IA pasan de largo (fail-open).
      if (vision.done && vision.is_payment === false) {
        const reasonTxt = (vision.reason || "").toLowerCase();
        // Si la IA no pudo acceder/cargar la imagen (no la analizó), NO es fraude.
        const couldNotAccess = /no fue proporcionada|no es accesible|no se pudo analizar|no se pudo (cargar|acceder|leer)|could not (access|load|analyze|fetch)|not provided|unable to|image not (found|available|provided)|sin imagen|imagen (no )?(vacía|falta)/i.test(reasonTxt);
        if (couldNotAccess) {
          setLogs((cur) => [
            ...cur.map((l) => l.status === "active" ? { ...l, status: "done", kind: "warn" } : l),
            { step: "No se pudo verificar el comprobante con IA (imagen no accesible)", kind: "warn", status: "done" },
          ]);
        } else {
          const ipInfo = await ipPromise;
          setReporting(false);
          setModal({
            open: true, stage: "error", order: null, ipInfo,
            errorMsg: "La imagen subida no corresponde a un comprobante de pago válido.",
            debugInfo: isAdmin ? `Vision IA${vision.fallback ? " (respaldo Base44)" : ""}: confianza ${vision.confidence}% — ${vision.reason || ""}` : "",
          });
          // Alerta de fraude al WhatsApp del admin (con captura + comprobante original).
          setTimeout(() => {
            reportFraudToAdmin({
              email, whatsapp, playerId: playerId.trim(), bankRef,
              ip: ipInfo?.ip, city: ipInfo?.city, region: ipInfo?.region, country: ipInfo?.country_name,
              confidence: vision.confidence, reason: vision.reason,
              receiptUrl: receipt.receiptUrl,
            }).catch(() => {});
          }, 600);
          return;
        }
      }

      // Log visible del resultado del chequeo de visión
      if (vision.done && vision.is_payment === true) {
        setLogs((cur) => [
          ...cur.map((l) => l.status === "active" ? { ...l, status: "done", kind: "ok" } : l),
          { step: "Comprobante verificado por IA", kind: "ok", status: "done" },
        ]);
      } else if (!vision.done && !vision.skipped) {
        setLogs((cur) => [
          ...cur.map((l) => l.status === "active" ? { ...l, status: "done", kind: "warn" } : l),
          { step: "No se pudo verificar el comprobante con IA", kind: "warn", status: "done" },
        ]);
      }
    }

    // L2 — Verificando pago con el banco (Pabilo)
    setLogs(() => [
      { step: "Buscando pago en el sistema...", kind: "ok", status: "done" },
      { step: "Verificando pago con el banco...", kind: "wait", status: "active" },
    ]);

    const res = await verifyPayment(bankRef, paidNum, {
      onRetry: (attempt, max) => {
        setLogs(() => [
          { step: "Buscando pago en el sistema...", kind: "ok", status: "done" },
          { step: `El banco aún no registra el pago. Reintentando (${attempt + 1}/${max})...`, kind: "wait", status: "active" },
        ]);
      },
    });
    if (!res.ok || res.is_new === false) {
      // Errores honestos (ref mal escrita, banco caído, monto mal cubierto,
      // etc.) NO disparan la advertencia de IP: solo el mensaje friendly.
      setReporting(false);
      setModal({
        open: true, stage: "error", order: null,
        errorMsg: res.is_new === false ? "Esta referencia ya fue utilizada anteriormente." : friendlyPabiloError(res),
        debugInfo: isAdmin ? `HTTP ${res.status ?? "—"}${res.raw ? " · " + res.raw : ""}${res.code ? " · " + res.code : ""}` : "",
      });
      return;
    }

    // Guardamos el último ID de jugador usado para precargarlo la próxima vez.
    if (config.requiresPlayerId && playerId.trim()) {
      try { localStorage.setItem("legacy_last_player_id", playerId.trim()); } catch {}
    }

    await new Promise((r) => setTimeout(r, 500));

    // L3 — Pago verificado por el banco (logs inmutables)
    const verifiedLogs = [
      { step: "Buscando pago en el sistema...", kind: "ok", status: "done" },
      { step: "Pago verificado por el banco", kind: "ok", status: "done" },
    ];
    setLogs(() => verifiedLogs);
    // El pago ya quedó verificado: la selección guardada dejó de servir.
    clearCheckout();

    const ipInfo = await ipPromise;

    const packageId = denomination?.package_id || denomination?._packageId || "";
    const veniumProductId = config?.venium_product_id || slug;
    let botErrInfo = "";
    const isPartial = paidNum < total;
    const firstLog = [{ reference: bankRef, amount: paidNum, receipt_url: receipt.receiptUrl || "", timestamp: new Date().toISOString() }];

    // —— Pago parcial: saldo como deuda (no recarga)
    if (isPartial) {
      const balance = +Number(total - paidNum).toFixed(2);
      const partialLogs = [...verifiedLogs, { step: "Pago parcial: saldo registrado para completar después", kind: "warn", status: "done" }];
      setLogs(() => partialLogs);
      try {
        const created = await base44.entities.Order.create({
          product_name: product?.name || config.title, product_slug: slug, product_image_url: product?.image_url || "",
          category: product?.category || (config.isGiftCard ? "Gift Card" : "Juego"),
          player_id: config.requiresPlayerId ? playerId.trim() : "", server: config.requiresServer ? server.trim() : "",
          denomination: denomination.label, price: total, amount_paid: paidNum, balance,
          payment_method: payment.name, customer_email: email.trim(), customer_whatsapp: whatsapp.replace(/\D/g, ""), bank_reference: bankRef,
          receipt_url: receipt.receiptUrl || "", bot_product: packageId || "",
          customer_ip: (ipInfo && ipInfo.ip) || "",
          discount_code: discount?.code || "",
          discount_amount: discountAmount || 0,
          status: "partial_payment", payment_log: firstLog,
        });
        if (created.discount_code) { try { await logCodeUsage(created); } catch {} }
        notifyWhatsAppOrder(created, { dispatch: "partial", currency: cur, discount }).catch(() => {});
        try { addPendingOrder(created); } catch {}
        if (created.customer_email) {
          const email = paymentVerifiedEmail({ ...created, _currency: cur });
          sendOrderEmail(created.customer_email, email.subject, email.body).catch(() => {});
        }
        setModal({ open: true, stage: "partial", errorMsg: "", debugInfo: "", order: created, logs: partialLogs });
      } catch (err) {
        setModal({ open: true, stage: "error", order: null, debugInfo: isAdmin ? `Order.create: ${err.message || ""}` : "", errorMsg: err.message || "No se pudo registrar el pago. Intenta de nuevo." });
      } finally { setReporting(false); }
      return;
    }

    // —— Despacho vía Venium
    // Si el paquete es "manual" (el saldo de la wallet no alcanza), NO se
    // intenta despachar automáticamente: el pedido queda pendiente y el
    // admin lo procesa cuando recargue la wallet. Así no se rompe nada.
    const isInstant = denomination?._instant === true;
    let veniumResult = null;
    let veniumError = "";
    let veniumSuccess = false;
    let finishLogs;
    let deliveryCode = "";

    if (!isInstant) {
      // Despacho manual: el admin lo procesará cuando tenga saldo.
      finishLogs = [
        ...verifiedLogs,
        { step: "Pago verificado. Pedido en cola (despacho manual).", kind: "warn", status: "done" },
      ];
      setLogs(() => finishLogs);
      // Sin botErrInfo: el modal muestra el mensaje limpio de "en proceso".
    } else {
      setLogs(() => [...verifiedLogs, { step: "Conectando con el servidor de recargas...", kind: "wait", status: "active" }]);
      await new Promise((r) => setTimeout(r, 600));
      setLogs(() => [
        ...verifiedLogs,
        { step: "Conectando con el servidor de recargas...", kind: "ok", status: "done" },
        { step: "Procesando recarga...", kind: "wait", status: "active" },
      ]);

      const espIdx = verifiedLogs.length + 1;
      startEspTimer(espIdx);

      try {
        veniumResult = await Venium.createOrder({
          productId: veniumProductId,
          packageId: packageId,
          playerData: config?.requiresPlayerId
            ? { player_id: playerId.trim() }
            : { email: email.trim() },
        });
      } catch (e) {
        veniumError = e?.message || "El servidor no respondió";
      }
      stopEspTimer();
      const secs = espSecRef.current || 0;
      veniumSuccess = veniumResult && !!veniumResult.orderId;
      if (!veniumSuccess) botErrInfo = veniumError || veniumResult?.error || "El servidor no respondió";

      // Extrae el código de entrega (gift cards): la API puede devolverlo en
      // distintos campos según el producto. Se guarda para mostrarlo al
      // cliente y enviarlo por correo como respaldo.
      deliveryCode =
        veniumResult?.code || veniumResult?.pin || veniumResult?.serial ||
        veniumResult?.voucher_code || veniumResult?.voucher ||
        veniumResult?.delivery?.code || veniumResult?.delivery?.pin ||
        veniumResult?.cards?.[0]?.code || veniumResult?.cards?.[0]?.pin ||
        veniumResult?.cardCode || veniumResult?.card_code || "";

      finishLogs = [
        ...verifiedLogs,
        { step: "Conectando con el servidor de recargas...", kind: "ok", status: "done" },
        { step: `Esperando respuesta ${secs}s...`, kind: "ok", status: "done" },
        { step: `Respuesta recibida (${secs}s)`, kind: veniumSuccess ? "ok" : "warn", status: "done" },
        veniumSuccess
          ? { step: "Recarga exitosa ✓", kind: "ok", status: "done" }
          : { step: `El servidor no respondió: ${botErrInfo}`, kind: "warn", status: "done" },
      ];
      setLogs(() => finishLogs);
    }

    await new Promise((r) => setTimeout(r, 1100));

    try {
      const created = await base44.entities.Order.create({
        product_name: product?.name || config.title, product_slug: slug, product_image_url: product?.image_url || "",
        category: product?.category || (config.isGiftCard ? "Gift Card" : "Juego"),
        player_id: config.requiresPlayerId ? playerId.trim() : "", server: config.requiresServer ? server.trim() : "",
        denomination: denomination.label, price: total, amount_paid: paidNum, balance: 0,
        payment_method: payment.name, customer_email: email.trim(), customer_whatsapp: whatsapp.replace(/\D/g, ""), bank_reference: bankRef,
        receipt_url: receipt.receiptUrl || "", bot_product: packageId || "",
        customer_ip: (ipInfo && ipInfo.ip) || "",
        discount_code: discount?.code || "",
        discount_amount: discountAmount || 0,
        bot_tx_id: veniumResult?.orderId || "",
        delivery_code: deliveryCode || "",
        status: veniumSuccess ? "completed" : "pending",
        payment_log: firstLog,
      });
      if (veniumSuccess && denomination?._isLevel) {
        try {
          await base44.entities.RechargeRecord.create({
            player_id: playerId.trim(), producto: denomination.label,
            producto_nombre: denomination.label, producto_tipo: "nivel",
            tx_id: created.bot_tx_id || "", amount: String(total), status: "completed",
          });
        } catch {}
      }
      // Evento nocturno: consume 1 unidad de stock al completar la compra.
      if (veniumSuccess && denomination?._isEvent && denomination?._eventId) {
        try { await consumeEventStock(denomination._eventId, created.id); } catch {}
      }
      if (created.discount_code) {
        try { await logCodeUsage(created); } catch {}
        if (veniumSuccess) {
          try { await creditCommission(created); } catch {}
        }
      }
      notifyWhatsAppOrder(created, { dispatch: isInstant ? "venium" : "manual", currency: cur, discount })
        .then((r) => { if (!r?.ok) console.warn("[telegram] no se envió:", r?.error || r); })
        .catch((e) => console.warn("[telegram] error:", e?.message || e));
      if (created.customer_whatsapp) {
        const waMsg = veniumSuccess ? completionMessage(created) : paymentVerifiedMessage(created, nick);
        sendWhatsAppMessage(created.customer_whatsapp, waMsg).catch(() => {});
      }
      if (created.customer_email) {
        const emailContent = veniumSuccess ? completionEmail({ ...created, _currency: cur }) : paymentVerifiedEmail({ ...created, _currency: cur });
        sendOrderEmail(created.customer_email, emailContent.subject, emailContent.body).catch(() => {});
      }
      setModal({ open: true, stage: veniumSuccess ? "done" : "manual", errorMsg: "", debugInfo: "", botErrInfo, order: created, logs: finishLogs });
    } catch (err) {
      setModal({ open: true, stage: "error", order: null, debugInfo: isAdmin ? `Order.create: ${err.message || ""}` : "", errorMsg: err.message || "No se pudo registrar el pedido. Intenta de nuevo." });
    } finally {
      setReporting(false);
    }
  };

  const resetPaymentForm = () => {
    setBankRef(""); receipt.clear();
  };

  // Guarda la selección y pasa a la pantalla de datos del pago (otra ruta).
  const goToPayScreen = () => {
    if (!denomination || !payment) return;
    saveCheckout({
      slug,
      playerId: playerId.trim(),
      server: server.trim(),
      nick,
      verified: playerIdVerified,
      email: email.trim(),
      whatsapp,
      packageId: denomination.package_id || denomination._packageId,
      paymentId: payment.id || payment.name,
    });
    setPayModalOpen(false);
    navigate(`/pagar/${slug}`);
  };

  if (loading || !config) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (blockedInfo) {
    return <BlockScreen block={blockedInfo} />;
  }

  const heroImage = product?.image_url;
  const title = product?.name || config.title;

  return (
    // pb-32: la barra flotante ya no es solo de móvil (marca la acción de la
    // pantalla), así que el contenido tiene que quedarle libre abajo.
    <div className="bg-background min-h-screen pb-32">
      <div className="border-b border-border/20 bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          <Link to="/" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary text-sm transition-colors mb-2">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>
          <div className="flex items-center gap-4">
            {heroImage && <ProductImage src={heroImage} alt={title} className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-border/20" />}
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-foreground">{title}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                {denomination ? (
                  denomination._instant ? (
                    <><Zap className="w-3.5 h-3.5 text-primary" /> Recarga instantánea · Pago seguro</>
                  ) : (
                    <><Clock className="w-3.5 h-3.5 text-amber-400" /> Despacho manual · Pago seguro</>
                  )
                ) : (
                  <>Recarga instantánea · Pago seguro</>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-4 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-4 sm:space-y-6">
          {/* PASO 1 — ID */}
          {!isPayScreen && stage === "packages" && config?.requiresPlayerId && (
            <AnimatePresence mode="wait">
              <motion.section key="id" {...fadeIn} transition={{ duration: 0.3 }} className="bg-card border border-border rounded-2xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <StepBadge n={1} done={idStepComplete} />
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Identificación de jugador</h2>
                  {playerIdVerified && <BadgeCheck className="w-4 h-4 text-green-400 ml-auto" />}
                </div>
                {/* Un solo campo: el ID y el botón de verificar pegados. El
                    resultado sale como etiqueta de una línea debajo, no como
                    una caja que empuja todo hacia abajo. */}
                <div className={`grid gap-2.5 ${config.requiresServer ? "grid-cols-1 sm:grid-cols-[1fr_120px]" : "grid-cols-1"}`}>
                  <div className="relative flex items-center">
                    <User className="w-4 h-4 text-muted-foreground absolute left-3 pointer-events-none" />
                    <input value={playerId} onChange={(e) => { setPlayerId(e.target.value); setPlayerIdVerified(false); setNick(""); setVerifyErr(""); setPendingDebt(null); }}
                      placeholder={config.idPlaceholder}
                      inputMode="numeric"
                      aria-label={config.idLabel || "Player ID"}
                      className="w-full bg-muted border border-border rounded-xl py-2.5 pl-9 pr-28 text-sm text-foreground focus:outline-none focus:border-primary transition-colors" />
                    <button
                      type="button"
                      onClick={handleVerifyId}
                      disabled={!canVerifyId || playerIdVerified || verifyingId}
                      className={`tap absolute right-1.5 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wide ${
                        playerIdVerified
                          ? "bg-green-500/15 text-green-400 border border-green-500/40"
                          : "bg-gradient-to-r from-amber-500 to-orange-500 text-black disabled:opacity-40 glow-amber"
                      }`}
                    >
                      {verifyingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : playerIdVerified ? <BadgeCheck className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      {verifyingId ? "Verificando" : playerIdVerified ? "Verificado" : "Verificar"}
                    </button>
                  </div>
                  {config.requiresServer && (
                    <input value={server} onChange={(e) => { setServer(e.target.value); setPlayerIdVerified(false); setVerifyErr(""); }}
                      placeholder="Zona / Server"
                      inputMode="numeric"
                      aria-label="Zona o server"
                      className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors" />
                  )}
                </div>
                {config.idHint && <p className="text-[11px] text-muted-foreground mt-2">{config.idHint}</p>}
                {verifyErr && (
                  <p className="mt-2 text-[11px] text-destructive font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {verifyErr}
                  </p>
                )}

                {/* Jugador verificado en una línea: nombre + ID. Verde cuando el
                    juego devolvió el apodo, ámbar cuando solo validó el ID. */}
                <AnimatePresence>
                  {playerIdVerified && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className={`mt-2.5 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                        nick ? "border-green-500/40 bg-green-500/10" : "border-amber-500/40 bg-amber-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          nick ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"
                        }`}>
                          <Check className="w-3 h-3" strokeWidth={3} />
                        </span>
                        <div className="min-w-0">
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground block leading-none">Jugador verificado</span>
                          <span className={`text-sm font-black truncate block ${nick ? "text-green-400" : "text-amber-400"}`}>
                            {nick || "ID válido"}
                          </span>
                        </div>
                      </div>
                      <span className="num text-[10px] font-mono px-2 py-0.5 rounded border border-border bg-card text-muted-foreground shrink-0">
                        ID {playerId}{server ? ` · ${server}` : ""}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {pendingDebt && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-amber-300">Tienes un pago pendiente</p>
                        <p className="text-xs text-amber-200/80 mt-0.5">
                          Debes <span className="font-bold">completar el saldo de {(pendingDebt.balance ?? 0).toFixed(2)} {cur}</span> de tu pedido anterior antes de hacer una nueva compra.
                        </p>
                        <p className="text-[11px] text-amber-200/70 mt-1">
                          {pendingDebt.product_name} · {pendingDebt.denomination} · Pedido #{String(pendingDebt.id).slice(-8)}
                        </p>
                        <Link to={`/completar-pago/${pendingDebt.id}`}>
                          <Button size="sm" className="mt-2.5 font-bold h-9">
                            <Wallet className="w-4 h-4 mr-1.5" /> Completar pago
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.section>
            </AnimatePresence>
          )}

          {/* PASO 1b — Correo de entrega (productos por email) */}
          {!isPayScreen && stage === "packages" && emailDelivery && !config?.requiresPlayerId && (
            <AnimatePresence mode="wait">
              <motion.section key="email" {...fadeIn} transition={{ duration: 0.3 }} className="bg-card border border-border/60 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <StepBadge n={1} done={emailStepComplete} />
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Correo de entrega</h2>
                </div>
                <EmailDeliveryStep email={email} setEmail={setEmail} slug={slug} />
              </motion.section>
            </AnimatePresence>
          )}

          {/* PASO 2 — Paquete */}
          {!isPayScreen && stage === "packages" && idStepComplete && !pendingDebt && (
            <AnimatePresence mode="wait">
              <motion.section key="denom" {...fadeIn} transition={{ duration: 0.3 }} className="bg-card border border-border rounded-2xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4">
                  <StepBadge n={(config.requiresPlayerId || emailDelivery) ? 2 : 1} done={denomStepComplete} />
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Selecciona el monto</h2>
                  {veniumProduct ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full badge-pulse">
                      <Zap className="w-3 h-3" /> En vivo
                    </span>
                  ) : denomsLoading ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" /> Consultando precios…
                    </span>
                  ) : null}
                </div>
                {levelBlocked && <div className="mb-3 p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> {levelBlocked}</div>}
                <DenominationPicker denominations={denoms} selected={denomination} onSelect={handleSelectDenom} currencyLabel={getCurrencyLabel(slug)} regions={config?.regions} topSeller={topSeller} />
              </motion.section>
            </AnimatePresence>
          )}

          {/* PANTALLA 2 — Método de pago (misma ruta, otra pantalla: no hay
              que deslizar hasta el final para llegar al pago). */}
          {!isPayScreen && stage === "metodo" && denomStepComplete && idStepComplete && (
            <AnimatePresence mode="wait">
              <motion.section id="pago" key="pay" {...fadeIn} transition={{ duration: 0.3 }} className="bg-card border border-border rounded-2xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <StepBadge n={(config.requiresPlayerId || emailDelivery) ? 3 : 2} done={payStepComplete} />
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Método de pago</h2>
                </div>

                <button
                  type="button"
                  onClick={() => setStage("packages")}
                  className="tap mb-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Cambiar paquete
                </button>

                {/* El código de descuento va aquí: es lo último que se aplica
                    antes de pagar, y en móvil el resumen lateral no se ve. */}
                <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3">
                  <DiscountCode
                    discount={discount}
                    onApply={(d) => setDiscount(d)}
                    playerId={config.requiresPlayerId ? playerId.trim() : ""}
                    email={email.trim()}
                  />
                </div>

                {/* Los métodos salen solo del panel del negocio (Setting
                    payment_methods). No se cae a la lista de ejemplo: si
                    cambia la configuración, la compra se cortaría después al
                    no encontrar el método elegido. */}
                {payMethods.length ? (
                  <PaymentPicker
                    methods={payMethods}
                    selected={payment}
                    onSelect={(m) => { setPayment(m); setBankRef(""); }}
                  />
                ) : (
                  <div className="py-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Cargando métodos de pago…
                  </div>
                )}
              </motion.section>
            </AnimatePresence>
          )}

          {/* PANTALLA 3 — Datos del pago (ruta /pagar/:slug). Aquí el cliente ya
              transfirió: ve los datos, y confirma con la referencia desde la
              ventana superpuesta. Sin comprobante y sin bajar por la página. */}
          {isPayScreen && denomStepComplete && (
            <motion.section key="paydata" {...fadeIn} transition={{ duration: 0.3 }} className="space-y-4">
              {!payment ? (
                <div className="py-16 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
              <>
              <PaymentDetails method={payment} fallback={pagoMovilFallback} total={total} currency={cur} />

              <div className="surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="tap w-full flex items-center gap-3 px-4 py-3.5 text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-muted border border-border flex items-center justify-center shrink-0">
                    <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-black text-muted-foreground uppercase tracking-[0.16em]">Resumen</span>
                    <span className="block text-sm font-black text-foreground uppercase tracking-wide">Detalles de tu compra</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${showDetails ? "rotate-180" : ""}`} />
                </button>
                {showDetails && (
                  <div className="px-4 pb-4 pt-3 space-y-2 text-xs border-t border-border/60">
                    <SummaryRow k="Producto" v={title} />
                    <SummaryRow k="Paquete" v={denomination?.label} />
                    {config?.requiresServer && <SummaryRow k="Zona" v={server.trim()} />}
                    {config?.requiresPlayerId && <SummaryRow k="Jugador" v={`${nick || ""} ${playerId}`.trim()} />}
                    <SummaryRow k="Método" v={payment?.name} />
                    {discountAmount > 0 && <SummaryRow k="Descuento" v={`-${formatPrice(discountAmount)} ${cur}`} />}
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/60">
                      <span className="text-muted-foreground font-bold">Total a pagar</span>
                      <span className="num text-amber-300 font-black text-sm">{formatPrice(total)} {cur}</span>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-center text-[11px] text-muted-foreground">
                Haz la transferencia con estos datos y toca <span className="font-bold text-foreground">Ya pagué</span> para confirmarla con tu referencia.
              </p>
              </>
              )}
            </motion.section>
          )}
        </div>

        {/* Resumen lateral — desktop */}
        <aside className="hidden lg:block">
          <div className="lg:sticky lg:top-20">
            <SummaryCard
              title={title}
              heroImage={heroImage}
              denomination={denomination}
              total={total}
              totalUsdt={totalUsdt}
              isBinance={isBinance}
              dispatch={denomination?._dispatch}
              playerId={config.requiresPlayerId ? playerId.trim() : ""}
              server={config.requiresServer ? server.trim() : ""}
              nick={nick}
              email={email.trim()}
              cur={cur}
              discount={discount}
              discountAmount={discountAmount}
              onApplyDiscount={(d) => setDiscount(d)}
            />
          </div>
        </aside>
      </div>

      {/* Barra fija con el total: el precio y el botón nunca se van de la pantalla.
          Es lo que convierte la compra en un flujo de app y no en una página larga. */}
      {denomination && (
        <div className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3 max-w-3xl mx-auto">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide truncate">
                {isPayScreen || stage === "metodo" ? `Player ID: ${playerId || "—"}` : "Paquete seleccionado"}
              </p>
              <p className="text-sm font-black text-foreground truncate leading-tight">{denomination.label}</p>
              <p className="num text-lg font-black text-amber-300 leading-tight">
                <span className="text-[10px] font-bold text-muted-foreground uppercase mr-1">Total</span>
                {formatPrice(total)} <span className="text-xs font-bold">{cur}</span>
              </p>
            </div>
            {/* Una sola acción visible, la de ESTA pantalla: avanzar, comprar o
                confirmar el pago. Igual que el checkout del proveedor. */}
            <Button
              onClick={() => {
                if (isPayScreen) { setPayModalOpen(true); return; }
                if (stage === "packages") { setStage("metodo"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
                goToPayScreen();
              }}
              disabled={!isPayScreen && stage === "metodo" && !payStepComplete}
              className="tap h-12 px-4 font-black uppercase tracking-wide text-black bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 glow-amber disabled:opacity-40 disabled:grayscale shrink-0"
            >
              {isPayScreen ? "Ya pagué" : stage === "packages" ? "Siguiente" : "Comprar"}
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Ventana superpuesta "Ya pagué": referencia y teléfono. Sin comprobante
          y sin bajar por la página, como el proveedor. */}
      <AnimatePresence>
        {payModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4"
            onClick={() => !reporting && setPayModalOpen(false)}
          >
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md bg-card border border-border rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-black text-foreground uppercase tracking-wide">Verificar pago</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Escribe la referencia que generó tu banco y tu WhatsApp.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPayModalOpen(false)}
                  className="tap w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <PaymentForm
                email={email} setEmail={setEmail}
                whatsapp={whatsapp} setWhatsapp={setWhatsapp}
                bankRef={bankRef} setBankRef={setBankRef}
                onReport={(paid) => { setPayModalOpen(false); handleReport(paid); }}
                reporting={reporting} total={total} currency={cur} emailDelivery={emailDelivery}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <VerifyModal
        open={modal.open} stage={modal.stage} errorMsg={modal.errorMsg} order={modal.order} cur={cur}
        debugInfo={modal.debugInfo}
        logs={modal.logs}
        botErrInfo={modal.botErrInfo}
        ipInfo={modal.ipInfo}
        onRetry={() => {
          setModal({ open: false, stage: "verifying", errorMsg: "", debugInfo: "", order: null, ipInfo: null });
          resetPaymentForm();
          // Reabre la ventana para volver a escribir la referencia (reintento).
          setPayModalOpen(true);
        }}
        onHome={() => { setModal({ open: false, stage: "verifying", errorMsg: "", debugInfo: "", order: null, ipInfo: null }); window.location.href = "/"; }}
      />
    </div>
  );
}