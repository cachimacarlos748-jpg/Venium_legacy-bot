// Mapa de región por slug de producto. Refleja las regiones que muestra
// Venium en su tienda (veniumstore.com) debajo del nombre de cada juego.
// El catálogo de la API de Venium no expone la región, así que se mapea
// manualmente por slug.

const REGION_MAP = {
  // Juegos
  "free-fire": "Latam",
  "blood-strike": "Global",
  "roblox": "Sudamérica",
  "valorant": "Latam",
  "mobile-legends": "Global",
  "league-of-legends": "Latam",
  "call-of-duty-mobile": "Global",
  "wild-rift": "Latam",
  "honor-of-kings": "Global",
  "genshin-impact": "Global",
  "arena-breakout": "USA / Latam",
  "clash-royale": "Global",
  "once-human": "Global",
  "brawl-stars": "Global",
  "clash-of-clans": "Global",
  "identy-v": "Global",
  "delta-force": "Norte / Sur",
  "where-winds-meet": "Norte / Sur",
  "supersus": "Global",
  "racing-master": "LATAM",
  "farlight-84": "Global",
  "rainbow-six-mobile": "Global",
  "pubg-mobile": "Norte / Sur",
  // Gift Cards
  "apple-gift-card": "USA",
  "playstation": "Global",
  "steam": "USA",
  "xbox": "USA",
  "nintendo-eshop": "USA",
  // Servicios
  "zinli": "Global",
  "poppo-live": "Global",
  "bigo-live": "Global",
  "binance": "USDT",
};

export function getProductRegion(slug) {
  if (!slug) return "";
  return REGION_MAP[slug.trim().toLowerCase()] || "";
}