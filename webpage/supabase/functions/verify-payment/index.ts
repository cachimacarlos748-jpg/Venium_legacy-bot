// Edge Function de Supabase: verificación de pagos con Pabilo.
// Las API keys viven aquí (como env vars del proyecto), no en el navegador.
//
// Deploy: supabase functions deploy verify-payment --no-verify-jwt
// Env vars: PABILO_API_KEY, PABILO_BANK_ID (configurar en Supabase Dashboard > Secrets)
//
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PABILO_API_KEY_ENV = Deno.env.get("PABILO_API_KEY") ?? "";
const PABILO_BANK_ID_ENV = Deno.env.get("PABILO_BANK_ID") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { reference, amount, movement_type, bank_origin, api_key, user_bank_id } = await req.json();
    const PABILO_API_KEY = api_key || PABILO_API_KEY_ENV;
    const PABILO_BANK_ID = user_bank_id || PABILO_BANK_ID_ENV;

    // Payload según docs reales de Pabilo: JSON con bank_reference + amount.
    // movement_type solo para Mercantil (MOVIL_PAY | TRANSFER).
    // bank_origin solo para cuentas de empresa.
    const payload: Record<string, unknown> = {
      bank_reference: String(reference),
      amount: Number(amount),
    };
    if (movement_type) payload.movement_type = movement_type;
    if (bank_origin) payload.bank_origin = bank_origin;

    const res = await fetch(
      `https://api.pabilo.app/userbankpayment/${PABILO_BANK_ID}/betaserio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          appKey: PABILO_API_KEY,
        },
        body: JSON.stringify(payload),
      }
    );

    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    // Siempre devolvemos 200 con el status de Pabilo embebido, para que el
    // cliente pueda parsear errores (404, 400, 402, etc.) sin que
    // callEdgeFunction lance una excepción.
    return new Response(
      JSON.stringify({ status: res.status, data, raw: text.slice(0, 280) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});