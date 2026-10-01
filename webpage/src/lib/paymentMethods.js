import { base44 } from "@/api/base44Client";

// Catálogo de tipos de pago con sus CAMPOS FIJOS.
// El admin, en cada método, elige un tipo y llena los campos. Esos datos
// llegan al cliente en el flujo de compra (PaymentDetails) y se muestran
// automáticamente al seleccionar el método.
export const PAYMENT_TYPES = {
  pago_movil: {
    label: "Pago Móvil",
    qr: true,
    fields: [
      { key: "banco", label: "Banco" },
      { key: "titular", label: "Titular" },
      { key: "cedula", label: "Cédula" },
      { key: "telefono", label: "Teléfono" },
      { key: "concepto", label: "Concepto / Referencia sugerida" },
    ],
  },
  zelle: {
    label: "Zelle",
    fields: [
      { key: "email", label: "Email" },
      { key: "nombre", label: "Nombre del titular" },
    ],
  },
  binance: {
    label: "Binance Pay",
    qr: true,
    fields: [
      { key: "wallet", label: "Binance ID / Wallet" },
      { key: "red", label: "Red (TRC20, BEP20...)" },
    ],
  },
  paypal: {
    label: "PayPal",
    fields: [
      { key: "link", label: "Link o email de PayPal" },
    ],
  },
  transferencia: {
    label: "Transferencia Bancaria",
    fields: [
      { key: "banco", label: "Banco" },
      { key: "titular", label: "Titular" },
      { key: "cuenta", label: "N° de cuenta" },
      { key: "tipo", label: "Tipo (corriente/ahorro)" },
    ],
  },
  otro: {
    label: "Otro",
    fields: [
      { key: "dato1", label: "Dato 1" },
      { key: "dato2", label: "Dato 2" },
    ],
  },
};

export const DEFAULT_PAYMENT_METHODS = [
  { id: "pago-movil", type: "pago_movil", name: "Pago Móvil", desc: "Transferencia bancaria VE", icon: "🏦", image_url: "", fields: {} },
  { id: "zelle", type: "zelle", name: "Zelle", desc: "Pago instantáneo en USD", icon: "⚡", image_url: "", fields: {} },
  { id: "binance", type: "binance", name: "Binance Pay", desc: "Cripto USDT", icon: "🪙", image_url: "", fields: {} },
  { id: "paypal", type: "paypal", name: "PayPal", desc: "Tarjeta o saldo", icon: "💳", image_url: "", fields: {} },
];

export async function getPaymentMethods() {
  try {
    const recs = await base44.entities.Setting.filter({ key: "payment_methods" });
    const v = recs?.[0]?.value;
    if (v) {
      const arr = JSON.parse(v);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {}
  return DEFAULT_PAYMENT_METHODS;
}

// Devuelve los datos visibles del método, fusionando fields configurados.
export function getMethodFields(m) {
  if (!m) return [];
  const t = PAYMENT_TYPES[m.type];
  if (!t) return [];
  return t.fields.map((f) => ({ ...f, value: m.fields?.[f.key] || "" })).filter((f) => f.value);
}