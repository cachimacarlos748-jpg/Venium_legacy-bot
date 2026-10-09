import { useState, useEffect } from "react";
import { Printer, FileDown, Database, Palette, Code2, Cloud, Key, ShoppingCart, Settings, Users, Shield, Layers } from "lucide-react";

// =====================================================================
// DOCUMENTACIÓN COMPLETA PARA MIGRACIÓN — Vex Store
// Tema único: oscuro premium con violeta de marca.
// =====================================================================

const SECTIONS = [
  { id: "overview", label: "Resumen", icon: Layers },
  { id: "stack", label: "Stack Tecnológico", icon: Code2 },
  { id: "design", label: "Sistema de Diseño", icon: Palette },
  { id: "structure", label: "Estructura de Archivos", icon: Code2 },
  { id: "entities", label: "Base de Datos (Entities)", icon: Database },
  { id: "routes", label: "Páginas y Rutas", icon: Layers },
  { id: "integrations", label: "Integraciones Externas", icon: Cloud },
  { id: "workers", label: "Cloudflare Workers", icon: Cloud },
  { id: "supabase", label: "Supabase Edge Functions", icon: Cloud },
  { id: "secrets", label: "Variables y Secretos", icon: Key },
  { id: "payment", label: "Flujo de Compra", icon: ShoppingCart },
  { id: "admin", label: "Panel Admin", icon: Settings },
  { id: "creators", label: "Programa de Creadores", icon: Users },
  { id: "fraud", label: "Sistema Anti-Fraude", icon: Shield },
  { id: "migration", label: "Notas de Migración", icon: FileDown },
];

// ---- DESIGN SYSTEM ----
const DESIGN_TOKENS = [
  { token: "--primary", value: "258 90% 66%", hex: "#7C3AED", desc: "Morado principal — botones, acentos, enlaces" },
  { token: "--primary-foreground", value: "0 0% 100%", hex: "#FFFFFF", desc: "Texto sobre primary" },
  { token: "--accent", value: "293 85% 68%", hex: "#C026D3", desc: "Morado/magenta de acento" },
  { token: "--background", value: "250 25% 5%", hex: "#0B0A14", desc: "Fondo oscuro casi negro con tinte morado" },
  { token: "--card", value: "250 18% 8%", hex: "#121019", desc: "Fondo de tarjetas" },
  { token: "--border", value: "255 30% 18%", hex: "#2A2540", desc: "Bordes sutiles" },
  { token: "--input", value: "250 18% 10%", hex: "#16131F", desc: "Fondo de inputs" },
  { token: "--muted", value: "250 15% 10%", hex: "#16131F", desc: "Fondo muted" },
  { token: "--muted-foreground", value: "262 15% 66%", hex: "#9B96B8", desc: "Texto secundario" },
  { token: "--secondary", value: "250 18% 12%", hex: "#1C1929", desc: "Fondo secundario" },
  { token: "--destructive", value: "0 70% 50%", hex: "#D32F2F", desc: "Errores / eliminar" },
  { token: "--ring", value: "258 90% 66%", hex: "#7C3AED", desc: "Focus ring" },
  { token: "--radius", value: "0.19rem", hex: "—", desc: "Bordes redondeados (sutil, casi cuadrado)" },
];

const FONTS = [
  { role: "font-heading", family: "'Outfit', 'Roboto', sans-serif", desc: "Titulares y encabezados" },
  { role: "font-body", family: "'Outfit', 'Roboto', sans-serif", desc: "Texto general" },
  { role: "font-display", family: "'Outfit', 'Roboto', sans-serif", desc: "Texto display / hero" },
];

