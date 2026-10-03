// La verificación de pagos de la web entra por un endpoint del bot, pero NO es
// una ruta libre: solo el proxy de Cloudflare (que guarda la clave como
// secreto) puede llamarlo. La decisión vive aquí, aparte y sin dependencias,
// para poder probarla: si el bot no tiene clave configurada, el endpoint queda
// CERRADO en lugar de abierto "por si acaso".
export type BdvVerifyAccess = "ok" | "not_configured" | "unauthorized";

export function checkBdvVerifyAccess(providedKey: string | undefined | null, configuredKey: string | undefined | null): BdvVerifyAccess {
  // Sin clave configurada no hay forma de autorizar a nadie: cerrado.
  if (!configuredKey) return "not_configured";
  if (!providedKey || providedKey !== configuredKey) return "unauthorized";
  return "ok";
}