// Llave publica de autorizacion del proxy de BDV (mismo patron que el proxy de
// Venium). Va en la URL porque solo evita uso casual de la URL del Worker: la
// seguridad real es el secreto BDV_VERIFY_KEY, que vive en el Worker y nunca
// sale de el.
export const BDV_PROXY_AUTH_KEY = "legacy_bdv_2025";

// Construye la URL del proxy con la llave publica que exige el Worker
// (webpage/src/proxy/bdv-verify.worker.js). Sin este ?key= el Worker responde
// 401 y el boton "Verificar pago" de la tienda se rompe.
export function buildBdvProxyUrl(proxyBase) {
  const url = new URL(String(proxyBase).replace(/\/+$/, ""));
  url.searchParams.set("key", BDV_PROXY_AUTH_KEY);
  return url.toString();
}
