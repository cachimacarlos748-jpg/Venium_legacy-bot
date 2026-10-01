import { useState } from "react";

// Imagen de producto con lazy loading y fallback con la inicial del juego
// si la URL está vacía o no carga. Mejora el rendimiento (lazy) y evita
// íconos de imagen rota en el catálogo.

// Algunos servidores de imágenes (mobentas.com, googleusercontent.com)
// bloquean hotlinking: devuelven 403/400 cuando la imagen no se pide desde
// SU dominio. Las pedimos a través de images.weserv.nl (proxy de imágenes
// gratuito, sin registro, cachea y re-sirve cualquier imagen pública).
function proxied(src) {
  if (!src || !src.startsWith("http")) return src;
  if (src.includes("weserv.nl") || src.includes("base44")) return src;
  return `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=400&output=webp`;
}

export default function ProductImage({ src, alt, className = "" }) {
  const [failed, setFailed] = useState(!src);
  const [current, setCurrent] = useState(() => proxied(src));
  const [attempt, setAttempt] = useState(0);

  if (failed || !src) {
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
      src={current}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (attempt === 0) {
          // 2do intento: la URL original sin proxy
          setAttempt(1);
          setCurrent(src);
        } else {
          setFailed(true);
        }
      }}
      className={className}
    />
  );
}
