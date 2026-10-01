// Detección de IP + ubicación aproximada del navegador, vía ipapi.co (sin API
// key, CORS habilitado). Sirve como advertencia anti-fraude cuando un cliente
// sube un comprobante falso: la página le muestra su IP y ciudad, igual que lo
// hace recargasnexus.com. La IP también se guarda en la entidad Order para
// auditoría del administrador.
let cache = null;

export async function detectUserIp() {
  if (cache) return cache;
  try {
    const res = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.ip) cache = data;
    return cache;
  } catch {
    return null;
  }
}