// ---- ENTITIES ----
const ENTITIES = [
  { name: "User", desc: "Usuario del sistema (built-in). Campos: id, email, full_name, role (admin/user). No se puede crear directamente — se invita.", rls: "Solo admins pueden listar/editar/eliminar otros usuarios." },
  { name: "Game", desc: "Juegos del catálogo. Campos: name, category, description, image_url, badge, slug, sort_order, config (JSON con denominaciones, venium_product_id, requiresPlayerId, etc.)", rls: "Lectura pública. Crear/editar/eliminar: solo admin." },
  { name: "GiftCard", desc: "Gift cards del catálogo. Campos: name, image_url, slug, sort_order, config (JSON con denominaciones, etc.)", rls: "Lectura pública. Crear/editar/eliminar: solo admin." },
  { name: "Service", desc: "Servicios del catálogo. Campos: name, image_url, description, slug, sort_order, config", rls: "Lectura pública. Crear/editar/eliminar: solo admin." },
  { name: "Order", desc: "Pedidos de compra. Campos: order_number, product_name, product_slug, product_image_url, category, player_id, server, denomination, price, amount_paid, balance, payment_method, customer_email, customer_whatsapp, bank_reference, receipt_url, payment_log[], bot_product, bot_tx_id, delivery_code, customer_ip, discount_code, discount_amount, vuelto_log[], status (pending/processing/completed/cancelled/partial_payment)", rls: "Lectura pública. Crear: público. Actualizar: público. Eliminar: solo admin." },
  { name: "Setting", desc: "Configuración pública del store (clave-valor). Keys: pago_movil, carousel_items, etc.", rls: "Lectura pública. Escribir: solo admin." },
  { name: "SecretSetting", desc: "Configuración secreta del store (API keys, configs sensibles). Keys: venium, pabilo, mobentas, gemini, whatsapp, telegram, etc.", rls: "Todo solo admin." },
  { name: "RechargeRecord", desc: "Registro de recargas completadas (para anti-duplicados de niveles). Campos: player_id, producto, producto_nombre, producto_tipo, tx_id, amount, status", rls: "Lectura pública. Crear: público. Actualizar/eliminar: solo admin." },
  { name: "Creator", desc: "Creadores de contenido (programa de afiliados). Campos: name, email, whatsapp, tiktok_handle, code, status, approved_date, panel_pin, balance, total_code_uses, commission_log[], payout_log[], withdrawal_requests[]", rls: "Lectura pública. Crear: created_by_id = user.id. Actualizar: propio o admin. Eliminar: admin." },
  { name: "CreatorVideo", desc: "Videos de TikTok enviados por creadores para validación de vistas. Campos: creator_email, creator_name, whatsapp, tiktok_url, game, game_id, code, week_end_date, days_active, status, views_initial, views_current, reward_tier, reward_label, screenshot_url", rls: "Lectura pública. Crear: propio. Actualizar/eliminar: admin." },
  { name: "PrizeCode", desc: "Códigos de canje para premios gratuitos. Campos: code, prize_label, bot_product, max_uses, used_count, status, expires_date, redemption_log[]", rls: "Lectura pública. Crear/eliminar: admin. Actualizar: público (para canje)." },
  { name: "SupportTicket", desc: "Tickets de soporte. Campos: customer_phone, order_number, message, attachments[], status, admin_reply", rls: "Lectura pública. Crear: público. Actualizar/eliminar: admin." },
  { name: "BotAuditLog", desc: "Log de auditoría del bot (requests, respuestas, errores). Campos: action, endpoint, method, status_code, ip, user_agent, order_number, detail", rls: "Lectura/actualizar/eliminar: admin. Crear: público." },
  { name: "Blocklist", desc: "Lista de bloqueo anti-fraude (player_id, ip, email, whatsapp). Campos: type, value, reason", rls: "Lectura pública. Crear/actualizar/eliminar: admin." },
  { name: "NightEvent", desc: "Eventos flash-sale nocturnos con stock limitado y precio especial en Bs. Campos: product_slug, product_name, package_id, package_label, event_price, stock_total, stock_sold, status, orders_log[], closed_date", rls: "Lectura pública. Crear/eliminar: admin. Actualizar: público (consume stock)." },
];

// ---- ROUTES ----
const ROUTES = [
  { path: "/", page: "Home", desc: "Landing page con catálogo de juegos, gift cards, servicios, carrusel, cupones, FAQ, ticker de recargas recientes.", auth: false },
  { path: "/Games", page: "Games", desc: "Catálogo completo de juegos con filtros.", auth: false },
  { path: "/GiftCards", page: "GiftCards", desc: "Catálogo completo de gift cards.", auth: false },
  { path: "/Servicios", page: "Servicios", desc: "Catálogo de servicios.", auth: false },
  { path: "/comprar/:slug", page: "Comprar", desc: "Flujo de compra completo: verificar ID → elegir paquete → método de pago → subir comprobante → despacho automático.", auth: false },
  { path: "/completar-pago/:orderId", page: "CompletarPago", desc: "Completar pago parcial de un pedido pendiente.", auth: false },
  { path: "/creadores", page: "Creadores", desc: "Registro de creadores + panel de afiliados (login con PIN).", auth: false },
  { path: "/canjear", page: "Canjear", desc: "Canje de códigos de premio (PrizeCode).", auth: false },
  { path: "/mis-pedidos", page: "MisPedidos", desc: "Pedidos del cliente (busca por email/whatsapp).", auth: false },
  { path: "/Login", page: "Login", desc: "Login con email/password + Google OAuth + OTP.", auth: false },
  { path: "/Register", page: "Register", desc: "Registro → OTP → verificación.", auth: false },
  { path: "/forgot-password", page: "ForgotPassword", desc: "Solicitar reset de contraseña.", auth: false },
  { path: "/reset-password", page: "ResetPassword", desc: "Reset con token (lee ?token=).", auth: false },
  { path: "/admin", page: "Admin", desc: "Panel admin completo (protegido, role=admin).", auth: true },
  { path: "/freefire", page: "FreeFirePanel", desc: "Panel del bot de Free Fire (protegido).", auth: true },
  { path: "/perfil", page: "Perfil", desc: "Perfil del usuario (protegido).", auth: true },
];

