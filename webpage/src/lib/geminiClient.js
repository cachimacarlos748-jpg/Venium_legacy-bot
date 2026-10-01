import { base44 } from "@/api/base44Client";
import { callEdgeFunction, isSupabaseConfigured } from "@/lib/supabaseClient";

const GEMINI_MODEL = "gemini-2.5-flash";

async function getGeminiApiKey() {
  try {
    const recs = await base44.entities.Setting.filter({ key: "gemini" });
    const parsed = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
    return parsed.api_key || "";
  } catch {
    return "";
  }
}

// Descarga una imagen y la convierte a base64 para el campo inline_data de Gemini.
async function imageUrlToBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { b64: btoa(binary), mimeType: blob.type || "image/jpeg" };
}

/**
 * Verifica un comprobante de pago usando Gemini.
 * 1) Llamada directa a la API de Gemini (soporta CORS + API key desde el navegador).
 *    Lee la API key del Setting "gemini" (panel de admin).
 * 2) Respaldo: Edge Function de Supabase (con api_key en el body).
 */
export async function callGemini({ prompt, images, responseJsonSchema }) {
  const apiKey = await getGeminiApiKey();

  // 1) Llamada directa a Gemini (Google APIs soportan CORS + API key)
  if (apiKey) {
    try {
      const parts = [{ text: prompt || "" }];
      for (const img of (images || [])) {
        try {
          let b64, mimeType;
          // Acepta base64 directo { b64, mimeType } o URL string.
          // El base64 directo evita re-descargar la URL (tmpfiles.org bloquea
          // CORS desde el navegador).
          if (img && typeof img === "object" && img.b64) {
            b64 = img.b64;
            mimeType = img.mimeType || "image/jpeg";
          } else {
            const r = await imageUrlToBase64(img);
            b64 = r.b64;
            mimeType = r.mimeType;
          }
          parts.push({ inline_data: { mime_type: mimeType, data: b64 } });
        } catch {}
      }
      const body = {
        contents: [{ parts }],
        generationConfig: responseJsonSchema
          ? { responseMimeType: "application/json", responseSchema: responseJsonSchema }
          : undefined,
      };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) throw new Error("Gemini respuesta vacía");
      if (responseJsonSchema) return typeof text === "string" ? JSON.parse(text) : text;
      return text;
    } catch (e) {
      console.warn("[gemini] llamada directa falló, intentando Edge Function:", e.message);
    }
  }

  // 2) Respaldo: Edge Function (con api_key en el body por si el env var no está)
  if (await isSupabaseConfigured()) {
    try {
      const result = await callEdgeFunction("verify-receipt", { prompt, images, responseJsonSchema, api_key: apiKey });
      if (responseJsonSchema) return typeof result === "string" ? JSON.parse(result) : result;
      return typeof result === "string" ? result : (result?.text || "");
    } catch (e) {
      throw new Error("No se pudo verificar el comprobante (servicio no disponible). Reintenta en unos momentos.");
    }
  }

  throw new Error("No se pudo verificar el comprobante. Reintenta en unos momentos.");
}