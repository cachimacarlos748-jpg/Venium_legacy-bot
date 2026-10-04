/**
 * Comparacion de referencias y montos para conciliar pagos de BDVenlinea.
 *
 * Vive aparte del navegador y del cliente HTTP a proposito: es la logica que
 * decide si lo que el cliente escribio corresponde a un movimiento real del
 * banco, y la unica que se puede probar sin sesion ni red. Si aqui hay un
 * error, o se acepta un comprobante equivocado o se rechaza a un cliente que
 * si pago.
 */

/**
 * Compara dos referencias de pago sin asumir una longitud fija.
 *
 * Los bancos varian mucho: BDV devuelve 13 digitos (0677228032099), otros
 * 8, otros 6. Ademas el BDV Sometimes antepone ceros, asi que la misma
 * operacion puede aparecer como 0677228032099 o 677228032099.
 *
 * La regla es deliberadamente estricta para no dar por pagado un comprobante
 * equivocado: primero se comparan las referencias completas; si no coinciden,
 * se acepta solo cuando una es exactamente la cola de la otra (ceros a la
 * izquierda) y la corta tiene al menos 6 digitos.
 *
 * El minimo de 6 digitos es lo que separa "el cliente tecleo mal una
 * referencia" de "este movimiento es el suyo": por debajo, un sufijo de 3-4
 * digitos empareja con facilidad con otro pago y se entregaria un pedido sin
 * haberlo pagado.
 */
export function referencesMatch(a: string, b: string): boolean {
  const x = String(a ?? "").replace(/\D/g, "");
  const y = String(b ?? "").replace(/\D/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 6) return false;
  return long.endsWith(short);
}

/** "18.500,00" | "18500.00" -> number */
export function parseBs(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let value = raw.replace(/[^\d.,-]/g, "");
  if (!value || value === "-") return null;
  if (value.lastIndexOf(",") > value.lastIndexOf(".")) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Tolerancia de monto con epsilon.
 *
 * Sin el epsilon, comparar 100.00 contra 100.01 con tolerancia 0.01 falla:
 * en coma flotante |100 - 100.01| da 0.010000000000005116, que es
 * MAYOR que 0.01. El banco y la tienda nunca van a discrepar en un centimo
 * por redondeo, asi que comparar "menor o igual" sin mas rechazaba pagos
 * validos por un error del propio lenguaje.
 */
export const AMOUNT_EPSILON = 1e-6;

export function amountsMatch(a: unknown, b: unknown, tolerance = 0.01): boolean {
  const x = parseBs(a);
  const y = parseBs(b);
  if (x === null || y === null) return false;
  return Math.abs(x - y) <= tolerance + AMOUNT_EPSILON;
}
