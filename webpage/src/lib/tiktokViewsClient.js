// Cliente gratuito para leer las vistas de un video de TikTok.
// Estrategia en 2 capas (sin costos, sin keys):
//   1) tikwm.com (API pública) — devuelve play_count en JSON.
//   2) Respaldo: api.douyin.wtf (similar, formato minimal).
// Si ambos fallan, devuelve ok:false y el video se marca para
// validación manual con captura del creador.

const SOURCES = [
  {
    name: "tikwm",
    url: (u) => `https://www.tikwm.com/api/?url=${encodeURIComponent(u)}`,
    parse: (d) => Number(d?.data?.play_count ?? 0),
  },
  {
    name: "douyin",
    url: (u) => `https://api.douyin.wtf/api?url=${encodeURIComponent(u)}&minimal=true`,
    parse: (d) => Number(d?.data?.play_count ?? d?.play_count ?? 0),
  },
];

export async function fetchTikTokViews(url) {
  if (!url || !/tiktok\.com/i.test(url)) {
    return { ok: false, error: "La URL no parece de TikTok." };
  }
  let lastErr = "";
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url(url), { headers: { Accept: "application/json" } });
      if (!r.ok) { lastErr = `HTTP ${r.status} (${s.name})`; continue; }
      const data = await r.json();
      const views = s.parse(data);
      if (views > 0) return { ok: true, views, source: s.name };
      lastErr = `Sin vistas reportadas (${s.name}).`;
    } catch (e) {
      lastErr = `${s.name}: ${e?.message || "error de red"}`;
    }
  }
  return { ok: false, error: lastErr || "Fallo técnico." };
}