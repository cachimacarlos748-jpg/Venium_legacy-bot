import { useRef } from "react";
import { ClipboardPaste, Check } from "lucide-react";

// Campo de referencia bancaria al estilo del checkout del proveedor: una
// casilla por dígito, botón "Pegar" y autoavance al escribir.
//
// Por qué casillas y no un input normal: el cliente copia la referencia del
// mensaje del banco y la pega a medias, o se come un dígito. Con casillas el
// error se ve al instante y la referencia entra completa.
//
// OJO con la longitud: el proveedor pide "últimos 6 dígitos", pero nuestro bot
// verifica la referencia COMPLETA (6 a 9 dígitos). Por eso el número de
// casillas crece con lo que se escribe: empieza en 6 y llega hasta 9.
export default function ReferenceField({ value = "", onChange, autoFocus = false, label = "Referencia bancaria" }) {
  const inputRef = useRef(null);
  const digits = String(value || "");
  // 6 casillas mínimo; si el banco generó más dígitos, se agregan.
  const cells = Math.max(6, Math.min(9, digits.length));

  const handleInput = (e) => {
    onChange(e.target.value.replace(/\D/g, "").slice(0, 9));
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const clean = String(text || "").replace(/\D/g, "").slice(0, 9);
      if (clean) { onChange(clean); return; }
    } catch {}
    // Sin permiso de portapapeles (o vacío): dejamos el cursor listo para pegar.
    inputRef.current?.focus();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <label className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.14em]">
          {label} <span className="text-destructive">*</span>
        </label>
        <button
          type="button"
          onClick={paste}
          className="tap inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded-lg px-2.5 py-1.5 hover:bg-amber-500/20 transition-colors"
        >
          <ClipboardPaste className="w-3.5 h-3.5" /> Pegar
        </button>
      </div>

      <div className="relative" onClick={() => inputRef.current?.focus()}>
        <div className="flex gap-2 justify-between">
          {Array.from({ length: cells }).map((_, i) => {
            const filled = i < digits.length;
            const active = i === digits.length;
            return (
              <div
                key={i}
                className={`flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-black num transition-all
                  ${filled
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : active
                    ? "border-primary bg-primary/10 text-foreground glow-primary"
                    : "border-border bg-muted/40 text-muted-foreground"}`}
              >
                {filled ? digits[i] : ""}
              </div>
            );
          })}
        </div>

        {/* Input real: invisible pero accesible (teclado, dictado, gestor de contraseñas). */}
        <input
          ref={inputRef}
          value={digits}
          onChange={handleInput}
          autoFocus={autoFocus}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={label}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        El número que generó tu banco al hacer la transferencia (6 a 9 dígitos).
      </p>
    </div>
  );
}

// Declaración jurada que el proveedor pide antes de verificar: deja claro que
// la cuenta de origen es del cliente y nos cubre ante un pago de terceros.
export function LegalDeclaration({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`tap w-full flex items-start gap-3 text-left rounded-xl border p-3.5 transition-colors
        ${checked ? "border-emerald-500/50 bg-emerald-500/5" : "border-border bg-muted/30 hover:border-primary/50"}`}
    >
      <span
        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors
          ${checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/60"}`}
      >
        {checked && <Check className="w-3.5 h-3.5 text-black" strokeWidth={4} />}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">
        Declaro bajo juramento legal que soy mayor de edad y titular de la cuenta bancaria de origen,
        o que poseo <span className="text-foreground font-bold">autorización expresa</span> del titular.
      </span>
    </button>
  );
}
