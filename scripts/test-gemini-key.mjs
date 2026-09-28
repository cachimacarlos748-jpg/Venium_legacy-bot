// Validates a Gemini API key without printing it: node scripts/test-gemini-key.mjs "<key>"
// Exit code 0 = key works; 1 = invalid/quota/model error.
import { GoogleGenAI } from "@google/genai";

const key = process.argv[2] ?? "";
if (!key) {
  console.error("usage: node scripts/test-gemini-key.mjs <key>");
  process.exit(2);
}
const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const client = new GoogleGenAI({ apiKey: key });
let anyOk = false;
for (const model of models) {
  try {
    const res = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: "Responde únicamente con la palabra: OK" }] }],
    });
    console.log(`✅ ${model}: ${String(res.text ?? "").trim().slice(0, 40)}`);
    anyOk = true;
  } catch (err) {
    const msg = String(err?.message ?? err).slice(0, 200);
    console.log(`❌ ${model}: ${msg}`);
  }
}
process.exit(anyOk ? 0 : 1);
