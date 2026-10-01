// Productos que se entregan por código (gift cards): la API de Venium
// devuelve un código que el cliente canjear en el sitio oficial del producto.
// Para estos productos el flujo pide el correo como dato de entrega y muestra
// una guía de canje tras verificar el pago.

const EMAIL_DELIVERY_SLUGS = ["roblox", "playstation", "steam", "xbox", "nintendo-eshop", "apple-gift-card"];

export function isEmailDelivery(slug) {
  return EMAIL_DELIVERY_SLUGS.includes(slug);
}

// Guía de canje por producto. Devuelve null si el producto no aplica.
export function getRedemptionGuide(slug) {
  const guides = {
    roblox: {
      siteName: "Roblox",
      siteUrl: "https://www.roblox.com/redeem",
      steps: [
        "Entra a roblox.com/redeem desde tu navegador (preferiblemente en PC).",
        "Inicia sesión con la cuenta de Roblox donde quieres recibir los Robux.",
        "Escribe el código que recibiste, tal cual, sin espacios.",
        "Presiona «Canjear» (Redeem) y los Robux se acreditarán a tu cuenta al instante.",
      ],
      note: "Guarda tu código: también lo enviamos a tu correo como respaldo.",
    },
    playstation: {
      siteName: "PlayStation",
      siteUrl: "https://store.playstation.com/redeem-codes",
      steps: [
        "Entra a store.playstation.com/redeem-codes desde tu navegador o consola.",
        "Inicia sesión con la cuenta de PSN donde quieres recibir el saldo.",
        "Escribe el código que recibiste, tal cual, sin espacios.",
        "Presiona «Canjear» y el saldo se acreditará a tu cuenta al instante.",
      ],
      note: "Tu cuenta de PSN debe estar en la región del código (Global/USA). Guarda tu código: también lo enviamos a tu correo.",
    },
    steam: {
      siteName: "Steam",
      siteUrl: "https://store.steampowered.com/account/redeemwalletcode",
      steps: [
        "Entra a store.steampowered.com/account/redeemwalletcode desde tu navegador.",
        "Inicia sesión con tu cuenta de Steam.",
        "Escribe el código que recibiste, tal cual, sin espacios.",
        "Presiona «Continuar» y el saldo se acreditará a tu billetera de Steam.",
      ],
      note: "Tu cuenta de Steam debe estar en región USA. Guarda tu código: también lo enviamos a tu correo.",
    },
    xbox: {
      siteName: "Xbox",
      siteUrl: "https://redeem.microsoft.com",
      steps: [
        "Entra a redeem.microsoft.com desde tu navegador.",
        "Inicia sesión con tu cuenta de Microsoft/Xbox.",
        "Escribe el código que recibiste, tal cual, sin espacios.",
        "Presiona «Siguiente» y el saldo se acreditará a tu cuenta.",
      ],
      note: "Tu cuenta de Microsoft debe estar en región USA. Guarda tu código: también lo enviamos a tu correo.",
    },
    "nintendo-eshop": {
      siteName: "Nintendo eShop",
      siteUrl: "https://ec.nintendo.com/redeem",
      steps: [
        "Entra a ec.nintendo.com/redeem desde tu navegador o consola Nintendo.",
        "Inicia sesión con tu cuenta Nintendo.",
        "Escribe el código que recibiste, tal cual, sin espacios.",
        "Presiona «Canjear» y el saldo se acreditará a tu cuenta.",
      ],
      note: "Tu cuenta Nintendo debe estar en región USA. Guarda tu código: también lo enviamos a tu correo.",
    },
    "apple-gift-card": {
      siteName: "Apple Gift Card",
      siteUrl: "https://www.apple.com/shop/gift-cards",
      steps: [
        "Abre la App Store o iTunes en tu dispositivo Apple.",
        "Ve a tu cuenta → «Canjear regalo o código».",
        "Escribe el código que recibiste, tal cual, sin espacios.",
        "Presiona «Canjear» y el saldo se acreditará a tu Apple ID.",
      ],
      note: "Tu Apple ID debe estar en región USA. Guarda tu código: también lo enviamos a tu correo.",
    },
  };
  return guides[slug] || null;
}