export const LEVEL_PRODUCTS = ["nivel6", "nivel10", "nivel15", "nivel20", "nivel25", "nivel30"];

export const PRODUCT_MAP = {
  basica:  { nombre: "Pase Booyah — Tarjeta Básica",  tipo: "pase",  grupo: "Pases Booyah" },
  semanal: { nombre: "Pase Booyah — Tarjeta Semanal", tipo: "pase",  grupo: "Pases Booyah" },
  mensual: { nombre: "Pase Booyah — Tarjeta Mensual", tipo: "pase",  grupo: "Pases Booyah" },
  booyah:  { nombre: "Pase Booyah",                    tipo: "pase",  grupo: "Pases Booyah" },
  nivel6:  { nombre: "Paquete de Nivel 6",  tipo: "nivel", grupo: "Paquetes de Nivel" },
  nivel10: { nombre: "Paquete de Nivel 10", tipo: "nivel", grupo: "Paquetes de Nivel" },
  nivel15: { nombre: "Paquete de Nivel 15", tipo: "nivel", grupo: "Paquetes de Nivel" },
  nivel20: { nombre: "Paquete de Nivel 20", tipo: "nivel", grupo: "Paquetes de Nivel" },
  nivel25: { nombre: "Paquete de Nivel 25", tipo: "nivel", grupo: "Paquetes de Nivel" },
  nivel30: { nombre: "Paquete de Nivel 30", tipo: "nivel", grupo: "Paquetes de Nivel" },
};

export function meta(p) {
  return PRODUCT_MAP[p] || { nombre: p, tipo: "otro", grupo: "Otros" };
}

export function isOncePerId(p) {
  return LEVEL_PRODUCTS.includes(p);
}

// Detecta si el texto de la denominación corresponde a un producto del bot.
// Sirve para que la página sepa a quién llamar tras aprobar el pago.
export function findBotProduct(label) {
  if (!label) return null;
  const s = (label + "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const m = s.match(/nivel\s*(\d+)/);
  if (m) {
    const key = `nivel${m[1]}`;
    return PRODUCT_MAP[key] ? key : null;
  }
  // Orden importante: "basica" se revisa ANTES que "semanal"/"mensual" porque
  // Mobentas puede entregar labels compuestos como "Semanal Basica" — si
  // revisáramos "semanal" primero, mapearía a la tarjeta semanal cuando el
  // cliente realmente eligió la básica.
  if (s.includes("basica") || s.includes("basico")) return "basica";
  if (s.includes("mensual")) return "mensual";
  if (s.includes("semanal")) return "semanal";
  if (s.includes("booyah")) return "booyah";
  return null;
}

export const BOT_PRODUCT_KEYS = Object.keys(PRODUCT_MAP);

// Slugs de juegos cuyos productos pueden ser despachados automáticamente por el bot.
export const BOT_GAME_SLUGS = ["free-fire"];

export function isBotProduct(key) {
  return !!PRODUCT_MAP[key];
}