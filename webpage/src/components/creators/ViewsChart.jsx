import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Eye } from "lucide-react";

const STATUS_COLOR = {
  pending: "#f59e0b",
  approved: "#22d3ee",
  counting: "#22d3ee",
  manual: "#fb923c",
  completed: "#22c55e",
  rejected: "#ef4444",
};

export default function ViewsChart({ videos }) {
  const data = videos.slice(0, 10).map((v, i) => ({
    name: `V${i + 1}`,
    views: v.views_current || 0,
    status: v.status,
    game: v.game,
  }));

  return (
    <div className="bg-card border border-border/20 rounded-2xl p-4">
      <p className="text-[11px] text-muted-foreground font-bold uppercase mb-3 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Vistas por video</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(val, _name, item) => [`${(val || 0).toLocaleString()} vistas`, item?.payload?.game || ""]}
          />
          <Bar dataKey="views" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={STATUS_COLOR[d.status] || "hsl(var(--primary))"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}