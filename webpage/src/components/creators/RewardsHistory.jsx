import { Wallet, Trophy } from "lucide-react";

export default function RewardsHistory({ videos }) {
  const rewards = videos.filter((v) => v.status === "completed" && v.reward_tier && v.reward_tier !== "none");

  if (rewards.length === 0) {
    return (
      <div className="bg-card border border-border/20 rounded-2xl p-6 text-center">
        <Trophy className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Aún no has ganado recompensas. Sigue subiendo videos con <span className="text-primary font-bold">#legacystorevzl</span> para alcanzar tus primeras recompensas.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/20 rounded-2xl p-4">
      <p className="text-[11px] text-muted-foreground font-bold uppercase mb-3 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Historial de recompensas</p>
      <div className="space-y-2">
        {rewards.map((r) => (
          <div key={r.id} className="flex justify-between items-center bg-muted/40 rounded-lg px-3 py-2.5 text-xs">
            <div>
              <p className="text-foreground font-bold">{r.game}</p>
              <p className="text-muted-foreground">{(r.views_current || 0).toLocaleString()} vistas · {new Date(r.created_date).toLocaleDateString()}</p>
            </div>
            <span className="text-primary font-bold">{r.reward_label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}