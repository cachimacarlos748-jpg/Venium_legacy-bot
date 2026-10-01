// Edge Function de Supabase: envío de WhatsApp vía UltraMsg.
// Las API keys viven aquí (como env vars del proyecto), no en el navegador.
//
// Deploy: supabase functions deploy send-whatsapp --no-verify-jwt
// Env vars: ULTRAMSG_INSTANCE_ID, ULTRAMSG_TOKEN (configurar en Supabase Dashboard > Secrets)
//
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ULTRAMSG_INSTANCE_ID_ENV = Deno.env.get("ULTRAMSG_INSTANCE_ID") ?? "";
const ULTRAMSG_TOKEN_ENV = Deno.env.get("ULTRAMSG_TOKEN") ?? "";

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
    const { to, message, image, caption, instance_id, token } = await req.json();
    const ULTRAMSG_INSTANCE_ID = instance_id || ULTRAMSG_INSTANCE_ID_ENV;
    const ULTRAMSG_TOKEN = token || ULTRAMSG_TOKEN_ENV;

    const base = `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages`;
    let url, body;

    if (image) {
      url = `${base}/image`;
      body = new URLSearchParams({
        token: ULTRAMSG_TOKEN,
        to,
        image,
        caption: caption || message || "",
      });
    } else {
      url = `${base}/chat`;
      body = new URLSearchParams({
        token: ULTRAMSG_TOKEN,
        to,
        body: message || "",
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});