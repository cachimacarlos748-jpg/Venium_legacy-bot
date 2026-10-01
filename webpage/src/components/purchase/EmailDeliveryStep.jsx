import { Mail } from "lucide-react";

// Paso de correo de entrega para productos que se entregan por email (ej:
// Roblox). Mobentas envía el código a este correo, no a un ID de juego.
export default function EmailDeliveryStep({ email, setEmail, slug }) {
  const label = slug === "roblox" ? "Roblox" : "el producto";
  return (
    <div>
      <label className="text-xs text-muted-foreground font-medium mb-1.5 block">
        Correo para recibir tu código
      </label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tucorreo@ejemplo.com"
        className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
      />
      <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
        <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary/70" />
        <span>
          Tu código de {label} será enviado a este correo. Asegúrate de
          escribirlo bien, ya que no se puede cambiar después.
        </span>
      </p>
    </div>
  );
}