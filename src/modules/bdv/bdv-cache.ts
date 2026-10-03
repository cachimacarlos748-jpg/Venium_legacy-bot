/**
 * Cache y deduplicacion para el verificador de BDVenlinea.
 *
 * El banco se consulta con un navegador real porque no ofrece API: cada
 * consulta cuesta 15-40 s (login + formulario + tabla). Pero casi nunca hace
 * falta pagar ese coste:
 *
 *  1. La tabla de movimientos no cambia entre consultas seguidas. Si hace 20 s
 *     que la leimos, volver a leerla por otra referencia devuelve lo mismo.
 *  2. Si dos clientes (WhatsApp y la web) preguntan a la vez, el banco exige
 *     serializar. En vez de encolar dos consultas al navegador, la segunda
 *     espera a la primera y reutiliza su resultado.
 *
 * Esto NO debilita la verificacion: el banco sigue siendo la unica fuente de
 * verdad. Solo se evita repetir una lectura identica.
 */

/** Movimientos tal como los devuelve el navegador. */
export interface Movement {
  reference: string | null;
  amount: number | null;
  date: string | null;
  description: string | null;
  incoming?: boolean;
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

export interface CacheOptions {
  /** Ventana durante la cual una lectura se considera vigente (ms). */
  ttlMs?: number;
  now?: () => number;
}

export class MovementCache {
  private entry: CacheEntry<Movement[]> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 45_000;
    this.now = options.now ?? Date.now;
  }

  /** Movimientos cacheados, o null si ya vencieron o nunca se leyeron. */
  get(): Movement[] | null {
    if (!this.entry) return null;
    if (this.now() - this.entry.at > this.ttlMs) return null;
    return this.entry.value;
  }

  set(movements: Movement[]): void {
    this.entry = { value: movements, at: this.now() };
  }

  clear(): void {
    this.entry = null;
  }

  /** true si hay una lectura vigente. */
  get isFresh(): boolean {
    return this.get() !== null;
  }
}

/**
 * Ejecuta una operacion una sola vez por clave: las llamadas posteriores con la
 * misma clave reciben la misma promesa en vez de abrir una segunda consulta al
 * banco. Es lo que evita que WhatsApp y la web disparen dos navegaciones
 * simultaneas al portal.
 */
export class SingleFlight<K, V> {
  private readonly inFlight = new Map<K, Promise<V>>();

  run(key: K, task: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = (async () => task())().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  get pending(): number {
    return this.inFlight.size;
  }
}

/** Error de "el banco ya esta ocupado": la web lo traduce a un reintento. */
export class BankBusyError extends Error {
  readonly code = "BDV_BUSY";
  constructor(waitedMs: number) {
    super(`El banco esta ocupado con otra verificacion (esperamos ${Math.round(waitedMs / 1000)} s). Reintenta en un momento.`);
    this.name = "BankBusyError";
  }
}
