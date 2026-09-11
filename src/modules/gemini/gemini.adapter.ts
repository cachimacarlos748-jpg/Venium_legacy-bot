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

export interface SalesTurn {
  // The exact message the bot sends. Empty string means "stay silent".
  reply: string;
  // Deterministic side effects the backend should apply.
  action: "none" | "show_prices" | "select_package" | "handoff";
  // Normalized game the customer asked about (free_fire, blood_strike, roblox, ...).
  product: string | null;
  // 1-based package number the customer picked from the last list shown.
  selection: number | null;
  // True when a human must take over the conversation.
  handoff: boolean;
  handoffReason: string;
}

export interface SalesContextTurn {
  direction: "customer" | "bot" | "human";
  body: string;
}

// Generative sales brain: answers ANY customer question in natural language,
// sells only the store's games, and asks a closing question every time. It
// never executes payments or orders by itself: the deterministic backend keeps
// full control of quotes, antifraud and Venium. When the situation is too hard
// (complaints, refunds, security doubts, VIP customers), it hands off to a
// human through the admin panel's live chat.
export function createSalesAssistant(): {
  generate(input: {
    message: string;
    history: SalesContextTurn[];
    priceList: string;
    lastShown: string;
    pendingOrderId: string | null;
    awaiting: string;
  }): Promise<SalesTurn | null>;
} {
  let client: GoogleGenAI | null = null;
  const systemRules = [
    "Eres el vendedor de Legacy Store, una tienda venezolana de recargas de juegos por WhatsApp. Escribe como una persona real, cálida y experta en ventas: nunca como un robot ni como un manual.",
    "Estilo: mensajes BREVES con emojis del tema del juego; párrafos cortos, listas ordenadas; cierras SIEMPRE con una pregunta (¿Te lo llevo?, ¿Cuál quieres?, ¿Te ayudo con algo más?). Nunca escribas comandos en mayúsculas tipo CATÁLOGO o COMPRA 1: guía hablando normal.",
    "Solo vendemos estos juegos: Free Fire, Blood Strike y Roblox. Si preguntan por otro juego, responde que por WhatsApp solo manejas esos tres, y que el resto de juegos están disponibles en la página web https://recargaslegacystore.base44.app con entrega igual de rápida.",
    "Cuando el cliente pregunte precios, copia y adapta la lista de precios actual que te damos en el contexto; respeta los montos exactos en Bs.",
    "Nunca inventes precios, promociones, plazos de entrega ni datos de pago. El pago es por transferencia y se indica en el flujo del pedido; no des datos bancarios salvo que estén en el contexto.",
    "Si el cliente ya pagó y pregunta por su entrega, tranquílalo: la entrega es automática en minutos después de verificar el comprobante.",
    "Pasa la conversación a un humano (action handoff) cuando: haya una queja o reclamo serio, pida reembolso o devolución, acuse un problema de pago o doble cobro, sospeche de seguridad o fraude, pida hablar con una persona, sea un cliente grande o mayorista, o la pregunta esté fuera de tu alcance real.",
    "Formato de respuesta SOLO JSON: {\"reply\":\"texto exacto para WhatsApp\",\"action\":\"none|show_prices|select_package\",\"product\":\"juego normalizado o null\",\"selection\":numero_o_null,\"handoff\":true_o_false,\"handoffReason\":\"motivo corto o vacío\"}",
    "Cuando detectes que el cliente eligió un paquete concreto de la última lista mostrada (por nombre o número), usa action select_package con selection = número del paquete.",
    "Cuando el cliente pregunte precios de un juego o diga que quiere recargar un juego, usa action show_prices con product = ese juego.",
  ];

  return {
    async generate(input): Promise<SalesTurn | null> {
      if (env.GEMINI_MODE !== "live" || !env.GEMINI_API_KEY) return null;
      client ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

      const historyLines = input.history
        .slice(-14)
        .map((turn) => `${turn.direction === "customer" ? "Cliente" : turn.direction === "human" ? "Humano (tienda)" : "Vendedor"}: ${turn.body.slice(0, 400)}`)
        .join("\n");

      const prompt = [
        ...systemRules,
        "",
        "LISTA DE PRECIOS ACTUAL (fuente de verdad, no inventes montos):",
        input.priceList || "(catálogo aún no sincronizado)",
        "",
        input.lastShown ? `ÚLTIMA LISTA MOSTRADA AL CLIENTE (para interpretar 'el 2', 'ese', números):\n${input.lastShown}` : "",
        input.awaiting === "awaiting_player" ? "ESTADO: estás esperando los datos del jugador del paquete ya elegido. No vuelvas a listar precios; guía al cliente para enviar sus datos." : "",
        input.awaiting === "awaiting_receipt" ? "ESTADO: hay un pedido esperando el comprobante de pago. Recuérdale con cariño que envíe la foto del comprobante." : "",
        "",
        historyLines ? `CONVERSACIÓN PREVIA:\n${historyLines}` : "(conversación nueva)",
        "",
        `Cliente: ${input.message.slice(0, 1000)}`,
      ].filter(Boolean).join("\n");

      // Transient Gemini failures (429/503 "high demand", network blips) are
      // retried with backoff; after the last try the deterministic fallback
      // in the WhatsApp adapter takes over so the customer is never ignored.
      const attempts = 3;
      let lastError: unknown = null;
      let rawResponse: { text?: string } | null = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          rawResponse = await Promise.race([
            client.models.generateContent({
              model: env.GEMINI_MODEL,
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              config: { responseMimeType: "application/json", maxOutputTokens: 900 },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sales brain timeout")), 15_000)),
          ]);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          }
        }
      }
      if (lastError || !rawResponse) {
        return null;
      }
      try {
        const raw = JSON.parse(rawResponse.text ?? "{}") as Partial<SalesTurn>;
        const action = ["none", "show_prices", "select_package"].includes(String(raw.action)) ? (raw.action as SalesTurn["action"]) : "none";
        const selection = Number.isInteger(raw.selection) ? Number(raw.selection) : null;
        const product = typeof raw.product === "string" && raw.product.trim() ? raw.product.trim().toLowerCase() : null;
        const reply = typeof raw.reply === "string" ? raw.reply.trim() : "";
        return {
          reply,
          action,
          product,
          selection,
          handoff: raw.handoff === true,
          handoffReason: typeof raw.handoffReason === "string" ? raw.handoffReason.slice(0, 200) : "",
        };
      } catch {
        // Timeout or API hiccup: the deterministic fallback in the adapter takes over.
        return null;
      }
    },
  };
}
