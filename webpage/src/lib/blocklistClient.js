import { base44 } from "@/api/base44Client";

// Carga la lista negra (IDs de jugador, IPs, correos, WhatsApp bloqueados).
// Se consulta al entrar al flujo de compra para impedir que un usuario
// bloqueado siga recargando.
let cache = null;

export async function loadBlocklist() {
  try {
    const records = await base44.entities.Blocklist.list("-created_date", 500);
    cache = records || [];
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

// Devuelve el registro bloqueado que coincida, o null si no hay coincidencia.
// Compara player_id, ip, email y whatsapp (sin distinción de mayúsculas).
export function isBlocked(records, { playerId, ip, email, whatsapp } = {}) {
  if (!records || !records.length) return null;
  const norm = (v) => String(v || "").trim().toLowerCase();
  const pid = norm(playerId);
  const ipp = norm(ip);
  const em = norm(email);
  const wa = norm(whatsapp);
  for (const r of records) {
    const v = norm(r.value);
    if (!v) continue;
    if (r.type === "player_id" && pid && pid === v) return r;
    if (r.type === "ip" && ipp && ipp === v) return r;
    if (r.type === "email" && em && em === v) return r;
    if (r.type === "whatsapp" && wa && wa === v) return r;
  }
  return null;
}