// ---- INTEGRATIONS ----
const INTEGRATIONS = [
  { name: "Venium API", desc: "Proveedor de recargas (reseller). Catálogo, precios, saldo de wallet, despacho automático de pedidos. API key secreta en Cloudflare Worker. Endpoints: balance, catalog, orders (create/list).", config: "SecretSetting key 'venium' → {proxy_url, auth_key, markup, venium_rate, rate_spread}" },
  { name: "Pabilo API", desc: "Verificación de pagos bancarios en tiempo real (Pago Móvil, transferencias). Verifica referencia + monto contra el banco.", config: "SecretSetting key 'pabilo' → {api_key, user_bank_id, movement_type, bank_origin}" },
  { name: "Mobentas API", desc: "Verificación de ID de jugador en tiempo real + sincronización de catálogo/precios. Vía proxy CORS (Cloudflare Worker).", config: "SecretSetting key 'mobentas' → {enabled, base, markup, currency, tasa, proxy}" },
  { name: "Gemini API", desc: "Revisión IA de comprobantes de pago (vision). Detecta comprobantes falsos (memes, fotos irrelevantes). API key externa del admin.", config: "SecretSetting key 'gemini' → {api_key, model}" },
  { name: "WhatsApp (WhatsApp Business)", desc: "Notificaciones al cliente: pago verificado, recarga exitosa, alertas de fraude al admin. Vía API de WhatsApp Cloud o Edge Function.", config: "SecretSetting key 'whatsapp' → {token, phone_number_id, admin_phone}" },
  { name: "Telegram Bot", desc: "Notificaciones de pedidos al canal/chat del admin.", config: "SecretSetting key 'telegram' → {bot_token, chat_id}" },
  { name: "Email (Base44 SendEmail)", desc: "Confirmaciones de pago y recarga exitosa al cliente. Usa integración Core.SendEmail de Base44.", config: "No requiere config adicional (integración nativa)." },
  { name: "Tasa de Cambio (Binance P2P)", desc: "Tasa USD→Bs para mostrar precios en bolívares. Obtenida vía Binance P2P API o configurada manualmente.", config: "SecretSetting key 'tasa' → {value, source, last_update}" },
];

// ---- CLOUDFLARE WORKERS ----
const WORKERS = [
  { file: "src/proxy/venium-proxy.worker.js", desc: "Proxy para Venium API. Esconde la API key de Venium. Endpoints: /balance, /catalog, /orders. Autorización con ?key=legacy_venium_2025." },
  { file: "src/proxy/mobentas-proxy.worker.js", desc: "Proxy CORS para Mobentas (verificación de ID + catálogo). Resuelve el problema de CORS del navegador." },
  { file: "src/proxy/nexus-proxy.worker.js", desc: "Proxy para el bot de Nexus Razer (legacy, posiblemente deprecado)." },
  { file: "src/proxy/uploads-proxy.worker.js", desc: "Proxy para subida de archivos (tmpfiles.org). Resuelve CORS al descargar comprobantes." },
];

// ---- SUPABASE EDGE FUNCTIONS ----
const SUPABASE_FUNCTIONS = [
  { file: "supabase/functions/verify-payment/index.ts", desc: "Verifica pago con Pabilo de forma segura (API key en servidor, no expuesta al cliente)." },
  { file: "supabase/functions/verify-receipt/index.ts", desc: "Verificación de comprobante con IA (Gemini) desde el servidor." },
  { file: "supabase/functions/send-whatsapp/index.ts", desc: "Envío de WhatsApp desde el servidor (API key segura)." },
];

// ---- SECRETS ----
const SECRETS = [
  { key: "venium", setting: "SecretSetting", desc: "API key de Venium, URL del proxy, markup, tasa de conversión", env: "VENIUM_API_KEY (en Cloudflare Worker)" },
  { key: "pabilo", setting: "SecretSetting", desc: "API key de Pabilo, user_bank_id, movement_type, bank_origin", env: "PABILO_API_KEY (en Supabase Edge Function)" },
  { key: "mobentas", setting: "SecretSetting", desc: "Config de Mobentas: enabled, base URL, markup, tasa, proxy URL", env: "MOBENTAS_API_KEY (en Cloudflare Worker, si aplica)" },
  { key: "gemini", setting: "SecretSetting", desc: "API key de Google Gemini para visión de comprobantes", env: "GEMINI_API_KEY (en Supabase Edge Function o cliente)" },
  { key: "whatsapp", setting: "SecretSetting", desc: "Token de WhatsApp Business API, phone_number_id, admin_phone", env: "WHATSAPP_TOKEN (en Supabase Edge Function)" },
  { key: "telegram", setting: "SecretSetting", desc: "Bot token de Telegram, chat_id del canal de admin", env: "TELEGRAM_BOT_TOKEN (en cliente)" },
  { key: "tasa", setting: "SecretSetting o Setting", desc: "Tasa de cambio USD→Bs (manual o automática)", env: "—" },
];

