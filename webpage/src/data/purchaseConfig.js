// Purchase configuration per product. Keyed by normalized slug.
// Falls back to a generic config when a product is not listed.

const slugify = (s = "") =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const PAYMENT_METHODS = [
  { id: "pago-movil", name: "Pago Móvil", desc: "Transferencia bancaria VE", icon: "🏦" },
  { id: "zelle", name: "Zelle", desc: "Pago instantáneo en USD", icon: "⚡" },
  { id: "binance", name: "Binance Pay", desc: "Cripto USDT", icon: "🪙" },
  { id: "paypal", name: "PayPal", desc: "Tarjeta o saldo", icon: "💳" },
];

const GAMES = {
  "free-fire": {
    title: "Free Fire",
    requiresPlayerId: true,
    idLabel: "ID de jugador",
    idPlaceholder: "Ingresa tu ID de Free Fire",
    idHint: "Verifica tu ID en el perfil del juego. No incluye zona.",
    denominations: [
      { label: "72 Diamantes", price: 1.0 },
      { label: "145 Diamantes", price: 2.0 },
      { label: "240 Diamantes", price: 3.0 },
      { label: "355 Diamantes", price: 5.0 },
      { label: "720 Diamantes", price: 10.0 },
      { label: "1450 Diamantes", price: 20.0 },
      { label: "Membresía Semanal", price: 2.5 },
      { label: "Membresía Mensual", price: 8.0 },
    ],
  },
  "mobile-legends": {
    title: "Mobile Legends",
    requiresPlayerId: true,
    requiresServer: true,
    idLabel: "ID de jugador",
    idPlaceholder: "Ingresa tu ID de Mobile Legends",
    idHint: "Ingresa también el ID de zona (server) que aparece junto a tu ID.",
    denominations: [
      { label: "86 Diamantes", price: 1.5 },
      { label: "172 Diamantes", price: 3.0 },
      { label: "257 Diamantes", price: 4.5 },
      { label: "429 Diamantes", price: 7.5 },
      { label: "514 Diamantes", price: 9.0 },
      { label: "706 Diamantes", price: 12.0 },
      { label: "Membresía Semanal", price: 3.0 },
      { label: "Membresía Mensual", price: 10.0 },
    ],
  },
  "wild-rift": {
    title: "Wild Rift",
    requiresPlayerId: true,
    idLabel: "ID de invocador",
    idPlaceholder: "Ingresa tu ID de invocador",
    denominations: [
      { label: "525 Riot Coins", price: 5.0 },
      { label: "1100 Riot Coins", price: 10.0 },
      { label: "2250 Riot Coins", price: 20.0 },
      { label: "4000 Riot Coins", price: 35.0 },
    ],
  },
  "call-of-duty-mobile": {
    title: "Call of Duty Mobile",
    requiresPlayerId: true,
    requiresServer: true,
    idLabel: "ID de jugador",
    idPlaceholder: "Ingresa tu ID (OpenID)",
    idHint: "Ingresa también el ID de zona que aparece junto a tu OpenID.",
    denominations: [
      { label: "80 CP", price: 1.0 },
      { label: "400 CP", price: 5.0 },
      { label: "820 CP", price: 10.0 },
      { label: "1650 CP", price: 20.0 },
      { label: "3360 CP", price: 40.0 },
      { label: "8400 CP", price: 100.0 },
    ],
  },
  "genshin-impact": {
    title: "Genshin Impact",
    requiresPlayerId: true,
    requiresServer: true,
    idLabel: "UID",
    idPlaceholder: "Ingresa tu UID",
    idHint: "Tu UID incluye el número de servidor al inicio (ej: 600000000).",
    denominations: [
      { label: "60 Cristales", price: 1.0 },
      { label: "330 Cristales", price: 5.0 },
      { label: "1090 Cristales", price: 15.0 },
      { label: "2240 Cristales", price: 30.0 },
      { label: "Bendición Lunar", price: 5.0 },
    ],
  },
  "blood-strike": {
    title: "Blood Strike",
    requiresPlayerId: true,
    idLabel: "ID de jugador",
    idPlaceholder: "Ingresa tu ID",
    denominations: [
      { label: "100 Tokens", price: 1.0 },
      { label: "500 Tokens", price: 5.0 },
      { label: "1080 Tokens", price: 10.0 },
      { label: "2200 Tokens", price: 20.0 },
    ],
  },
};

