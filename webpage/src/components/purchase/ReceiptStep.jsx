import { useState } from "react";
import { Upload, Loader2, ShieldCheck, X } from "lucide-react";
import { uploadImage } from "@/lib/receiptUploadClient";

// Sube el comprobante (opcional) y devuelve la URL resultante.
// Usa el Cloudflare Worker → catbox.moe (gratis, sin créditos ni Telegram).
// Respaldo: UploadFile de Base44 si el proxy no está configurado.
export function useReceiptUpload() {
  const [receiptUrl, setReceiptUrl] = useState("");
  const [receiptB64, setReceiptB64] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setFileName(file.name);
    try {
      const { url, b64 } = await uploadImage(file);
      if (url) setReceiptUrl(url);
      if (b64) setReceiptB64(b64);
    } catch (e) {
      console.error("[receipt] subida fallida:", e?.message || e);
    }
    setUploading(false);
  };

  const clear = () => { setReceiptUrl(""); setReceiptB64(""); setFileName(""); };

  return { receiptUrl, receiptB64, uploading, fileName, upload, clear };
}

export default function ReceiptStep({ email, setEmail, bankRef, setBankRef, receipt, onVerify, verifying, verifyErr, total, currency }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Número de referencia</label>
        <input
          inputMode="numeric"
          value={bankRef}
          onChange={(e) => setBankRef(e.target.value.replace(/\D/g, "").slice(0, 9))}
          placeholder="6 a 9 dígitos"
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground font-mono tracking-wide focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">El número de referencia que generó tu banco al hacer el pago.</p>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Comprobante (opcional, recomendado)</label>
        {receipt.receiptUrl ? (
          <div className="flex items-center justify-between bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm">
            <span className="text-foreground truncate">{receipt.fileName || "Comprobante adjuntado"}</span>
            <button onClick={receipt.clear} className="text-destructive hover:bg-destructive/10 rounded p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 cursor-pointer bg-muted border border-dashed border-border/40 rounded-lg px-3 py-3 text-sm text-muted-foreground hover:border-primary transition-colors">
            {receipt.uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {receipt.uploading ? "Subiendo..." : "Adjuntar imagen del comprobante"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && receipt.upload(e.target.files[0], ` · Ref: ${bankRef || "—"} · ${email || "—"}`)}
            />
          </label>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Correo electrónico</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <p className="text-xs text-muted-foreground mt-1">Haremos llegar tu recarga y el comprobante a este correo.</p>
      </div>

      {verifyErr && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{verifyErr}</div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="text-sm">
          <span className="text-muted-foreground">Total a pagar: </span>
          <span className="text-foreground font-bold">{total.toFixed(2)} {currency}</span>
        </div>
        <button
          onClick={onVerify}
          disabled={verifying || !/^\d{6,9}$/.test(bankRef) || !email.includes("@")}
          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {verifying ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando pago...</> : <><ShieldCheck className="w-4 h-4" /> Verificar pago</>}
        </button>
      </div>
    </div>
  );
}