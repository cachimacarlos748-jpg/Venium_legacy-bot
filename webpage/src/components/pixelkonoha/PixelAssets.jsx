// Pixel Konoha — Assets pixel art originales en SVG (sin artwork oficial)
// Todos usan shapeRendering="crispEdges" para el look 8-bit pixelado.

const crisp = { shapeRendering: "crispEdges" };

// ===== Hojas de arce pixel art — siluetas con lóbulos, contorno oscuro, otoño =====

// Hoja de arce (maple) — 5 lóbulos puntiagudos, contorno oscuro, tallo y nervaduras
const MAPLE_PATH = "M12 2 L15 6 L13 8 L19 5 L17 9 L22 11 L16 12 L19 17 L13 15 L13 19 L12 17 L11 19 L11 15 L5 17 L8 12 L2 11 L7 9 L5 5 L11 8 L9 6 Z";

// Hoja oval/lanceolada — punta simple
const OVAL_PATH = "M12 2 L16 7 L17 12 L12 19 L7 12 L8 7 Z";

const LEAF_PATHS = { maple: MAPLE_PATH, oval: OVAL_PATH };

// Paletas de otoño (colores de la imagen de referencia)
const LEAF_COLORS = {
  green:  { fill: "#6a9a3b", shade: "#3c5e26" },
  yellow: { fill: "#fcc63d", shade: "#e5b328" },
  orange: { fill: "#f17a26", shade: "#d16b1f" },
  red:    { fill: "#b3452f", shade: "#8e3626" },
  brown:  { fill: "#9e7e59", shade: "#644a2c" },
};

const OUTLINE = "#2b1f1a";
const STEM_COLOR = "#543e2d";

// Hoja pixel art — silueta de arce u ovalada con contorno, tallo y nervaduras
export function KonohaLeaf({ size = 28, type = "maple", color = "green", className = "" }) {
  const path = LEAF_PATHS[type] || LEAF_PATHS.maple;
  const pal = LEAF_COLORS[color] || LEAF_COLORS.green;
  const isMaple = type === "maple";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} shapeRendering="crispEdges" aria-hidden>
      {/* Tallo */}
      <rect x="11" y="17" width="2" height="5" fill={STEM_COLOR} stroke={OUTLINE} strokeWidth="0.5" />
      {/* Cuerpo de la hoja */}
      <path d={path} fill={pal.fill} stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="miter" strokeLinecap="square" />
      {/* Nervadura central */}
      <line x1="12" y1="4" x2="12" y2="16" stroke={pal.shade} strokeWidth="1" opacity="0.7" />
      {isMaple && (
        <>
          {/* Nervaduras laterales hacia los lóbulos */}
          <line x1="12" y1="9" x2="6" y2="7" stroke={pal.shade} strokeWidth="0.6" opacity="0.5" />
          <line x1="12" y1="9" x2="18" y2="7" stroke={pal.shade} strokeWidth="0.6" opacity="0.5" />
          <line x1="12" y1="12" x2="6" y2="14" stroke={pal.shade} strokeWidth="0.6" opacity="0.5" />
          <line x1="12" y1="12" x2="18" y2="14" stroke={pal.shade} strokeWidth="0.6" opacity="0.5" />
        </>
      )}
    </svg>
  );
}

// Abanico Uchiha — clan fan (rojo/blanco)
export function UchihaFan({ size = 24, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...crisp} aria-hidden>
      {/* Marco del abanico */}
      <circle cx="12" cy="10" r="8" fill="none" stroke="#B0B8BC" strokeWidth="1.5" />
      {/* Mitad superior roja */}
      <path d="M4 10 A8 8 0 0 1 20 10 L12 10 Z" fill="#DC2626" stroke="#B0B8BC" strokeWidth="1" />
      {/* Línea divisoria horizontal */}
      <line x1="4" y1="10" x2="20" y2="10" stroke="#B0B8BC" strokeWidth="1.5" />
      {/* Mango */}
      <rect x="11" y="18" width="2" height="5" fill="#8B6F47" />
    </svg>
  );
}

