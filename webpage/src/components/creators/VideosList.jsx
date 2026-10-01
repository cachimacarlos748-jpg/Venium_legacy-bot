import { Eye, Star, Wallet } from "lucide-react";
import SubmitVideoForm from "@/components/creators/SubmitVideoForm";

const STATUS_MAP = {
  pending: { label: "En revisión", color: "text-amber-400 bg-amber-500/15" },
  approved: { label: "Aprobado", color: "text-cyan-300 bg-cyan-500/15" },
  counting: { label: "Contando vistas", color: "text-cyan-300 bg-cyan-500/15" },
  manual: { label: "Esperando tu captura", color: "text-orange-300 bg-orange-500/15" },
  completed: { label: "Recompensa entregada", color: "text-green-300 bg-green-500/15" },
  rejected: { label: "Rechazado", color: "text-red-400 bg-red-500/15" },
};

export default function VideosList({ videos, creator, onRefresh }) {
  return (
    <div className="space-y-3">
      <SubmitVideoForm creator={creator} videos={videos} onSubmitted={onRefresh} />
      {videos.length === 0 ? (
        <div className="bg-card border border-border/20 rounded-2xl p-6 text-center">
          <p className="text-sm text-muted-foreground">Sin videos todavía. Sube tu primer video arriba.</p>
        </div>
      ) : (
        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <p className="text-[11px] text-muted-foreground font-bold uppercase mb-3">Mis videos</p>
          <div className="space-y-2">{videos.map((v) => <VideoRow key={v.id} v={v} />)}</div>
        </div>
      )}
    </div>
  );
}

function VideoRow({ v }) {
  const s = STATUS_MAP[v.status] || STATUS_MAP.pending;
  const daysOld = Math.floor((Date.now() - new Date(v.created_date).getTime()) / 86400e3);
  return (
    <div className="bg-muted/40 border border-border/10 rounded-lg p-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="text-xs min-w-0">
          <a href={v.tiktok_url} target="_blank" rel="noreferrer" className="font-bold text-foreground truncate max-w-[240px] block hover:underline">{v.tiktok_url}</a>
          <div className="text-muted-foreground">{v.game} · ID {v.game_id}</div>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${s.color}`}>{s.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> {(v.views_current || 0).toLocaleString()} vistas</span>
        <span className="flex items-center gap-1.5"><Star className="w-3.5 h-3.5" /> Día {Math.min(daysOld, 7) + 1}/7</span>
        {v.reward_tier && v.reward_tier !== "none" && <span className="flex items-center gap-1.5 text-primary font-bold"><Wallet className="w-3.5 h-3.5" /> {v.reward_label}</span>}
      </div>
      {v.status === "manual" && <p className="mt-2 text-orange-300 text-xs">El sistema no pudo leer tus vistas. Sube una captura del video en tu TikTok y contáctanos por WhatsApp — lo validamos manualmente.</p>}
    </div>
  );
}