// ============================================================================
// Proxy de Subida de Comprobantes  (Cloudflare Worker, plan FREE)
// ----------------------------------------------------------------------------
// Worker INDEPENDIENTE del proxy de Venium. Recibe imágenes (comprobantes de
// pago, capturas de error) desde la tienda y las sube a tmpfiles.org (gratis,
// sin registro, almacenamiento temporal de 60 min → permanente).
//
// Estilo clásico (addEventListener) para máxima compatibilidad.
// No necesita variables de entorno ni secrets.
//
// Cómo desplegarlo (3 minutos):
//   1. Cloudflare Dashboard → Workers & Pages → Create → Worker.
//   2. Nombre: legacy-uploads → Deploy.
//   3. "Edit code" → borra todo → pega este archivo → Deploy.
//   4. Copia la URL del worker (https://legacy-uploads.xxx.workers.dev).
//   5. En tu tienda → Admin → pestaña Venium → sección "Proxy de Comprobantes"
//      → pega la URL y guarda.
// ============================================================================

var ALLOWED_KEY = "legacy_uploads_2025";

var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS)
  });
}

addEventListener("fetch", function (event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  var url = new URL(request.url);

  var key = url.searchParams.get("key");
  if (key !== ALLOWED_KEY) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  // Endpoint /upload — sube una imagen a tmpfiles.org.
  if (url.pathname === "/upload" && request.method === "POST") {
    try {
      var body = await request.json();
      var b64 = String(body && body.image || "");
      if (!b64) throw new Error("Imagen vacía");

      var byteString = atob(b64);
      var bytes = new Uint8Array(byteString.length);
      for (var i = 0; i < byteString.length; i++) {
        bytes[i] = byteString.charCodeAt(i);
      }

      var formData = new FormData();
      formData.append("file", new Blob([bytes], { type: body.contentType || "image/jpeg" }), body.filename || "recibo.jpg");

      var resp = await fetch("https://tmpfiles.org/api/v1/upload", {
        method: "POST",
        body: formData
      });
      var text = (await resp.text()).trim();
      var data;
      try { data = JSON.parse(text); } catch (e) { throw new Error("tmpfiles respondio: " + text.substring(0, 200)); }

      if (!data || !data.data || !data.data.url) {
        throw new Error("tmpfiles no devolvio URL: " + text.substring(0, 200));
      }

      // Convierte la URL de página a URL directa de descarga:
      // https://tmpfiles.org/xxxx/f.jpg → https://tmpfiles.org/dl/xxxx/f.jpg
      var pageUrl = data.data.url;
      var directUrl = pageUrl.replace("tmpfiles.org/", "tmpfiles.org/dl/");

      return jsonResp({ url: directUrl });
    } catch (e) {
      return jsonResp({ error: "No se pudo subir la imagen", detail: String(e && e.message || e) }, 502);
    }
  }

  return jsonResp({ error: "Not found", hint: "Usa POST /upload?key=..." }, 404);
}