// Edge Function de Supabase: verificación de comprobantes con Gemini.
// Las API keys viven aquí (como env vars del proyecto), no en el navegador.
//
// Deploy: supabase functions deploy verify-receipt --no-verify-jwt
// Env vars: GEMINI_API_KEY (configurar en Supabase Dashboard > Edge Functions > Secrets)
//
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_API_KEY_ENV = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = "gemini-2.5-flash";

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
    const { prompt, images, responseJsonSchema, api_key } = await req.json();
    const GEMINI_API_KEY = api_key || GEMINI_API_KEY_ENV;

    // Construir parts para Gemini
    const parts: any[] = [{ text: prompt || "" }];
    for (const imageUrl of (images || [])) {
      try {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        const buf = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        parts.push({ inline_data: { mime_type: blob.type || "image/jpeg", data: b64 } });
      } catch {}
    }

    const body: any = {
      contents: [{ parts }],
      generationConfig: responseJsonSchema
        ? { responseMimeType: "application/json", responseSchema: responseJsonSchema }
        : undefined,
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return new Response(text, {
      headers: { ...corsHeaders, "Content-Type": responseJsonSchema ? "application/json" : "text/plain" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});