import { useState } from "react";

// Imagen de producto con lazy loading y fallback con la inicial del juego
// si la URL está vacía o no carga. Mejora el rendimiento (lazy) y evita
// íconos de imagen rota en el catálogo.
export default function ProductImage({ src, alt, className = "" }) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-primary/20 via-primary/5 to-muted ${className}`}>
        <span className="text-3xl font-black text-primary/40 uppercase select-none">
          {alt?.trim()?.charAt(0) || "?"}
        </span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}