// ---- ADMIN TABS ----
const ADMIN_TABS = [
  { name: "Dashboard/KPIs", desc: "Métricas: ventas, ingresos, pedidos pendientes, saldo Venium." },
  { name: "ProductManager", desc: "CRUD de juegos, gift cards y servicios. Editor de denominaciones/paquetes." },
  { name: "OrderManager", desc: "Gestión de pedidos: aprobar, completar manuales, reembolsar, vueltos." },
  { name: "VeniumTab", desc: "Sincronización de catálogo desde Venium, consulta de saldo, despacho manual." },
  { name: "BotFreeFireTab", desc: "Panel del bot de Free Fire (estado, configuración, recargas)." },
  { name: "EventsTab", desc: "Gestión de NightEvents (flash-sales nocturnos)." },
  { name: "DiscountCodesTab", desc: "Códigos de descuento (cupones)." },
  { name: "PrizeCodesTab", desc: "Códigos de canje (premios gratuitos)." },
  { name: "CreatorsTab", desc: "Aprobación/gestión de creadores, comisiones, pagos." },
  { name: "CommissionsTab", desc: "Registro de comisiones de creadores." },
  { name: "BlocklistTab", desc: "Lista de bloqueo anti-fraude." },
  { name: "SettingsPanel", desc: "Configuración general: pago móvil, carrusel, métodos de pago, tasas." },
  { name: "AnalyticsTab", desc: "Analíticas de ventas y tráfico." },
  { name: "CarouselEditor", desc: "Editor del carrusel del Home." },
  { name: "AIAssistant", desc: "Asistente IA del admin para CRUD via lenguaje natural." },
  { name: "WhatsAppSender", desc: "Envío manual de mensajes WhatsApp." },
  { name: "PaymentMethodsEditor", desc: "Editor de métodos de pago disponibles." },
];

// ---- PAYMENT FLOW ----
const PAYMENT_STEPS = [
  { step: 1, title: "Verificación de ID", desc: "Cliente ingresa su ID de jugador. Se verifica via Mobentas (o Venium). Se muestra el nickname. Se chequean niveles ya comprados (anti-duplicados) y pagos pendientes (deudas)." },
  { step: 2, title: "Selección de paquete", desc: "Cliente elige denominación. Precios en vivo desde Venium. Eventos nocturnos pisan el precio si hay stock. Paquetes agotados se ocultan. Se indica si el despacho es instantáneo (saldo wallet) o manual." },
  { step: 3, title: "Método de pago", desc: "Cliente elige: Pago Móvil, transferencia bancaria, Binance/USDT, Zinli, etc. Se muestran los datos bancarios del store." },
  { step: 4, title: "Subir comprobante", desc: "Cliente sube captura del pago + referencia bancaria + email + WhatsApp. Se comprime la imagen y se sube a tmpfiles.org." },
  { step: 5, title: "Verificación anti-fraude", desc: "1) Referencia duplicada en otro pedido → bloqueo. 2) IA (Gemini) revisa la captura → si NO es comprobante → alerta de fraude con IP+ubicación. 3) Blocklist (IP, player_id, email, whatsapp)." },
  { step: 6, title: "Verificación bancaria (Pabilo)", desc: "Verifica referencia + monto contra el banco. Reintenta si el banco no registra aún. Errores honestos (ref mal escrita, banco caído) NO disparan alerta de fraude." },
  { step: 7, title: "Despacho (Venium)", desc: "Si el paquete es instantáneo (saldo wallet suficiente): crea orden en Venium → recarga automática. Si es manual: queda pendiente para que el admin lo procese." },
  { step: 8, title: "Notificaciones", desc: "WhatsApp al cliente (pago verificado / recarga exitosa), Email de confirmación, Telegram al admin. Comisión al creador si aplica. Consumo de stock de NightEvent si aplica." },
];

