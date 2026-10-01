import { base44 } from "@/api/base44Client";

// Cliente para la API de "Dar Vuelto" de Pabilo.
// Envía un Pago Móvil automático al cliente para devolver el sobrante cuando paga de más.
// Doc: https://pabilo.app/docs/transaction-change
// Endpoint: POST /v1/user-bank-accounts/{account_id}/transaction-change
// Auth: Authorization: Bearer TU_API_KEY (nota: Bearer, no appKey)

async function getPabiloConfig() {
  try {
    const recs = await base44.entities.Setting.filter({ key: "pabilo" });
    const p = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
    return {
      api_key: (p.api_key || p.appKey || "").trim(),
      user_bank_id: (p.user_bank_id || p.userBankId || p.account_id || "").trim(),
    };
  } catch {
    return { api_key: "", user_bank_id: "" };
  }
}

// Códigos de banco más comunes en Venezuela para el dropdown.
export const VENEZUELAN_BANKS = [
  { code: "0102", name: "Banco de Venezuela" },
  { code: "0104", name: "Venezolano de Crédito" },
  { code: "0105", name: "Banco Mercantil" },
  { code: "0108", name: "Banco Provincial (BBVA)" },
  { code: "0114", name: "Bancaribe" },
  { code: "0115", name: "Banco Exterior" },
  { code: "0128", name: "Banco Caroní" },
  { code: "0134", name: "Banesco" },
  { code: "0138", name: "Banco Plaza" },
  { code: "0146", name: "Banco de la Gente" },
  { code: "0151", name: "BFC Banco Fondo Común" },
  { code: "0156", name: "Banco Activo" },
  { code: "0157", name: "Banco del Tesoro" },
  { code: "0163", name: "Banco del Caribe" },
  { code: "0166", name: "Banco Agrícola" },
  { code: "0168", name: "Banco Crecepyme" },
  { code: "0172", name: "Bancamiga" },
  { code: "0175", name: "Banco de Exportación y Comercio" },
  { code: "0191", name: "Banco Nacional de Crédito (BNC)" },
];

// Envía un vuelto (devolución de sobrante) vía Pago Móvil usando Pabilo.
// Devuelve { ok: true, reference, authorization_code, status } o { ok: false, error }
export async function sendVuelto({ amount, dniCode, dniNumber, phonePagador, destinationBankCode, invoiceNumber }) {
  const { api_key, user_bank_id } = await getPabiloConfig();

  if (!api_key) return { ok: false, error: "Falta la API key de Pabilo. Configúrala en el panel de admin." };
  if (!user_bank_id) return { ok: false, error: "Falta el ID de cuenta bancaria (user_bank_id) de Pabilo." };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "El monto debe ser mayor a 0." };
  if (!dniCode || !dniNumber) return { ok: false, error: "Falta la cédula del cliente." };
  if (!phonePagador) return { ok: false, error: "Falta el teléfono del cliente." };
  if (!destinationBankCode) return { ok: false, error: "Falta el banco de destino del cliente." };
  if (!invoiceNumber) return { ok: false, error: "Falta el número de factura." };

  try {
    const res = await fetch(`https://api.pabilo.app/v1/user-bank-accounts/${user_bank_id}/transaction-change`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${api_key}`,
      },
      body: JSON.stringify({
        dni: { code: dniCode, number: String(dniNumber).replace(/\D/g, "") },
        phone_pagador: String(phonePagador).replace(/\D/g, ""),
        amount: +amt.toFixed(2),
        invoice_number: String(invoiceNumber),
        destination_bank_code: String(destinationBankCode),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = data?.error || data?.message || `HTTP ${res.status}`;
      return { ok: false, error: errMsg, status: res.status, raw: data };
    }

    const tx = data?.data?.transaction_changes || {};
    return {
      ok: true,
      reference: tx.reference || "",
      authorization_code: tx.authorization_code || "",
      status: tx.status || "APPROVED",
    };
  } catch (e) {
    return { ok: false, error: "No se pudo conectar con Pabilo. Revisa tu conexión e inténtalo de nuevo." };
  }
}