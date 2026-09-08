import { env } from "../../config/env.js";
import { randomUUID } from "node:crypto";

export interface VeniumPackage {
  packageId: string;
  name: string;
  price: number;
  outOfStock: boolean;
}

export interface VeniumProduct {
  productId: string;
  name: string;
  category: string;
  packages: VeniumPackage[];
  playerFields: Array<{ label: string; type: string; required: boolean; key?: string }>;
}

export interface VeniumOrder {
  orderId: string;
  status: string;
  product: string;
  package: string;
  quantity: number;
  totalCharged: number;
  remainingBalance?: number;
}

export interface VeniumClient {
  getCatalog(): Promise<VeniumProduct[]>;
  getBalance(): Promise<unknown>;
  getOrders(query?: Record<string, string | number>): Promise<unknown>;
  createOrder(input: {
    productId: string;
    packageId: string;
    playerData: Record<string, string>;
    quantity: number;
  }): Promise<VeniumOrder>;
}

const mockCatalog: VeniumProduct[] = [
  {
    productId: "mock-free-fire",
    name: "Free Fire",
    category: "Juegos móviles",
    packages: [{ packageId: "mock-100-diamantes", name: "100 + 10 Diamantes", price: 0.55, outOfStock: false }],
    playerFields: [{ label: "Player ID", type: "text", required: true, key: "playerid" }],
  },
];

export function createVeniumClient(): VeniumClient {
  async function request(path: string, init: RequestInit = {}): Promise<any> {
    if (env.VENIUM_MODE !== "live") throw new Error("Venium is not in live mode");
    if (!env.VENIUM_API_KEY) throw new Error("VENIUM_API_KEY is required for live mode");
    const response = await fetch(`${env.VENIUM_BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "X-API-Key": env.VENIUM_API_KEY, ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(`Venium error ${response.status}: ${body.error ?? "unknown error"}`);
    }
    return body.data;
  }

  return {
    async getCatalog() {
      if (env.VENIUM_MODE === "mock") return mockCatalog;
      return request("/api/reseller/catalog");
    },
    async getBalance() {
      if (env.VENIUM_MODE === "mock") return { email: "mock@example.invalid", balance: 150, currency: "USD" };
      return request("/api/reseller/balance");
    },
    async getOrders(query = {}) {
      if (env.VENIUM_MODE === "mock") return [];
      const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
      return request(`/api/reseller/orders?${params.toString()}`);
    },
    async createOrder(input) {
      if (env.VENIUM_MODE === "mock") {
        return {
          orderId: `MOCK-${randomUUID()}`,
          status: "processing",
          product: input.productId,
          package: input.packageId,
          quantity: input.quantity,
          totalCharged: 0,
          remainingBalance: 150,
        };
      }
      if (!env.ALLOW_LIVE_ORDER_CREATION) {
        throw new Error("live Venium order creation is blocked by ALLOW_LIVE_ORDER_CREATION");
      }
      return request("/api/reseller/orders", { method: "POST", body: JSON.stringify(input) });
    },
  };
}