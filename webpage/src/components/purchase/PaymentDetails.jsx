import { getMethodFields } from "@/lib/paymentMethods";
import PaymentDataCard from "@/components/purchase/PaymentDataCard";

// Muestra los datos de cuenta del método seleccionado (campos fijos por tipo).
export default function PaymentDetails({ method, fallback, total = null, currency = "Bs" }) {
  const fields = getMethodFields(method);

  const isPagoMovil =
    method?.id === "pago-movil" ||
    method?.type === "pago_movil" ||
    /pago\s*m[oó]vil/i.test(method?.name || "");
  const isBinance =
    method?.id === "binance" ||
    method?.type === "binance" ||
    /binance/i.test(method?.name || "");
  const showQR = isPagoMovil || isBinance;

  // Orden pensado para copiar de arriba hacia abajo: banco, teléfono, cédula, titular.
  const order = { banco: 0, telefono: 1, cedula: 2, titular: 3 };
  let rows = fields.map((f) => ({ k: f.label, v: f.value }));
  if (!rows.length && isPagoMovil && fallback) {
    rows = [
      { k: "Banco", v: fallback.banco },
      { k: "Teléfono", v: fallback.telefono },
      { k: "Cédula / RIF", v: fallback.cedula },
      { k: "Nombre / Titular", v: fallback.titular },
    ].filter((r) => r.v);
  }
  rows = rows
    .slice()
    .sort((a, b) => (order[String(a.k).toLowerCase()] ?? 9) - (order[String(b.k).toLowerCase()] ?? 9));

  return (
    <div className="mt-3">
      <PaymentDataCard
        methodName={method?.name || "Pago Móvil"}
        rows={rows}
        qrUrl={showQR ? (method?.qr_url || fallback?.qr_url || "") : ""}
        total={total}
        currency={currency}
      />
    </div>
  );
}
