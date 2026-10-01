import { Video, Eye, Trophy, Wallet, DollarSign, Users } from "lucide-react";
import ViewsChart from "@/components/creators/ViewsChart";

export default function SummaryTab({ videos, creator }) {
  const total = videos.reduce((s, v) => s + (v.views_current || 0), 0);
  const best = videos.reduce((b, v) => (!b || (v.views_current || 0) > (b.views_current || 0) ? v : b), null);
  const rewards = videos.filter((v) => v.status === "completed" && v.reward_tier && v.reward_tier !== "none");
  const balance = creator?.balance || 0;
  const codeUses = creator?.total_code_uses || 0;

  return (
    <div className="space-y-4">
      {/* Comisión por código — destacada */}
      {(creator?.code || balance > 0) && (
        <div className="bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-primary" />
            <p className="text-[11px] text-muted-foreground font-bold uppercase">Comisiones por código</p>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-2xl font-black text-primary leading-tight">{balance.toFixed(2)} Bs</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{codeUses} {codeUses === 1 ? "persona usó" : "personas usaron"} tu código</p>
            </div>
            {creator?.code && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase">Código</p>
                <p className="text-lg font-black text-primary">{creator.code}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Video} label="Videos enviados" value={videos.length} />
        <StatCard icon={Eye} label="Vistas totales" value={total.toLocaleString()} />
        <StatCard icon={Trophy} label="Mejor video" value={best ? `${(best.views_current || 0).toLocaleString()} vistas` : "—"} sub={best ? best.game : ""} />
        <StatCard icon={Wallet} label="Recompensas" value={rewards.length} />
      </div>

      {videos.length > 0 && <ViewsChart videos={videos} />}

      {best && (
        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <p className="text-[11px] text-muted-foreground font-bold uppercase mb-2 flex items-center gap-1"><Trophy className="w-3.5 h-3.5" /> Mejor video</p>
          <a href={best.tiktok_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-foreground hover:underline truncate block">{best.tiktok_url}</a>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2">
            <span>{best.game}</span><span>·</span><span>{(best.views_current || 0).toLocaleString()} vistas</span>
            {best.reward_tier && best.reward_tier !== "none" && <><span>·</span><span className="text-primary font-bold">{best.reward_label}</span></>}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-card border border-border/20 rounded-2xl p-4">
      <Icon className="w-4 h-4 text-primary mb-2" />
      <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
      <p className="text-lg font-black text-foreground leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}