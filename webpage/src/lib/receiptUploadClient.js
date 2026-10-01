// Subida de comprobantes e imágenes.
//
// Estrategia:
//   1) Comprime la imagen en el cliente (canvas → JPEG 80%, máx 1200px).
//   2) La sube con UploadFile de Base44 (directo desde el navegador, sin proxy).
//   3) Devuelve la URL pública de la imagen.
//
// Si hay un proxy de comprobantes configurado, lo intenta primero (gratis,
// sin créditos). Si no hay proxy o falla, usa UploadFile de Base44.

import { base44 } from "@/api/base44Client";

const DEFAULTS = {
  proxy_url: "",
  auth_key: "legacy_uploads_2025",
};

let _config = null;

export async function getUploadsProxyConfig() {
  if (_config) return _config;
  try {
    const recs = await base44.entities.Setting.filter({ key: "uploads_proxy" });
    const rec = recs?.[0];
    const parsed = rec?.value ? JSON.parse(rec.value) : {};
    _config = { ...DEFAULTS, ...parsed };
  } catch {
    _config = { ...DEFAULTS };
  }
  return _config;
}

export async function setUploadsProxyConfig(partial) {
  const current = await getUploadsProxyConfig();
  const merged = { ...current, ...partial };
  const value = JSON.stringify(merged);
  try {
    const recs = await base44.entities.Setting.filter({ key: "uploads_proxy" });
    if (recs?.[0]) await base44.entities.Setting.update(recs[0].id, { value });
    else await base44.entities.Setting.create({ key: "uploads_proxy", value });
  } catch (e) {
    throw e;
  }
  _config = null;
  return merged;
}

// Comprime una imagen File → base64 (sin el prefijo data:...).
async function compressImage(file, maxDim = 1200, quality = 0.8) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });
    return compressViaCanvas(img, maxDim, quality);
  }
  return compressViaCanvas(bitmap, maxDim, quality);
}

function compressViaCanvas(source, maxDim, quality) {
  let { width, height } = source;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1];
}

// Sube una imagen al Cloudflare Worker → tmpfiles.org. Devuelve la URL pública.
export async function uploadImageViaProxy(file) {
  const cfg = await getUploadsProxyConfig();
  const proxyUrl = cfg?.proxy_url;
  if (!proxyUrl) throw new Error("No hay proxy de comprobantes configurado");

  const base64 = await compressImage(file);
  const filename = (file.name || "recibo").replace(/[^\w.-]/g, "_").slice(0, 50) || "recibo.jpg";

  const endpoint = proxyUrl.replace(/\/+$/, "") + "/upload?key=" + (cfg.auth_key || "legacy_uploads_2025");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, contentType: "image/jpeg", filename }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.url) throw new Error(data.error || data.detail || "upload failed");
  return data.url;
}

// Sube una imagen: primero intenta el proxy (gratis), luego UploadFile como
// respaldo. Devuelve { url, b64 } — el base64 se conserva para pasárselo
// directamente a Gemini (evita re-descargar la URL, que falla por CORS en
// tmpfiles.org).
export async function uploadImage(file) {
  // Comprime primero: necesitamos el base64 tanto para subir al proxy como
  // para pasárselo a Gemini sin re-descargarlo.
  const b64 = await compressImage(file).catch(() => "");

  // 1) Proxy → tmpfiles.org (gratis, sin créditos) — solo si está configurado.
  if (b64) {
    try {
      const cfg = await getUploadsProxyConfig();
      if (cfg?.proxy_url) {
        const filename = (file.name || "recibo").replace(/[^\w.-]/g, "_").slice(0, 50) || "recibo.jpg";
        const endpoint = cfg.proxy_url.replace(/\/+$/, "") + "/upload?key=" + (cfg.auth_key || "legacy_uploads_2025");
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: b64, contentType: "image/jpeg", filename }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.url) return { url: data.url, b64 };
      }
    } catch (e) {
      console.warn("[uploadImage] proxy falló, usando UploadFile:", e?.message || e);
    }
  }
  // 2) UploadFile de Base44 (directo desde el navegador, sin proxy).
  try {
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) return { url: res.file_url, b64 };
  } catch (e) {
    console.warn("[uploadImage] UploadFile falló:", e?.message || e);
  }
  return { url: "", b64 };
}