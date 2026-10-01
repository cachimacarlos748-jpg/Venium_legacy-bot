import { Ban } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// Pantalla que se muestra cuando el ID de jugador, la IP, el correo o el
// WhatsApp del cliente están en la lista negra. Impide continuar con la
// compra.
export default function BlockScreen({ block }) {
  return (
    <div className="max-w-md mx-auto mt-16 px-4 text-center">
      <div className="w-20 h-20 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-5">
        <Ban className="w-10 h-10 text-destructive" />
      </div>
      <h1 className="text-xl font-black text-foreground mb-2">Acceso restringido</h1>
      <p className="text-sm text-muted-foreground mb-1">
        Este ID o dispositivo está bloqueado y no puede realizar recargas en esta tienda.
      </p>
      {block?.reason && (
        <p className="text-xs text-muted-foreground/70 mt-2">Motivo: {block.reason}</p>
      )}
      <Link to="/" className="inline-block mt-5">
        <Button variant="outline">Volver al inicio</Button>
      </Link>
    </div>
  );
}