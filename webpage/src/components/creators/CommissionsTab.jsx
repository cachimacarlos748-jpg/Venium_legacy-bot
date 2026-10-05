import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, Users, Copy, Check, Clock, DollarSign, ArrowDownToLine, Hash, Edit3, Save, X, Sparkles, AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { getCommissionConfig, setCreatorCode, DEFAULT_PAYOUT_THRESHOLD } from "@/lib/creatorCommission";
import WithdrawalModal from "@/components/creators/WithdrawalModal";

export default function CommissionsTab({ creator, onRefresh }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_PAYOUT_THRESHOLD);
  const [discountPct, setDiscountPct] = useState(2);

  // Code editing
  const [editingCode, setEditingCode] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [codeErr, setCodeErr] = useState("");
  const [withdrawErr, setWithdrawErr] = useState("");

  useEffect(() => {
    getCommissionConfig().then((cfg) => {
      setThreshold(cfg.threshold || DEFAULT_PAYOUT_THRESHOLD);
      setDiscountPct(cfg.discount_percent || 2);
    }).catch(() => {});
  }, []);

  const balance = creator?.balance || 0;
  const totalUses = creator?.total_code_uses || 0;
  const commissionLog = creator?.commission_log || [];
  const payoutLog = creator?.payout_log || [];
  const withdrawalRequests = creator?.withdrawal_requests || [];
  const totalEarned = commissionLog
    .filter((c) => c.status === "pending" || c.status === "paid")
    .reduce((s, c) => s + (c.commission || 0), 0);
  const totalPaid = payoutLog.reduce((s, p) => s + (p.amount || 0), 0);
  const pendingWithdrawals = withdrawalRequests.filter((r) => r.status === "pending");
  const canWithdraw = balance >= threshold && pendingWithdrawals.length === 0;
  const isApproved = creator?.status === "approved";

  const copyCode = () => {
    if (!creator?.code) return;
    navigator.clipboard.writeText(creator.code);
    setCopied(true);
    toast({ title: "Código copiado ✓" });
    setTimeout(() => setCopied(false), 1500);
  };

  const shareCode = () => {
    if (!creator?.code) return;
    const text = `¡Usa mi código ${creator.code} en Vex Store y obtén ${discountPct}% de descuento en tu recarga! 🎮💎`;
    if (navigator.share) {
      navigator.share({ title: "Mi código de Vex Store", text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "Mensaje copiado ✓", description: "Pégalo en tus redes" });
    }
  };

  const saveCode = async () => {
    setCodeErr("");
    if (!creator?.id) {
      setCodeErr("No se encontró tu perfil de creador. Recarga la página o verifica que tu correo coincida con el que usaste al postular.");
      return;
    }
    setSavingCode(true);
    try {
      await setCreatorCode(creator.id, codeInput);
      toast({ title: "Código guardado ✓", description: `Tu código ${codeInput.toUpperCase()} ya está activo` });
      setEditingCode(false);
      setCodeInput("");
      onRefresh?.();
    } catch (e) {
      setCodeErr(e.message || "No se pudo guardar el código");
    }
    setSavingCode(false);
  };

  const startEditCode = () => {
    setCodeInput(creator?.code || "");
    setEditingCode(true);
    setCodeErr("");
  };

  const inputCls = "w-full bg-muted border border-border/30 rounded-xl px-4 py-3 text-sm font-bold tracking-wider focus:outline-none focus:border-primary transition-colors";

  return (
    <div className="space-y-4 pb-4">
      {/* === HERO: Balance + Retirar === */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/20 via-primary/10 to-card border border-primary/30 p-5"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
        <div className="relative">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-4 h-4 text-primary" />
            <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wide">Balance disponible</p>
          </div>
          <p className="text-4xl font-black text-primary leading-none mb-1">{balance.toFixed(2)}</p>
          <p className="text-sm text-muted-foreground font-bold mb-4">Bs</p>

          <button
            onClick={() => {
              if (canWithdraw) { setWithdrawErr(""); setShowWithdraw(true); }
              else {
                const msg = pendingWithdrawals.length > 0 ? "Ya tienes una solicitud pendiente" : `Necesitas al menos ${threshold} Bs`;
                setWithdrawErr(msg);
                setTimeout(() => setWithdrawErr(""), 3500);
              }
            }}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${canWithdraw ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]" : "bg-muted/50 text-muted-foreground cursor-not-allowed"}`}
          >
            <ArrowDownToLine className="w-4 h-4" /> Retirar
          </button>
          {withdrawErr && (
            <p className="text-[11px] text-destructive flex items-center gap-1.5 mt-2 justify-center bg-destructive/10 rounded-lg py-1.5 px-2">
              <AlertCircle className="w-3 h-3" /> {withdrawErr}
            </p>
          )}
          {pendingWithdrawals.length > 0 && (
            <p className="text-[11px] text-amber-400 flex items-center gap-1.5 mt-2 justify-center">
              <Clock3 className="w-3 h-3" /> Tienes {pendingWithdrawals.length} solicitud(es) en revisión
            </p>
          )}
        </div>
      </motion.div>

      {/* === CÓDIGO DE CREADOR === */}
      <div className="bg-card border border-border/20 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-3">
            <Hash className="w-4 h-4 text-primary" />
            <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wide">Mi código de creador</p>
            {!isApproved && (
              <span className="ml-auto text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">En revisión</span>
            )}
          </div>
          {!isApproved && (
            <p className="text-[11px] text-amber-400/80 bg-amber-500/5 rounded-lg px-3 py-2 mb-3">
              Tu código estará activo cuando se apruebe tu cuenta. ¡Ya puedes crearlo!
            </p>
          )}

          {editingCode ? (
            <div className="space-y-3">
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Ej: JUAN10" maxLength={15} className={inputCls} />
              <p className="text-[11px] text-muted-foreground">Solo letras y números · mínimo 3 caracteres · da {discountPct}% de descuento a tus seguidores</p>
              {codeErr && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {codeErr}</p>}
              <div className="flex gap-2">
                <button onClick={saveCode} disabled={savingCode}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">
                  {savingCode ? "Guardando..." : <><Save className="w-4 h-4" /> Guardar</>}
                </button>
                <button onClick={() => { setEditingCode(false); setCodeErr(""); }}
                  className="px-4 flex items-center justify-center gap-1.5 bg-muted text-muted-foreground rounded-xl py-2.5 text-sm font-bold">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : creator?.code ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <span className="text-2xl font-black text-primary tracking-wider block">{creator.code}</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Da {discountPct}% de descuento · ganas 2% por uso</p>
                </div>
                <button onClick={() => setEditingCode(true)}
                  className="p-2.5 bg-muted rounded-xl text-muted-foreground hover:text-primary transition-colors shrink-0">
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={copyCode}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-primary/10 text-primary border border-primary/30 rounded-xl py-2.5 text-sm font-bold hover:bg-primary/20 transition-colors">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copiado" : "Copiar"}
                </button>
                <button onClick={shareCode}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-muted text-foreground border border-border/30 rounded-xl py-2.5 text-sm font-bold hover:bg-muted/70 transition-colors">
                  <Sparkles className="w-4 h-4" /> Compartir
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Aún no tienes un código. Crea el tuyo para empezar a ganar comisiones.</p>
              <button onClick={startEditCode}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 text-sm font-bold hover:bg-primary/90 transition-colors">
                <Hash className="w-4 h-4" /> Crear mi código
              </button>
            </div>
            )}
            </div>

      {/* === STATS GRID === */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Users} label="Usos del código" value={totalUses} />
        <StatCard icon={TrendingUp} label="Total ganado" value={`${totalEarned.toFixed(2)} Bs`} />
        <StatCard icon={CheckCircle2} label="Total pagado" value={`${totalPaid.toFixed(2)} Bs`} accent="green" />
        <StatCard icon={Clock} label="Pendiente" value={`${(totalEarned - totalPaid).toFixed(2)} Bs`} accent="amber" />
      </div>

      {/* === SOLICITUDES DE RETIRO === */}
      {withdrawalRequests.length > 0 && (
        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-primary" /> Mis solicitudes de retiro
          </h3>
          <div className="space-y-2">
            {[...withdrawalRequests].reverse().map((r, i) => (
              <div key={r.id || i} className="flex items-center justify-between gap-3 bg-muted/30 rounded-xl px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{r.amount.toFixed(2)} Bs · {r.method}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {new Date(r.date).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" })}
                    {r.admin_note ? ` · ${r.admin_note}` : ""}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${
                  r.status === "approved" ? "bg-green-500/15 text-green-400" :
                  r.status === "rejected" ? "bg-red-500/15 text-red-400" :
                  "bg-amber-500/15 text-amber-400"
                }`}>
                  {r.status === "approved" ? "Aprobado" : r.status === "rejected" ? "Rechazado" : "En revisión"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === HISTORIAL DE COMISIONES === */}
      <div className="bg-card border border-border/20 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Historial de comisiones
        </h3>
        {commissionLog.length === 0 ? (
          <div className="text-center py-8">
            <DollarSign className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Aún no hay comisiones. ¡Comparte tu código!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...commissionLog].reverse().slice(0, 20).map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 bg-muted/30 rounded-xl px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-foreground truncate">{c.product || "Compra"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(c.date).toLocaleDateString("es-VE", { day: "2-digit", month: "short" })}
                    {c.customer ? ` · ${c.customer}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${c.status === "cancelled" ? "text-muted-foreground line-through" : "text-primary"}`}>
                    {c.status === "cancelled" ? "" : "+"}{c.commission.toFixed(2)} Bs
                  </p>
                  <span className={`text-[10px] font-bold ${
                    c.status === "paid" ? "text-green-400" :
                    c.status === "order_pending" ? "text-blue-400" :
                    c.status === "cancelled" ? "text-red-400" :
                    "text-amber-400"
                  }`}>
                    {c.status === "paid" ? "Pagado" :
                     c.status === "order_pending" ? "En proceso" :
                     c.status === "cancelled" ? "Cancelada" :
                     "Pendiente"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de retiro */}
      <WithdrawalModal
        open={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        creator={creator}
        onRequested={onRefresh}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  const color = accent === "green" ? "text-green-400" : accent === "amber" ? "text-amber-400" : "text-foreground";
  return (
    <div className="bg-card border border-border/20 rounded-2xl p-3.5">
      <Icon className="w-4 h-4 text-primary mb-1.5" />
      <p className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</p>
      <p className={`text-lg font-black leading-tight ${color}`}>{value}</p>
    </div>
  );
}