export default function Documentacion() {
  const [active, setActive] = useState("overview");

  useEffect(() => {
    const onScroll = () => {
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120 && rect.bottom >= 120) { setActive(s.id); break; }
        }
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="sticky top-0 z-50 bg-card/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black">Documentación de Migración — Vex Store</h1>
            <p className="text-xs text-muted-foreground">Diseño original · Actualizado: {new Date().toLocaleDateString("es-VE")}</p>
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors">
            <Printer className="w-4 h-4" /> Guardar PDF
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0">
          <nav className="sticky top-24 space-y-1">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} onClick={() => scrollTo(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${active === s.id ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                  <Icon className="w-4 h-4 shrink-0" /> {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 max-w-4xl space-y-12">

          {/* OVERVIEW */}
          <section id="overview" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Resumen</h2>
            <div className="bg-card border border-border rounded-xl p-6 space-y-3 text-sm">
              <p><strong>Nombre:</strong> Vex Store</p>
              <p><strong>Tipo:</strong> Tienda digital de recargas gaming y gift cards</p>
              <p><strong>Mercado:</strong> Venezuela y LATAM</p>
              <p><strong>URL pública:</strong> https://vexstorevzla.com</p>
              <p><strong>Plataforma actual:</strong> Base44 (backend-as-a-service)</p>
              <p><strong>Estado:</strong> Publicada y operativa</p>
              <p className="text-muted-foreground pt-2 border-t border-border">
                <strong>Nota sobre el diseño:</strong> La tienda usa un solo tema (oscuro premium con violeta de marca) definido
                en <code className="bg-muted px-1 rounded">src/index.css</code>. El fondo es casi negro, las tarjetas un escalón
                más claras, el borde siempre visible, y los estados usan color con intención: verde = verificado/éxito,
                ámbar = atención (tiempo restante, saldo), rojo = error.
              </p>
            </div>
          </section>

          {/* STACK */}
          <section id="stack" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Stack Tecnológico</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { k: "Frontend", v: "React 18 + Vite" },
                { k: "Estilos", v: "Tailwind CSS + shadcn/ui (Radix)" },
                { k: "Routing", v: "React Router DOM v6" },
                { k: "Animaciones", v: "Framer Motion" },
                { k: "Data fetching", v: "@tanstack/react-query" },
                { k: "Backend", v: "Base44 SDK (entities, auth, integrations)" },
                { k: "Auth", v: "Base44 Auth (email/password, Google OAuth, OTP)" },
                { k: "Base de datos", v: "Base44 entities (MongoDB)" },
                { k: "Iconos", v: "lucide-react" },
                { k: "Gráficos", v: "Recharts" },
                { k: "Mapas", v: "react-leaflet" },
                { k: "3D", v: "three.js" },
                { k: "Drag & drop", v: "@hello-pangea/dnd" },
                { k: "Forms", v: "react-hook-form + zod" },
                { k: "Markdown", v: "react-markdown" },
                { k: "Fechas", v: "date-fns, moment" },
                { k: "PWA", v: "Service worker + manifest.json" },
                { k: "Edge Functions", v: "Supabase (Deno)" },
                { k: "Proxies", v: "Cloudflare Workers" },
              ].map((t) => (
                <div key={t.k} className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{t.k}</p>
                  <p className="text-sm font-bold">{t.v}</p>
                </div>
              ))}
            </div>
          </section>

          {/* DESIGN SYSTEM */}
          <section id="design" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Sistema de Diseño (Original)</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Tokens definidos en <code className="bg-muted px-1 rounded">src/index.css</code> bajo <code className="bg-muted px-1 rounded">:root</code>.
              Mapeados a Tailwind en <code className="bg-muted px-1 rounded">tailwind.config.js</code>.
            </p>
            <h3 className="text-lg font-bold mb-3">Colores</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Token</th>
                    <th className="text-left p-2">Valor HSL</th>
                    <th className="text-left p-2">Hex</th>
                    <th className="text-left p-2">Muestra</th>
                    <th className="text-left p-2">Uso</th>
                  </tr>
                </thead>
                <tbody>
                  {DESIGN_TOKENS.map((t) => (
                    <tr key={t.token} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{t.token}</td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">{t.value}</td>
                      <td className="p-2 font-mono text-xs">{t.hex}</td>
                      <td className="p-2"><div className="w-8 h-8 rounded border border-border" style={{ background: t.hex }} /></td>
                      <td className="p-2 text-xs">{t.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="text-lg font-bold mb-3 mt-6">Tipografía</h3>
            <div className="space-y-2">
              {FONTS.map((f) => (
                <div key={f.role} className="bg-card border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{f.role}</p>
                  <p className="text-sm font-bold font-mono">{f.family}</p>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mt-4">
              <p className="text-sm text-primary font-bold">Utilidades compartidas del tema</p>
              <p className="text-xs text-muted-foreground mt-1">
                <code className="bg-muted px-1 rounded">.glass</code> (cabeceras y hojas flotantes), <code className="bg-muted px-1 rounded">.glow-primary</code> (resalte de marca),
                <code className="bg-muted px-1 rounded">.surface</code> (tarjeta base), <code className="bg-muted px-1 rounded">.tap</code> (respuesta al toque) y
                <code className="bg-muted px-1 rounded">.num</code> (cifras tabulares para montos).
              </p>
            </div>
          </section>

          {/* STRUCTURE */}
          <section id="structure" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Estructura de Archivos</h2>
            <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
              <pre className="text-xs font-mono text-muted-foreground leading-relaxed">{`legacy-store/
├── index.html              # HTML root, meta tags, fonts
├── package.json            # Dependencias npm
├── tailwind.config.js      # Config Tailwind + tokens
├── vite.config.js          # Config Vite
├── public/
│   ├── manifest.json       # PWA manifest
│   └── sw.js               # Service worker
├── src/
│   ├── main.jsx            # Entry point
│   ├── App.jsx             # Router + auth wrapper
│   ├── index.css           # Tokens CSS + estilos globales
│   ├── api/
│   │   └── base44Client.js # SDK Base44 inicializado
│   ├── lib/                # Lógica compartida (clientes API)
│   │   ├── AuthContext.jsx
│   │   ├── veniumClient.js
│   │   ├── pabiloClient.js
│   │   ├── mobentasClient.js
│   │   ├── geminiClient.js
│   │   ├── whatsappClient.js
│   │   ├── telegramClient.js
│   │   ├── emailClient.js
│   │   ├── tasaClient.js
│   │   ├── discountClient.js
│   │   ├── blocklistClient.js
│   │   ├── nightEventClient.js
│   │   ├── creatorCommission.js
│   │   ├── paymentMethods.js
│   │   ├── ipDetect.js
│   │   ├── pendingPayments.js
│   │   ├── receiptUploadClient.js
│   │   ├── redemptionGuide.js
│   │   └── supabaseClient.js
│   ├── data/
│   │   └── purchaseConfig.js  # Config de productos (fallback)
│   ├── pages/               # Páginas de la app
│   │   ├── Home.jsx
│   │   ├── Games.jsx
│   │   ├── GiftCards.jsx
│   │   ├── Servicios.jsx
│   │   ├── Comprar.jsx       # Flujo de compra
│   │   ├── CompletarPago.jsx
│   │   ├── Canjear.jsx
│   │   ├── Creadores.jsx
│   │   ├── MisPedidos.jsx
│   │   ├── Perfil.jsx
│   │   ├── Admin.jsx
│   │   ├── FreeFirePanel.jsx
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   ├── ForgotPassword.jsx
│   │   └── ResetPassword.jsx
│   ├── components/
│   │   ├── Layout.jsx        # Header + Footer + Outlet
│   │   ├── Header.jsx
│   │   ├── Footer.jsx
│   │   ├── ProtectedRoute.jsx
│   │   ├── ProductImage.jsx
│   │   ├── CatalogGrid.jsx
│   │   ├── SearchModal.jsx
│   │   ├── ScrollToTop.jsx
│   │   ├── InstallAppButton.jsx
│   │   ├── CommunityPopup.jsx
│   │   ├── RecentOrdersTicker.jsx
│   │   ├── PendingPaymentsNav.jsx
│   │   ├── SupportWhatsapp.jsx
│   │   ├── TutorialVideo.jsx
│   │   ├── GoogleIcon.jsx
│   │   ├── purchase/         # Componentes del flujo de compra
│   │   ├── admin/            # Pestañas del panel admin
│   │   ├── home/             # Secciones del Home
│   │   ├── creators/         # Panel de creadores
│   │   ├── freefire/         # Panel del bot FF
│   │   └── ui/               # shadcn/ui primitives
│   ├── hooks/
│   │   ├── use-mobile.jsx
│   │   └── use-size.jsx
│   ├── proxy/               # Cloudflare Workers (código fuente)
│   │   ├── venium-proxy.worker.js
│   │   ├── mobentas-proxy.worker.js
│   │   ├── nexus-proxy.worker.js
│   │   └── uploads-proxy.worker.js
│   └── utils/
│       └── index.ts
├── base44/
│   ├── config.jsonc
│   └── entities/            # Schemas JSON de entidades
│       ├── User.jsonc
│       ├── Game.jsonc
│       ├── GiftCard.jsonc
│       ├── Service.jsonc
│       ├── Order.jsonc
│       ├── Setting.jsonc
│       ├── SecretSetting.jsonc
│       ├── RechargeRecord.jsonc
│       ├── Creator.jsonc
│       ├── CreatorVideo.jsonc
│       ├── PrizeCode.jsonc
│       ├── SupportTicket.jsonc
│       ├── BotAuditLog.jsonc
│       ├── Blocklist.jsonc
│       └── NightEvent.jsonc
└── supabase/
    └── functions/
        ├── verify-payment/index.ts
        ├── verify-receipt/index.ts
        └── send-whatsapp/index.ts`}</pre>
            </div>
          </section>

          {/* ENTITIES */}
          <section id="entities" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Base de Datos (Entities)</h2>
            <p className="text-sm text-muted-foreground mb-4">
              16 entidades (15 custom + User built-in). Schemas en <code className="bg-muted px-1 rounded">base44/entities/</code>.
              Cada registro incluye campos built-in: <code className="bg-muted px-1 rounded">id</code>, <code className="bg-muted px-1 rounded">created_date</code>, <code className="bg-muted px-1 rounded">updated_date</code>, <code className="bg-muted px-1 rounded">created_by_id</code>.
            </p>
            <div className="space-y-3">
              {ENTITIES.map((e) => (
                <div key={e.name} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Database className="w-4 h-4 text-primary" />
                    <h3 className="font-bold text-primary">{e.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{e.desc}</p>
                  <p className="text-xs"><strong className="text-foreground">RLS:</strong> {e.rls}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ROUTES */}
          <section id="routes" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Páginas y Rutas</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Ruta</th>
                    <th className="text-left p-2">Página</th>
                    <th className="text-left p-2">Descripción</th>
                    <th className="text-left p-2">Auth</th>
                  </tr>
                </thead>
                <tbody>
                  {ROUTES.map((r) => (
                    <tr key={r.path} className="border-t border-border">
                      <td className="p-2 font-mono text-xs text-primary">{r.path}</td>
                      <td className="p-2 font-bold">{r.page}</td>
                      <td className="p-2 text-xs text-muted-foreground">{r.desc}</td>
                      <td className="p-2 text-xs">{r.auth ? <span className="text-amber-400 font-bold">Sí</span> : <span className="text-green-400">No</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* INTEGRATIONS */}
          <section id="integrations" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Integraciones Externas</h2>
            <div className="space-y-3">
              {INTEGRATIONS.map((i) => (
                <div key={i.name} className="bg-card border border-border rounded-lg p-4">
                  <h3 className="font-bold text-primary mb-1">{i.name}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{i.desc}</p>
                  <p className="text-xs"><strong className="text-foreground">Config:</strong> <code className="bg-muted px-1 rounded">{i.config}</code></p>
                </div>
              ))}
            </div>
          </section>

          {/* WORKERS */}
          <section id="workers" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Cloudflare Workers</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Proxies que ocultan API keys y resuelven CORS. Desplegar en Cloudflare Workers (free tier).
            </p>
            <div className="space-y-2">
              {WORKERS.map((w) => (
                <div key={w.file} className="bg-card border border-border rounded-lg p-3">
                  <p className="font-mono text-xs text-primary font-bold">{w.file}</p>
                  <p className="text-sm text-muted-foreground mt-1">{w.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* SUPABASE */}
          <section id="supabase" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Supabase Edge Functions</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Funciones serverless (Deno) que ejecutan lógica sensible en el servidor.
            </p>
            <div className="space-y-2">
              {SUPABASE_FUNCTIONS.map((f) => (
                <div key={f.file} className="bg-card border border-border rounded-lg p-3">
                  <p className="font-mono text-xs text-primary font-bold">{f.file}</p>
                  <p className="text-sm text-muted-foreground mt-1">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* SECRETS */}
          <section id="secrets" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Variables y Secretos</h2>
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-destructive font-bold">⚠ IMPORTANTE</p>
              <p className="text-xs text-destructive/80 mt-1">
                Las API keys NO están hardcodeadas en el cliente. Se guardan en SecretSetting (Base44) o en variables de entorno de Cloudflare Workers / Supabase. Al migrar, hay que reconfigurar todas estas keys en el nuevo hosting.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Key</th>
                    <th className="text-left p-2">Dónde se guarda</th>
                    <th className="text-left p-2">Descripción</th>
                    <th className="text-left p-2">Env var equivalente</th>
                  </tr>
                </thead>
                <tbody>
                  {SECRETS.map((s) => (
                    <tr key={s.key} className="border-t border-border">
                      <td className="p-2 font-mono text-xs text-primary">{s.key}</td>
                      <td className="p-2 text-xs">{s.setting}</td>
                      <td className="p-2 text-xs text-muted-foreground">{s.desc}</td>
                      <td className="p-2 font-mono text-xs">{s.env}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* PAYMENT FLOW */}
          <section id="payment" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Flujo de Compra</h2>
            <div className="space-y-3">
              {PAYMENT_STEPS.map((s) => (
                <div key={s.step} className="bg-card border border-border rounded-lg p-4 flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center shrink-0">{s.step}</div>
                  <div>
                    <h3 className="font-bold">{s.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ADMIN */}
          <section id="admin" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Panel Admin</h2>
            <p className="text-sm text-muted-foreground mb-4">Ruta: <code className="bg-muted px-1 rounded">/admin</code> · Protegido (role=admin) · 17 pestañas.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {ADMIN_TABS.map((t) => (
                <div key={t.name} className="bg-card border border-border rounded-lg p-3">
                  <p className="font-bold text-sm text-primary">{t.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CREATORS */}
          <section id="creators" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Programa de Creadores</h2>
            <div className="bg-card border border-border rounded-xl p-5 space-y-3 text-sm">
              <p><strong>Registro:</strong> Los creadores se registran en <code className="bg-muted px-1 rounded">/creadores</code> con nombre, email, WhatsApp y handle de TikTok.</p>
              <p><strong>Aprobación:</strong> El admin aprueba desde el panel. Al aprobar, se genera un código único y un PIN de acceso al panel.</p>
              <p><strong>Panel:</strong> El creador accede con su email + PIN. Ve sus comisiones, código de descuento, solicitudes de retiro.</p>
              <p><strong>Comisiones:</strong> Cuando un cliente usa el código del creador, se registra una comisión (porcentaje configurable) sobre la venta.</p>
              <p><strong>Videos TikTok:</strong> Los creadores envían videos de TikTok promocionando el store. Se validan las vistas y se asignan recompensas por tier (inicial, intermedio, pro).</p>
              <p><strong>Retiros:</strong> El creador solicita retiros de su balance. El admin aprueba/rechaza desde el panel.</p>
              <p><strong>Entidades:</strong> Creator, CreatorVideo. Lógica en <code className="bg-muted px-1 rounded">creatorCommission.js</code>, <code className="bg-muted px-1 rounded">creatorRewards.js</code>.</p>
            </div>
          </section>

          {/* FRAUD */}
          <section id="fraud" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Sistema Anti-Fraude</h2>
            <div className="bg-card border border-border rounded-xl p-5 space-y-3 text-sm">
              <p><strong>1. Blocklist:</strong> Lista de bloqueo por player_id, IP, email o WhatsApp. Si el cliente coincide, se le muestra una pantalla de bloqueo.</p>
              <p><strong>2. Referencia duplicada:</strong> Al reportar un pago, se busca si la referencia bancaria ya fue usada en otro pedido. Si sí, se bloquea.</p>
              <p><strong>3. Visión IA (Gemini):</strong> La captura del comprobante se envía a Gemini para verificar que sea un comprobante de pago real (no un meme o foto irrelevante). Si la IA confirma que NO es comprobante, se dispara alerta de fraude al admin con IP + ubicación del cliente.</p>
              <p><strong>4. Detección de IP:</strong> Se obtiene la IP del cliente al inicio del flujo. Si hay fraude, se muestra la IP + ciudad + región + país al cliente como advertencia.</p>
              <p><strong>5. Niveles duplicados:</strong> Se chequea si el jugador ya compró un nivel específico (RechargeRecord). Si sí, se bloquea la compra de ese nivel.</p>
              <p><strong>6. Pago parcial:</strong> Si el monto pagado es menor al total, se registra como deuda (partial_payment). El cliente debe completar el saldo antes de hacer nuevas compras.</p>
              <p><strong>Errores honestos NO disparan alerta:</strong> Referencia mal escrita, banco caído, monto mal cubierto — solo muestran error friendly al cliente.</p>
            </div>
          </section>

          {/* MIGRATION */}
          <section id="migration" className="scroll-mt-24">
            <h2 className="text-2xl font-black mb-4">Notas de Migración</h2>
            <div className="bg-card border border-border rounded-xl p-5 space-y-4 text-sm">
              <div>
                <h3 className="font-bold text-primary mb-2">Qué migrar</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Todo el código fuente (src/, base44/, supabase/, public/)</li>
                  <li>Schemas de entidades (base44/entities/*.jsonc) → nueva base de datos</li>
                  <li>Cloudflare Workers (src/proxy/*.worker.js) → desplegar en Cloudflare</li>
                  <li>Supabase Edge Functions (supabase/functions/) → desplegar en Supabase</li>
                  <li>Variables de entorno / API keys (ver tabla de Secretos)</li>
                  <li>Configuración de PWA (manifest.json, sw.js)</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-2">Sistema de diseño</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Tokens en <code className="bg-muted px-1 rounded">src/index.css</code> (--background, --card, --border, --primary, --radius)</li>
                  <li>Utilidades: <code className="bg-muted px-1 rounded">.glass</code>, <code className="bg-muted px-1 rounded">.surface</code>, <code className="bg-muted px-1 rounded">.glow-primary</code>, <code className="bg-muted px-1 rounded">.tap</code>, <code className="bg-muted px-1 rounded">.num</code></li>
                  <li>Verificador de pagos: anillo + escudo en <code className="bg-muted px-1 rounded">ProcessingSticker.jsx</code></li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-2">Dependencias críticas (package.json)</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li><code className="bg-muted px-1 rounded">@base44/sdk</code> — Si se migra fuera de Base44, reemplazar por el SDK del nuevo backend o API propia</li>
                  <li><code className="bg-muted px-1 rounded">react</code>, <code className="bg-muted px-1 rounded">react-dom</code> 18</li>
                  <li><code className="bg-muted px-1 rounded">react-router-dom</code> 6</li>
                  <li><code className="bg-muted px-1 rounded">tailwindcss</code> + <code className="bg-muted px-1 rounded">tailwindcss-animate</code></li>
                  <li><code className="bg-muted px-1 rounded">framer-motion</code></li>
                  <li><code className="bg-muted px-1 rounded">@tanstack/react-query</code></li>
                  <li>Todos los <code className="bg-muted px-1 rounded">@radix-ui/*</code> (shadcn/ui)</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-primary mb-2">Consideraciones</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>La auth la maneja Base44. Al migrar, implementar auth propia (JWT, sesiones) o usar el proveedor del nuevo hosting.</li>
                  <li>Las entities de Base44 son MongoDB. Si el nuevo hosting usa SQL, hay que convertir los schemas y migrar los datos.</li>
                  <li>El SDK <code className="bg-muted px-1 rounded">base44.entities.*</code> está en todo el código. Hay que reemplazarlo por el ORM/cliente del nuevo backend.</li>
                  <li>Las integraciones Core (InvokeLLM, SendEmail, UploadPublicFile) son de Base44. Reemplazar por servicios propios.</li>
                  <li>El PWA (service worker, manifest) funciona independiente del backend.</li>
                </ul>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Print footer */}
      <div className="hidden print:block mt-12 pt-4 border-t border-border text-center text-xs text-muted-foreground">
        <p>Vex Store — Documentación de Migración · Generada el {new Date().toLocaleDateString("es-VE")}</p>
      </div>
    </div>
  );
}