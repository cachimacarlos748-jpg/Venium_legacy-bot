import { useState, useEffect } from "react";
import { Trash2, Plus, Shield, Ban } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

// Pestaña de administración para gestionar la lista negra: bloquear y
// desbloquear IDs de jugador, IPs, correos y WhatsApp.
export default function BlocklistTab() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ type: "player_id", value: "", reason: "" });

  const load = async () => {
    setLoading(true);
    try {
      const r = await base44.entities.Blocklist.list("-created_date", 500);
      setRecords(r || []);
    } catch {
      setRecords([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.value.trim()) return;
    try {
      await base44.entities.Blocklist.create({
        type: form.type,
        value: form.value.trim(),
        reason: form.reason.trim(),
      });
      setForm({ type: "player_id", value: "", reason: "" });
      load();
    } catch {}
  };

  const remove = async (id) => {
    try { await base44.entities.Blocklist.delete(id); load(); } catch {}
  };

  const typeLabel = { player_id: "ID de jugador", ip: "IP", email: "Correo", whatsapp: "WhatsApp" };
  const typeIcon = { player_id: "🎮", ip: "🌐", email: "📧", whatsapp: "📱" };

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Bloquear nuevo registro</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_1fr_auto] gap-2">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
          >
            <option value="player_id">ID de jugador</option>
            <option value="ip">IP</option>
            <option value="email">Correo</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <input
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder="Valor a bloquear (ej: 6068831320)"
            className="bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <input
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Motivo (opcional)"
            className="bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <Button onClick={add} disabled={!form.value.trim()} className="h-10">
            <Plus className="w-4 h-4" /> Bloquear
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Ban className="w-4 h-4 text-destructive" />
          <h3 className="text-sm font-bold text-foreground">Registros bloqueados ({records.length})</h3>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay registros bloqueados.</p>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <div key={r.id} className="flex items-center gap-3 bg-muted/40 border border-border/20 rounded-lg px-3 py-2.5">
                <span className="text-lg">{typeIcon[r.type]}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{r.value}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {typeLabel[r.type]}{r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <button onClick={() => remove(r.id)} className="text-destructive hover:bg-destructive/10 rounded-lg p-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}