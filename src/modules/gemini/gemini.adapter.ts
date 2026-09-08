import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../../config/env.js";

export interface ReceiptExtraction {
  reference: string | null;
  amountBs: string | null;
  paymentDate: string | null;
  bank: string | null;
  recipientData: Record<string, string> | null;
  confidence: number | null;
}

export interface ReceiptAnalyzer {
  analyze(input: { text?: string; imageBase64?: string; imageMimeType?: string }): Promise<ReceiptExtraction>;
}

export function createReceiptAnalyzer(): ReceiptAnalyzer {
  let client: GoogleGenAI | null = null;
  const extractionSchema = z.object({
    reference: z.string().nullable(),
    amountBs: z.string().nullable(),
    paymentDate: z.string().nullable(),
    bank: z.string().nullable(),
    recipientData: z.record(z.string()).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  });

  return {
    async analyze(input) {
      if (env.GEMINI_MODE !== "live") {
        // Gemini is intentionally disabled/mock by default. This adapter
        // prevents provider output from becoming a payment decision.
        return { reference: null, amountBs: null, paymentDate: null, bank: null, recipientData: null, confidence: null };
      }
      if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for live mode");
      client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

      const parts: Array<Record<string, unknown>> = [{
        text: [
          "Extrae datos de un comprobante de pago móvil venezolano.",
          "Devuelve únicamente JSON con esta forma exacta:",
          '{"reference":"string|null","amountBs":"string|null","paymentDate":"ISO string|null","bank":"string|null","recipientData":{"key":"value"},"confidence":"number|null"}',
          "No confirmes si el pago existe, es válido, nuevo o suficiente.",
          "Solo transcribe referencia, monto, fecha, banco y datos del receptor visibles. Si no es legible, usa null.",
          input.text ? `Texto recibido:\n${input.text}` : "",
        ].join("\n"),
      }];
      if (input.imageBase64) {
        parts.push({
          inlineData: {
            data: input.imageBase64,
            mimeType: input.imageMimeType ?? "image/jpeg",
          },
        });
      }

      const response = await client.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json" },
      });
      const parsed = extractionSchema.parse(JSON.parse(response.text ?? "{}"));
      return parsed;
    },
  };
}