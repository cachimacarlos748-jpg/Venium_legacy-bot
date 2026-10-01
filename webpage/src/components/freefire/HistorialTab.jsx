import { useState, useEffect } from "react";
import { Loader2, History, ExternalLink, CheckCircle2, XCircle, Clock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { NexusBot, hasConfig } from "@/lib/nexusBotClient";

const R = base44.entities.RechargeRecord;

export default function HistorialTab() {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRecs(await R.list("-created_date", 100).catch(() => []));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const src = hasConfig() ? NexusBot.historialUrl() : null;

  return (
    <div className="space-y-5">
      {/* Registro interno */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Registro interno del panel</h3>
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">control de IDs</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>
        ) : recs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Clock className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Sin recargas registradas todavía.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/20">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  {["Fecha", "Player ID", "Producto", "Tipo", "Estado", "Tx ID"].map((h) => (
                    <th key={h} className="text-left font-semibold px-3.5 py-2.5 uppercase tracking-wide text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.id} className="border-t border-border/10 hover:bg-muted/20 transition-colors">
                    <td className="px-3.5 py-2.5 text-muted-foreground whitespace-nowrap">{new Date(r.created_date).toLocaleString()}</td>
                    <td className="px-3.5 py-2.5 font-mono text-foreground">{r.player_id}</td>
                    <td className="px-3.5 py-2.5 text-foreground">{r.producto_nombre || r.producto}</td>
                    <td className="px-3.5 py-2.5 text-muted-foreground">{r.producto_tipo}</td>
                    <td className="px-3.5 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === "completed" ? "bg-green-500/10 text-green-400" : r.status === "failed" ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
                        {r.status === "completed" ? <CheckCircle2 className="w-3 h-3" /> : r.status === "failed" ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-muted-foreground text-[10px]">{r.tx_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historial del bot */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ExternalLink className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Historial del bot</h3>
        </div>
        {src ? (
          <div className="rounded-2xl overflow-hidden border border-border/20 h-[480px] bg-card">
            <iframe src={src} title="Historial NEXUS Bot" className="w-full h-full" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ExternalLink className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Configura el bot en 'Config Bot' para ver el historial.</p>
          </div>
        )}
      </div>
    </div>
  );
}