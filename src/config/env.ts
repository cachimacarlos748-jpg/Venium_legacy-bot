import "dotenv/config";
import { z } from "zod";

const inputEnv = {
  ...process.env,
  PABILO_MODE: process.env.PABILO_MODE ?? process.env.PABLO_MODE,
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().default(""),
  VENIUM_MODE: z.enum(["mock", "live", "dev"]).default("mock").transform((mode) => mode === "dev" ? "mock" : mode),
  VENIUM_BASE_URL: z.string().url().default("https://veniumstore.com"),
  VENIUM_API_KEY: z.string().default(""),
  ALLOW_LIVE_ORDER_CREATION: z.string().default("false").transform((value) => value === "true"),
  PABILO_MODE: z.enum(["mock", "live", "dev"]).default("mock").transform((mode) => mode === "dev" ? "mock" : mode),
  PABILO_BASE_URL: z.string().url().default("https://api.pabilo.app"),
  PABILO_API_KEY: z.string().default(""),
  PABILO_USER_BANK_ID: z.string().default(""),
  PABILO_MOVEMENT_TYPE: z.string().default("GENERIC"),
  // Interruptor de emergencia: "false" apaga Pabilo aunque el despliegue tenga
  // credenciales puestas, sin tener que borrarlas. Vacio = automatico (manda lo
  // que diga el interruptor del panel o, si no hay, lo que declare el entorno).
  PABILO_ENABLED: z.string().default(""),
  // Verificación de pago móvil directamente contra BDVenlínea (alternativa
  // propia a Pabilo). BDV_MODE=mock no toca el banco.
  BDV_MODE: z.enum(["mock", "live"]).default("mock"),
  // Interruptor MAESTRO del verificador BDV. Apagado por defecto a proposito:
  // la tienda verifica con Pabilo y el portal del banco bloquea la cuenta
  // cuando se le insiste (el espejo releia la tabla cada 2-3 minutos). Con esto
  // apagado no hay Chrome, ni cron, ni sesiones abiertas, aunque el codigo siga
  // ahi. BDV_ENABLED=true lo vuelve a encender sin tocar nada mas.
  BDV_ENABLED: z.string().default("false"),
  // Qué proveedor verifica los pagos. "pabilo" = servicio de terceros con
  // créditos; "bdv" = verificacion propia contra el banco, sin costo por uso.
  PAYMENT_PROVIDER: z.enum(["pabilo", "bdv"]).default("pabilo"),
  // Secreto compartido entre el bot y el proxy de Cloudflare que verifica los
  // pagos de la web contra BDVenlínea. Sin esta variable el endpoint de la web
  // queda cerrado (nunca abierto "por si acaso").
  BDV_VERIFY_KEY: z.string().default(""),

  // Origen autorizado para CORS (por defecto, la web de produccion).
  BDV_WEB_ORIGIN: z.string().default("https://vexstorevzla.com"),
  // Experimental: abre la tabla tocando el icono de la home en vez de pasar
  // por el menu. Inestable todavia, por eso va apagado.
  BDV_FAST_ICON: z.coerce.boolean().default(false),
  BDV_BASE_URL: z.string().url().default("https://bdvenlinea.banvenez.com"),
  BDV_USER: z.string().default(""),
  BDV_PASSWORD: z.string().default(""),
  // Sesion caliente de BDVenlinea: cuando estan estas cuatro variables el
  // verificador lee los movimientos por la API JSON del portal en vez de
  // raspar la tabla con el navegador. Es mucho mas rapido y no depende de que
  // el banco no cambie una palabra de la cabecera.
  //
  // El login NO se automatiza a proposito: es multi-paso, depende de una huella
  // de dispositivo y el banco bloquea la cuenta tras pocos intentos. El
  // titular inicia sesion UNA vez en su navegador y copia aqui el resultado.
  // Si faltan, el verificador sigue con el navegador como estaba.
  BDV_SESSION_ACCOUNT: z.string().default(""),
  BDV_SESSION_ACCESS_TOKEN: z.string().default(""),
  BDV_SESSION_REFRESH_TOKEN: z.string().default(""),
  // Huella de dispositivo que el portal manda en la cabecera "Rip".
  BDV_SESSION_RIP: z.string().default(""),
  // Cookie XSRF-TOKEN de la sesion capturada (a veces el banco la exige).
  BDV_SESSION_XSRF: z.string().default(""),
  BDV_SESSION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  // Tras un login fallido (clave rechazada, portal que no responde, "sesion
  // activa") no se vuelve a intentar durante este tiempo. El banco bloquea la
  // cuenta tras pocos fallos seguidos y desbloquearla es un tramite manual del
  // titular: mas vale esperar unos minutos que quedarse sin banco por insistir.
  BDV_LOGIN_COOLDOWN_MS: z.coerce.number().int().min(0).max(86_400_000).default(600_000),
  // Cuanto tiempo se considera vigente la ultima lectura de movimientos.
  // Cada consulta al banco cuesta 15-40 s, asi que dos verificaciones seguidas
  // no necesitan dos viajes. El banco sigue siendo la unica fuente de verdad:
  // esto solo evita releer una tabla identica (ver modules/bdv/bdv-cache.ts).
  BDV_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(45_000),
  // Espera maxima en la cola del banco antes de responder "ocupado". Evita que
  // el cliente quede colgado si otra verificacion se atasca.
  BDV_MAX_QUEUE_WAIT_MS: z.coerce.number().int().min(0).max(180_000).default(60_000),
  // Espejo local: cada BDV_MIRROR_INTERVAL_MS el cron relee la tabla del banco
  // y guarda las ultimas operaciones en SQLite, para que la verificacion
  // responda en milisegundos sin viajar al banco. 0 desactiva el cron.
  BDV_MIRROR_INTERVAL_MS: z.coerce.number().int().min(0).max(900_000).default(150_000),
  // Ventana para CREER que una operacion sigue en el espejo. Los negativos
  // (la referencia no aparece) usan la ventana corta: decir "no encontrado"
  // con datos viejos es el error caro, porque el cliente ya pagó.
  BDV_MIRROR_POSITIVE_TTL_MS: z.coerce.number().int().min(0).max(900_000).default(150_000),
  // Cuanto se guarda una operacion en el espejo antes de podarse (30 dias).
  BDV_MIRROR_MAX_AGE_MS: z.coerce.number().int().min(0).default(2_592_000_000),
  // Volcado de respuestas del banco para afinar el parser. Nunca en produccion.
  BDV_DEBUG: z.string().default("false").transform((value) => value === "true"),
  GEMINI_MODE: z.enum(["disabled", "mock", "live"]).default("disabled"),
  // Comma-separated list of Gemini API keys. Keys are rotated automatically:
  // if one fails (quota, 503 "high demand", invalid key), the next one is
  // tried transparently.
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  // Extra models tried (in order) when GEMINI_MODEL returns 429/503/quota or
  // a network failure. Set GEMINI_FALLBACK_MODELS="" to disable the chain.
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.5-flash-lite,gemini-3.8-flash"),
  WHATSAPP_MODE: z.enum(["disabled", "mock", "live"]).default("disabled"),
  // Transport: "web" = whatsapp-web.js (unofficial, QR), "cloud" = Meta
  // WhatsApp Cloud API (official, webhook-based, no browser).
  WHATSAPP_PROVIDER: z.enum(["web", "cloud"]).default("web"),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_CLOUD_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_CLOUD_API_VERSION: z.string().default("v21.0"),
  META_APP_SECRET: z.string().default(""),
  WHATSAPP_PAIRING_MODE: z.enum(["phone", "qr"]).default("phone"),
  WHATSAPP_AUTH_DIR: z.string().default("./data/whatsapp-auth"),
  WHATSAPP_PAIRING_PHONE: z.string().regex(/^\d{8,15}$/).default("584222896623"),
  WHATSAPP_ALLOW_GROUPS: z.string().default("false").transform((value) => value === "true"),
  WHATSAPP_RECONNECT_DELAY_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  VENIUM_WEBHOOK_SECRET: z.string().default(""),
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  // Web Push (VAPID) for admin phone notifications. Without these the panel
  // still works; it just cannot wake the phone with a push message.
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:admin@vexstore.app"),
});

export const env = envSchema.parse(inputEnv);

export function providerStatus(mode: string, key: string): "mock" | "live" | "disabled" | "missing-secret" {
  if (mode === "disabled") return "disabled";
  if (mode === "live" && !key) return "missing-secret";
  return mode as "mock" | "live";
}