// Sprite de ninja pixelado (estilo sensei — headband + pelo plata + máscara)
export function NinjaSprite({ size = 96, className = "" }) {
  return (
    <svg viewBox="0 0 32 40" width={size} height={size * 1.25} className={className} {...crisp} aria-hidden>
      {/* Pelo plata (Kakashi) — picos */}
      <g fill="#B0B8BC">
        <rect x="8" y="4" width="3" height="2" />
        <rect x="11" y="2" width="3" height="3" />
        <rect x="14" y="1" width="4" height="3" />
        <rect x="18" y="2" width="3" height="3" />
        <rect x="21" y="4" width="3" height="2" />
        <rect x="6" y="6" width="3" height="3" />
        <rect x="23" y="6" width="3" height="3" />
      </g>
      {/* Cara */}
      <rect x="8" y="8" width="16" height="12" fill="#E8C9A0" />
      {/* Headband negra */}
      <rect x="7" y="9" width="18" height="4" fill="#1a1a1a" />
      {/* Placa metalica del headband */}
      <rect x="12" y="10" width="8" height="3" fill="#C0C8CC" stroke="#8A9296" strokeWidth="0.5" />
      {/* Símbolo en la placa (linea + espiral simple) */}
      <rect x="14" y="11" width="4" height="1" fill="#5A6266" />
      {/* Ojo visible */}
      <rect x="18" y="14" width="2" height="2" fill="#1a1a1a" />
      {/* Ojo cerrado/parpadeo (linea) */}
      <rect x="12" y="14" width="3" height="1" fill="#1a1a1a" />
      {/* Mascara inferior (negra) */}
      <rect x="8" y="17" width="16" height="3" fill="#1a1a1a" />
      {/* Cuello */}
      <rect x="12" y="20" width="8" height="3" fill="#E8C9A0" />
      {/* Traje naranja */}
      <rect x="7" y="23" width="18" height="12" fill="#FF8C00" />
      {/* Cremallera/linea central */}
      <rect x="15" y="23" width="2" height="12" fill="#CC7000" />
      {/* Cuello del traje */}
      <rect x="11" y="22" width="10" height="2" fill="#F59E0B" />
      {/* Brazos */}
      <rect x="4" y="24" width="3" height="9" fill="#FF8C00" />
      <rect x="25" y="24" width="3" height="9" fill="#FF8C00" />
      {/* Puños */}
      <rect x="4" y="33" width="3" height="2" fill="#E8C9A0" />
      <rect x="25" y="33" width="3" height="2" fill="#E8C9A0" />
    </svg>
  );
}

// Sello de chakra — circulo magico con espiral (para celebracion post-recarga)
export function ChakraSeal({ size = 160, color = "#FF8C00", className = "" }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} {...crisp} aria-hidden>
      {/* Anillo exterior */}
      <circle cx="50" cy="50" r="46" fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
      {/* Anillo medio */}
      <circle cx="50" cy="50" r="36" fill="none" stroke="#F59E0B" strokeWidth="1.5" />
      {/* Marcas cardinales (puntos pixelados) */}
      <g fill={color}>
        <rect x="48" y="2" width="4" height="6" />
        <rect x="48" y="92" width="4" height="6" />
        <rect x="2" y="48" width="6" height="4" />
        <rect x="92" y="48" width="6" height="4" />
      </g>
      {/* Marcas diagonales */}
      <g fill="#F59E0B">
        <rect x="18" y="18" width="4" height="4" transform="rotate(45 20 20)" />
        <rect x="78" y="18" width="4" height="4" transform="rotate(45 80 20)" />
        <rect x="18" y="78" width="4" height="4" transform="rotate(45 20 80)" />
        <rect x="78" y="78" width="4" height="4" transform="rotate(45 80 80)" />
      </g>
      {/* Espiral central */}
      <path
        d="M50 50 L56 50 L56 44 L44 44 L44 56 L62 56 L62 38 L38 38 L38 62 L68 62"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="square"
      />
      {/* Punto central brillante */}
      <rect x="48" y="48" width="4" height="4" fill="#FFD700" />
    </svg>
  );
}

// Espiral de Konoha — ornamento pequeño (para titulos)
export function KonohaSpiral({ size = 20, color = "#FF8C00", className = "" }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} {...crisp} aria-hidden>
      <path
        d="M10 10 L14 10 L14 6 L6 6 L6 14 L18 14 L18 2 L2 2"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="square"
      />
      <rect x="9" y="9" width="2" height="2" fill={color} />
    </svg>
  );
}