const GIFT_CARDS = {
  "apple-usa": {
    title: "Apple Gift Card USA",
    requiresPlayerId: false,
    denominations: [
      { label: "$10 USD", price: 12.0 },
      { label: "$25 USD", price: 27.0 },
      { label: "$50 USD", price: 52.0 },
      { label: "$100 USD", price: 102.0 },
    ],
  },
  "roblox-gift-card": {
    title: "Roblox Gift Card",
    requiresPlayerId: false,
    denominations: [
      { label: "800 Robux", price: 10.0 },
      { label: "1700 Robux", price: 20.0 },
      { label: "4500 Robux", price: 50.0 },
      { label: "10000 Robux", price: 100.0 },
    ],
  },
  "riot-access": {
    title: "Riot Access",
    requiresPlayerId: false,
    denominations: [
      { label: "$5 USD", price: 7.0 },
      { label: "$10 USD", price: 12.0 },
      { label: "$25 USD", price: 27.0 },
    ],
  },
  "playstation": {
    title: "PlayStation Gift Card",
    requiresPlayerId: false,
    denominations: [
      { label: "$10 USD", price: 12.0 },
      { label: "$25 USD", price: 27.0 },
      { label: "$50 USD", price: 52.0 },
    ],
  },
  "steam-usa": {
    title: "Steam Gift Card USA",
    requiresPlayerId: false,
    denominations: [
      { label: "$20 USD", price: 22.0 },
      { label: "$50 USD", price: 52.0 },
      { label: "$100 USD", price: 102.0 },
    ],
  },
  "xbox-gift-card": {
    title: "Xbox Gift Card",
    requiresPlayerId: false,
    denominations: [
      { label: "$15 USD", price: 17.0 },
      { label: "$25 USD", price: 27.0 },
      { label: "$50 USD", price: 52.0 },
    ],
  },
};

const ALL = { ...GAMES, ...GIFT_CARDS };

// Nombre de la moneda virtual de cada juego. Se usa en el selector de
// paquetes cuando el label scrapeado de Mobentas es solo un número (ej:
// "800") para que diga "800 Robux" en vez de "800 Diamantes".
const CURRENCY_LABELS = {
  "free-fire": "Diamantes",
  "mobile-legends": "Diamantes",
  "wild-rift": "Riot Coins",
  "call-of-duty-mobile": "CP",
  "codm": "CP",
  "genshin-impact": "Cristales",
  "blood-strike": "Oro",
  "roblox": "Robux",
  "honor-of-kings": "Ágatas",
  "hok": "Ágatas",
  "clash-of-clans": "Gemas",
  "clash-royale": "Oro",
};

export function getCurrencyLabel(slug) {
  return CURRENCY_LABELS[slugify(slug || "")] || "";
}

export const slugifyLocal = slugify;

// Pure config (no paymentMethods) for seeding into DB
export function buildDefaultConfig(slug, name) {
  const c = getPurchaseConfig(slug, name);
  return {
    title: c.title,
    denominations: c.denominations,
    requiresPlayerId: c.requiresPlayerId || false,
    requiresServer: c.requiresServer || false,
    idLabel: c.idLabel || "",
    idHint: c.idHint || "",
  };
}

// Resolve at purchase time: prefer DB config, else fall back to hardcoded defaults
export function resolveConfig(product, slug) {
  if (product && product.config && Array.isArray(product.config.denominations) && product.config.denominations.length) {
    return {
      title: product.name,
      denominations: product.config.denominations,
      requiresPlayerId: !!product.config.requiresPlayerId,
      requiresServer: !!product.config.requiresServer,
      idLabel: product.config.idLabel || "ID de jugador",
      idHint: product.config.idHint || "",
      isGiftCard: false,
      paymentMethods: PAYMENT_METHODS,
      regions: product.config.regions || null,
      venium_product_id: product.config.venium_product_id || slug,
    };
  }
  return getPurchaseConfig(slug, product?.name);
}

const GENERIC = {
  title: "Producto",
  requiresPlayerId: false,
  denominations: [
    { label: "Paquete Básico", price: 5.0 },
    { label: "Paquete Estándar", price: 10.0 },
    { label: "Paquete Premium", price: 20.0 },
  ],
};

export function getPurchaseConfig(slug, name) {
  const key = slugify(slug || name || "");
  const found = ALL[key] || Object.values(GAMES).find(
    (g) => slugify(g.title) === key
  );
  if (found) {
    const isGift = key in GIFT_CARDS;
    return { ...found, isGiftCard: isGift, paymentMethods: PAYMENT_METHODS };
  }
  return { ...GENERIC, title: name || GENERIC.title, isGiftCard: false, paymentMethods: PAYMENT_METHODS };
}

export function getProductSlug(item) {
  return (
    item.slug ||
    slugify(item.name)
  );
}