// Detecta cuando la web corre dentro del envoltorio Android (Capacitor) y
// cambia la capa visual a modo app, sin tocar el comportamiento:
// - El flujo de comprar, pagar, verificar, canjear etc. es el mismo.
// - Home con layout de app: buscador grande, chips por categoría y secciones
//   horizontales estilo app (mismas consultas de datos, sin cambios de API).
// - En la web normal todo queda exactamente igual que hoy.
// @capacitor/core es una dependencia normal del proyecto; en navegador puro
// reporta plataforma "web", así que isAppMode() es false y nada cambia.
import { Capacitor } from "@capacitor/core";

export function detectNativePlatform() {
  try {
    if (Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      return Capacitor.getPlatform(); // "android" | "ios"
    }
  } catch {
    /* no-op */
  }
  return null;
}

export function isAppMode() {
  return detectNativePlatform() !== null;
}
