import { env } from "../../config/env.js";

export interface PabiloPaymentResult {
  verified: boolean;
  isNew: boolean;
  status: "verified_new" | "duplicate" | "not_found" | "bank_unavailable" | "error";
  raw: unknown;
}

export interface PabiloClient {
  listUserBanks(): Promise<unknown>;
  verifyPayment(input: { userBankId: string; amount: string; bankReference: string; movementType: string }): Promise<PabiloPaymentResult>;
}

export function createPabiloClient(): PabiloClient {
  const mockSeen = new Set<string>();

  return {
    async listUserBanks() {
      if (env.PABILO_MODE === "mock") return { user_banks: [] };
      if (!env.PABILO_API_KEY) throw new Error("PABILO_API_KEY is required for live mode");
      const response = await fetch(`${env.PABILO_BASE_URL}/me/usersbank`, {
        method: "GET",
        headers: { appKey: env.PABILO_API_KEY },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Pabilo error ${response.status}`);
      return body;
    },
    async verifyPayment(input) {
      if (!input.userBankId) {
        return { verified: false, isNew: false, status: "error", raw: { error: "PABILO_USER_BANK_ID_MISSING" } };
      }

      if (env.PABILO_MODE === "mock") {
        const key = `${input.userBankId}:${input.amount}:${input.bankReference}`;
        if (mockSeen.has(key)) return { verified: false, isNew: false, status: "duplicate", raw: { data: { is_new: false } } };
        mockSeen.add(key);
        return { verified: true, isNew: true, status: "verified_new", raw: { data: { is_new: true } } };
      }

      if (!env.PABILO_API_KEY) throw new Error("PABILO_API_KEY is required for live mode");
      const response = await fetch(
        `${env.PABILO_BASE_URL}/userbankpayment/${encodeURIComponent(input.userBankId)}/betaserio`,
        {
          method: "POST",
          headers: { "content-type": "application/json", appKey: env.PABILO_API_KEY },
          body: JSON.stringify({
            amount: Number(input.amount),
            bank_reference: input.bankReference,
            movement_type: input.movementType,
          }),
        },
      );
      const body: any = await response.json().catch(() => ({}));
      if (body?.error === "BANK_NOT_AVAILABLE") {
        return { verified: false, isNew: false, status: "bank_unavailable", raw: body };
      }
      if (body?.error === "PAYMENT_NOT_FOUND") {
        return { verified: false, isNew: false, status: "not_found", raw: body };
      }
      if (!response.ok || body?.data?.is_new !== true) {
        return { verified: false, isNew: false, status: "error", raw: body };
      }
      return { verified: true, isNew: true, status: "verified_new", raw: body };
    },
  };
}