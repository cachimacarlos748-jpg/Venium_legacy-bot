import { useState, useEffect } from "react";
import { Gift, Plus, Trash2, Power, Copy, Loader2, Check, CheckCircle2, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { BOT_PRODUCT_KEYS } from "@/lib/nexusProducts";

// Etiquetas claras: cada código = UN solo premio. Sin "Pase Booyah — Tarjeta X"
// que confunde y parece que fueran dos premios.
const PRIZE_LABELS = {
  basica:  "Tarjeta Básica",
  semanal: "Tarjeta Semanal",
  mensual: "Tarjeta Mensual",
  booyah:  "Pase Booyah",
  nivel6:  "Paquete Nivel 6",
  nivel10: "Paquete Nivel 10",
  nivel15: "Paquete Nivel 15",
  nivel20: "Paquete Nivel 20",
  nivel25: "Paquete Nivel 25",
  nivel30: "Paquete Nivel 30",
};

function generateCode(prefix = "LEGACY") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${c}`;
}

export default function PrizeCodesTab() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(null);

  // Form state
  const [mode, setMode] = useState("single"); // single | bulk
  const [customCode, setCustomCode] = useState("");
  const [bulkCount, setBulkCount] = useState(5);
  const [botProduct, setBotProduct] = useState("mensual");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresDate, setExpiresDate] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    try {
      const list = await base44.entities.PrizeCode.list("-created_date", 200);
      setCodes(list || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const prizeLabel = PRIZE_LABELS[botProduct];
      if (!prizeLabel) return;
      const base = {
        bot_product: botProduct,
        prize_label: prizeLabel,
        max_uses: Number(maxUses) || 1,
        used_count: 0,
        status: "active",
        expires_date: expiresDate || undefined,
        notes: notes || "",
        redemption_log: [],
      };

      if (mode === "single") {
        const code = (customCode || generateCode()).trim().toUpperCase();
        const existing = await base44.entities.PrizeCode.filter({ code });
        if (existing?.length) { alert("Ese código ya existe"); return; }
        await base44.entities.PrizeCode.create({ ...base, code });
      } else {
        const count = Math.min(Number(bulkCount) || 5, 50);
        const records = [];
        for (let i = 0; i < count; i++) {
          records.push({ ...base, code: generateCode() });
        }
        await base44.entities.PrizeCode.bulkCreate(records);
      }
      setCustomCode(""); setNotes(""); setMaxUses(1); setExpiresDate("");
      await load();
    } catch (e) {
      alert("Error: " + (e.message || "no se pudo crear"));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(id, currentStatus) {
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    await base44.entities.PrizeCode.update(id, { status: newStatus });
    await load();
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este código?")) return;
    await base44.entities.PrizeCode.delete(id);
    await load();
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  const statusColor = (s) => ({
    active: "text-green-400 bg-green-400/10",
    exhausted: "text-yellow-400 bg-yellow-400/10",
    disabled: "text-red-400 bg-red-400/10",
  }[s] || "text-muted-foreground bg-muted");

  // Agregamos todos los canjes de todos los códigos en una sola lista ordenada.
  const allRedemptions = codes
    .flatMap((c) => (c.redemption_log || []).map((r) => ({
      prize: c.prize_label,
      botProduct: c.bot_product,
      code: c.code,
      nickname: r.nickname || "",
      playerId: r.player_id || "",
      timestamp: r.timestamp || "",
      result: r.result || "",
    })))
    .filter((r) => r.playerId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="bg-card rounded-xl border border-border/30 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Gift className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-foreground">Crear código de premio</h2>
        </div>

        <div className="flex gap-1 mb-4 p-1 bg-muted rounded-lg w-fit text-xs">
          <button onClick={() => setMode("single")} className={`px-3 py-1.5 rounded-md font-medium ${mode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            Código único
          </button>
          <button onClick={() => setMode("bulk")} className={`px-3 py-1.5 rounded-md font-medium ${mode === "bulk" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            Generar lote
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mode === "single" ? (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Código</label>
              <div className="flex gap-2">
                <input
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                  placeholder="LEGACY-XXXXXX"
                  className="flex-1 bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    const existing = new Set(codes.map((c) => c.code));
                    let c = "";
                    do { c = generateCode(); } while (existing.has(c));
                    setCustomCode(c);
                  }}
                  className="flex items-center gap-1.5 bg-primary/15 hover:bg-primary/25 text-primary rounded-lg px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Generar
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cantidad (máx 50)</label>
              <input
                type="number"
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
                min={1}
                max={50}
                className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Premio (producto del bot)</label>
            <select
              value={botProduct}
              onChange={(e) => setBotProduct(e.target.value)}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              {BOT_PRODUCT_KEYS.map((k) => (
                <option key={k} value={k}>{PRIZE_LABELS[k]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Límite de usos (1 = único)</label>
            <input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              min={1}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Expira (opcional)</label>
            <input
              type="date"
              value={expiresDate}
              onChange={(e) => setExpiresDate(e.target.value)}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Notas (opcional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Sorteo del live del 15/08"
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <Button onClick={handleCreate} disabled={creating} className="mt-4 w-full sm:w-auto">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {mode === "single" ? "Crear código" : `Generar ${bulkCount} códigos`}
        </Button>
      </div>

      {/* Codes list */}
      <div>
        <h2 className="font-bold text-foreground mb-3">Códigos creados ({codes.length})</h2>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : codes.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No hay códigos. Crea el primero arriba.</div>
        ) : (
          <div className="space-y-2">
            {codes.map((c) => {
              const expired = c.expires_date && new Date(c.expires_date) < new Date();
              const exhausted = c.used_count >= c.max_uses;
              const effectiveStatus = expired ? "disabled" : exhausted && c.status === "active" ? "exhausted" : c.status;
              return (
                <div key={c.id} className="bg-card rounded-lg border border-border/30 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold text-foreground tracking-wider">{c.code}</code>
                      <button onClick={() => copyCode(c.code)} className="text-muted-foreground hover:text-primary">
                        {copied === c.code ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusColor(effectiveStatus)}`}>
                      {effectiveStatus === "active" ? "Activo" : effectiveStatus === "exhausted" ? "Agotado" : "Deshabilitado"}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.prize_label}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {c.used_count}/{c.max_uses} usos
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => handleToggle(c.id, c.status)} className="p-1.5 text-muted-foreground hover:text-yellow-400 rounded transition-colors" title={c.status === "active" ? "Deshabilitar" : "Activar"}>
                        <Power className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 text-muted-foreground hover:text-red-400 rounded transition-colors" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {c.redemption_log?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/20 space-y-1">
                      {c.redemption_log.slice(-3).map((r, i) => (
                        <div key={i} className="text-xs text-muted-foreground flex gap-2">
                          <span className="text-foreground/70">ID: {r.player_id}</span>
                          {r.nickname && <span>· {r.nickname}</span>}
                          <span>· {r.result === "ok" ? "✅" : "❌"}</span>
                          <span className="ml-auto">{new Date(r.timestamp).toLocaleDateString("es-VE")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historial de canjes — estilo Nexus */}
      <div>
        <h2 className="font-bold text-foreground mb-3">Historial de canjes ({allRedemptions.length})</h2>
        {allRedemptions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm bg-card rounded-xl border border-border/30">
            Aún no se han canjeado códigos.
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
            {/* Headers */}
            <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-2 px-4 py-3 border-b border-border/20 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Premio</span>
              <span>Estado</span>
              <span>Canjeado por</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-border/15">
              {allRedemptions.slice(0, 100).map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr] gap-2 px-4 py-3 items-center">
                  {/* PREMIO */}
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="text-sm font-bold text-green-400">{r.prize}</span>
                    <span className="text-base leading-none">💎</span>
                  </div>
                  {/* ESTADO */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded bg-green-400/20 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    </span>
                    <span className="text-sm text-foreground">canjeado</span>
                  </div>
                  {/* CANJEADO POR */}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-bold text-foreground truncate">{r.nickname || "Jugador"}</span>
                    <span className="text-xs text-blue-400 flex items-center gap-1.5">
                      <span>{r.playerId}</span>
                      {r.timestamp && (
                        <>
                          <span className="text-muted-foreground/50">·</span>
                          <span className="text-muted-foreground">
                            {new Date(r.timestamp).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" })}{" "}
                            {new Date(r.timestamp).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}