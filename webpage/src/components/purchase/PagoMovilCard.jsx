import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import PaymentDataCard from "@/components/purchase/PaymentDataCard";

// Datos del Pago Móvil (banco, titular, cédula, teléfono y QR) cargados desde
// el Setting del admin. Se muestra en la página de completar pago para que el
// cliente pueda copiarlos aunque haya cerrado la ventana original de compra.
export default function PagoMovilCard({ total = null }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    base44.entities.Setting.filter({ key: "pago_movil" })
      .then((r) => { if (r?.[0]?.value) { try { setData(JSON.parse(r[0].value)); } catch {} } })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const rows = [
    { k: "Banco", v: data.banco },
    { k: "Teléfono", v: data.telefono },
    { k: "Cédula / RIF", v: data.cedula },
    { k: "Nombre / Titular", v: data.titular },
  ].filter((r) => r.v);

  return <PaymentDataCard methodName="Pago Móvil" rows={rows} qrUrl={data.qr_url || ""} total={total} />;
}
