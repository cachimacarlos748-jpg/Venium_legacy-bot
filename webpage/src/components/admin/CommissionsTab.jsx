import { useState, useEffect } from "react";
import { Wallet, Users, RefreshCw, Loader2, Copy, Check, Save, DollarSign, TrendingUp, Hash, Send } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  getCommissionConfig,
  saveCommissionConfig,
  linkCreatorDiscountCode,
  registerPayout,
  processWithdrawalRequest,
  COMMISSION_RATE,
  COMMISSION_CAP,
  DEFAULT_PAYOUT_THRESHOLD,
  DEFAULT_DISCOUNT_PERCENT,
} from "@/lib/creatorCommission";
import { ArrowDownToLine, X as XIcon, Key } from "lucide-react";
import { sendWhatsAppMessage, getAdminNumber } from "@/lib/whatsappClient";

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function CommissionsTab() {
  const { toast } = useToast();
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({ rate: COMMISSION_RATE, cap: COMMISSION_CAP, threshold: DEFAULT_PAYOUT_THRESHOLD, discount_percent: DEFAULT_DISCOUNT_PERCENT });
  const [savingCfg, setSavingCfg] = useState(false);
  const [editingCode, setEditingCode] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const [payingOut, setPayingOut] = useState(null);
  const [payoutForm, setPayoutForm] = useState({ amount: "", method: "Pago Móvil", reference: "" });
  const [savingPayout, setSavingPayout] = useState(false);
  const [copied, setCopied] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [list, cfg] = await Promise.all([
        base44.entities.Creator.list("-created_date", 200),
        getCommissionConfig(),
      ]);
      setCreators(list || []);
      setConfig(cfg);
    } catch (e) {
      toast({ title: "Error al cargar", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSaveConfig = async () => {
    setSavingCfg(true);
    try {
      await saveCommissionConfig(config);
      toast({ title: "Configuración guardada ✓" });
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSavingCfg(false);
  };

  const assignCode = async (creator) => {
    const code = codeInput.trim().toUpperCase();
    if (!code) { toast({ title: "Ingresa un código", variant: "destructive" }); return; }
    try {
      // Verificar que no exista otro creador con ese código
      const existing = await base44.entities.Creator.filter({ code });
      if (existing?.some((c) => c.id !== creator.id)) {
        toast({ title: "Ese código ya lo usa otro creador", variant: "destructive" });
        return;
      }
      const updated = { ...creator, code };
      await base44.entities.Creator.update(creator.id, { code });
      await linkCreatorDiscountCode(updated, config.discount_percent);
      toast({ title: "Código asignado ✓", description: `Descuento del ${config.discount_percent}% creado para ${code}` });
      setEditingCode(null);
      setCodeInput("");
      load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const approveCreator = async (creator) => {
    try {
      const pin = generatePin();
      await base44.entities.Creator.update(creator.id, {
        status: "approved",
        approved_date: new Date().toISOString().slice(0, 10),
        panel_pin: pin,
      });
      // Enviar PIN al creador por WhatsApp
      try {
        const adminNum = await getAdminNumber();
        const phone = String(creator.whatsapp || "").replace(/\D/g, "");
        if (phone) {
          const msg = [
            "🎉 *¡Felicitaciones! Tu postulación fue aprobada* — Legacy Store",
            "",
            `Hola ${creator.name || ""}, ya eres creador oficial de Legacy Store.`,
            "",
            `🔑 Tu PIN de acceso al panel es: *${pin}*`,
            "",
            "Entra a legacy store → Creadores → Mi panel",
            "Ingresa tu correo y este PIN para crear tu código personalizado y ver tus estadísticas.",
            "",
            "¡Bienvenido al equipo! 🚀",
          ].join("\n");
          sendWhatsAppMessage(phone, msg).catch(() => {});
        }
      } catch {}
      toast({ title: "Creador aprobado ✓", description: `PIN ${pin} enviado por WhatsApp. Ahora asígnale un código.` });
      load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const regeneratePin = async (creator) => {
    try {
      const pin = generatePin();
      await base44.entities.Creator.update(creator.id, { panel_pin: pin });
      try {
        const phone = String(creator.whatsapp || "").replace(/\D/g, "");
        if (phone) {
          const msg = [
            "🔑 *Nuevo PIN de acceso* — Legacy Store",
            "",
            `Tu nuevo PIN es: *${pin}*`,
            "Úsalo para entrar a tu panel de creador.",
          ].join("\n");
          sendWhatsAppMessage(phone, msg).catch(() => {});
        }
      } catch {}
      toast({ title: "PIN regenerado ✓", description: `Nuevo PIN: ${pin} (enviado por WhatsApp)` });
      load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const rejectCreator = async (creator) => {
    try {
      await base44.entities.Creator.update(creator.id, { status: "rejected" });
      toast({ title: "Creador rechazado" });
      load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const startEditCode = (creator) => {
    setEditingCode(creator.id);
    setCodeInput(creator.code || "");
  };

  const startPayout = (creator) => {
    setPayingOut(creator);
    setPayoutForm({ amount: String(creator.balance || 0), method: "Pago Móvil", reference: "" });
  };

  const confirmPayout = async () => {
    if (!payingOut) return;
    const amt = Number(payoutForm.amount);
    if (!amt || amt <= 0) { toast({ title: "Monto inválido", variant: "destructive" }); return; }
    if (amt > (payingOut.balance || 0)) { toast({ title: "El monto supera el balance", variant: "destructive" }); return; }
    setSavingPayout(true);
    try {
      await registerPayout(payingOut.id, payoutForm);
      toast({ title: "Pago registrado ✓", description: `Transferido ${amt.toFixed(2)} Bs a ${payingOut.name}` });
      setPayingOut(null);
      load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSavingPayout(false);
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const pending = creators.filter((c) => c.status === "pending");
  const approved = creators.filter((c) => c.status === "approved");
  const totalToPay = approved.reduce((s, c) => s + (c.balance || 0), 0);
  const readyToPay = approved.filter((c) => (c.balance || 0) >= (config.threshold || DEFAULT_PAYOUT_THRESHOLD));

  // Solicitudes de retiro pendientes de todos los creadores
  const allWithdrawalRequests = approved.flatMap((c) =>
    (c.withdrawal_requests || []).map((r) => ({ ...r, creator: c }))
  );
  const pendingWithdrawals = allWithdrawalRequests.filter((r) => r.status === "pending");

  const handleWithdrawal = async (req, approved_) => {
    try {
      await processWithdrawalRequest(req.creator.id, req.id, approved_);
      toast({ title: approved_ ? "Retiro aprobado ✓" : "Retiro rechazado", description: approved_ ? `${req.amount.toFixed(2)} Bs transferidos a ${req.creator.name}` : `Solicitud de ${req.creator.name} rechazada` });
      load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Configuración */}
      <div className="bg-card rounded-xl border border-border/30 p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-foreground">Configuración de comisiones</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">% Comisión</label>
            <input type="number" step="0.5" value={config.rate * 100} onChange={(e) => setConfig({ ...config, rate: (Number(e.target.value) || 0) / 100 })}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tope (Bs)</label>
            <input type="number" value={config.cap} onChange={(e) => setConfig({ ...config, cap: Number(e.target.value) || 0 })}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">% Descuento cliente</label>
            <input type="number" step="0.5" value={config.discount_percent} onChange={(e) => setConfig({ ...config, discount_percent: Number(e.target.value) || 0 })}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mín. retiro (Bs)</label>
            <input type="number" value={config.threshold} onChange={(e) => setConfig({ ...config, threshold: Number(e.target.value) || 0 })}
              className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
          </div>
        </div>
        <Button onClick={handleSaveConfig} disabled={savingCfg} size="sm" className="mt-4">
          {savingCfg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Guardar configuración
        </Button>
      </div>

      {/* Resumen mensual */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border/20 rounded-xl p-4">
          <TrendingUp className="w-4 h-4 text-primary mb-2" />
          <p className="text-[11px] text-muted-foreground">Listos para pagar</p>
          <p className="text-lg font-black text-foreground">{readyToPay.length}</p>
        </div>
        <div className="bg-card border border-border/20 rounded-xl p-4">
          <Wallet className="w-4 h-4 text-primary mb-2" />
          <p className="text-[11px] text-muted-foreground">Total a transferir</p>
          <p className="text-lg font-black text-primary">{totalToPay.toFixed(2)} Bs</p>
        </div>
        <div className="bg-card border border-border/20 rounded-xl p-4">
          <Users className="w-4 h-4 text-primary mb-2" />
          <p className="text-[11px] text-muted-foreground">Creadores activos</p>
          <p className="text-lg font-black text-foreground">{approved.length}</p>
        </div>
      </div>

      {/* Solicitudes de retiro pendientes */}
      {pendingWithdrawals.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-primary" /> Solicitudes de retiro ({pendingWithdrawals.length})
          </h3>
          <div className="space-y-2">
            {pendingWithdrawals.map((r) => (
              <div key={r.id} className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs space-y-1 flex-1 min-w-0">
                    <div className="font-bold text-foreground">{r.creator.name} · <span className="text-primary">{r.amount.toFixed(2)} Bs</span></div>
                    <div className="text-muted-foreground">Método: {r.method}</div>
                    <div className="text-muted-foreground break-all">Datos: {r.bank_info || "—"}</div>
                    <div className="text-muted-foreground">{new Date(r.date).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" onClick={() => handleWithdrawal(r, true)}><Check className="w-4 h-4 mr-1" /> Aprobar</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleWithdrawal(r, false)}><XIcon className="w-4 h-4 mr-1" /> Rechazar</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Creadores pendientes de aprobación */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3">Pendientes de aprobación ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((c) => (
              <div key={c.id} className="bg-card border border-border/20 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs space-y-0.5">
                  <div className="font-bold text-foreground">{c.name} <span className="text-muted-foreground font-normal">· {c.email}</span></div>
                  <div className="text-muted-foreground">WhatsApp: {c.whatsapp} · TikTok: {c.tiktok_handle || "—"}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveCreator(c)}><Check className="w-4 h-4 mr-1" /> Aprobar</Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectCreator(c)}>Rechazar</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Creadores aprobados con balance y comisiones */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-foreground">Creadores aprobados ({approved.length})</h3>
          <button onClick={load} className="p-2 text-muted-foreground hover:text-primary"><RefreshCw className="w-4 h-4" /></button>
        </div>
        {approved.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm bg-card rounded-xl border border-border/30">
            No hay creadores aprobados todavía.
          </div>
        ) : (
          <div className="space-y-2">
            {approved.map((c) => (
              <div key={c.id} className="bg-card border border-border/20 rounded-lg p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-foreground text-sm">{c.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{c.email}</span>
                    </div>
                    {/* Código */}
                    {editingCode === c.id ? (
                      <div className="flex gap-2 items-center mt-2">
                        <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Ej: JUAN10"
                          className="bg-muted border border-border/30 rounded-lg px-3 py-1.5 text-sm font-bold tracking-wider w-32 focus:outline-none focus:border-primary" />
                        <Button size="sm" onClick={() => assignCode(c)}><Check className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingCode(null)}>Cancelar</Button>
                      </div>
                    ) : c.code ? (
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-sm font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{c.code}</code>
                        <button onClick={() => copyCode(c.code)} className="text-muted-foreground hover:text-primary">
                          {copied === c.code ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => startEditCode(c)} className="text-xs text-muted-foreground hover:text-primary">Editar</button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => startEditCode(c)} className="mt-1 h-7 text-xs">
                        <Hash className="w-3 h-3 mr-1" /> Asignar código
                      </Button>
                    )}
                    {/* PIN */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <Key className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">PIN:</span>
                      <code className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded">{c.panel_pin || "—"}</code>
                      <button onClick={() => regeneratePin(c)} className="text-[11px] text-primary hover:underline">Regenerar</button>
                    </div>
                  </div>
                  {/* Stats */}
                  <div className="flex gap-4 text-right">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Usos</p>
                      <p className="text-sm font-bold text-foreground">{c.total_code_uses || 0}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Balance</p>
                      <p className="text-sm font-bold text-primary">{(c.balance || 0).toFixed(2)} Bs</p>
                    </div>
                  </div>
                </div>
                {/* Acción de pago */}
                {(c.balance || 0) > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/20 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {(c.balance || 0) >= (config.threshold || DEFAULT_PAYOUT_THRESHOLD)
                        ? <span className="text-green-400 font-bold">Listo para pago mensual</span>
                        : <span>Faltan {((config.threshold || DEFAULT_PAYOUT_THRESHOLD) - (c.balance || 0)).toFixed(2)} Bs para el mínimo de retiro</span>}
                    </p>
                    <Button size="sm" onClick={() => startPayout(c)}>
                      <Send className="w-3.5 h-3.5 mr-1" /> Registrar pago
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de pago */}
      {payingOut && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPayingOut(null)}>
          <div className="max-w-md w-full bg-card border border-border/30 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Registrar pago a {payingOut.name}</h3>
            <p className="text-xs text-muted-foreground mb-4">Balance disponible: <span className="text-primary font-bold">{(payingOut.balance || 0).toFixed(2)} Bs</span></p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Monto a transferir (Bs)</label>
                <input type="number" value={payoutForm.amount} onChange={(e) => setPayoutForm({ ...payoutForm, amount: e.target.value })}
                  className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Método</label>
                <select value={payoutForm.method} onChange={(e) => setPayoutForm({ ...payoutForm, method: e.target.value })}
                  className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary">
                  <option>Pago Móvil</option>
                  <option>Transferencia</option>
                  <option>Binance</option>
                  <option>Otro</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Referencia (opcional)</label>
                <input value={payoutForm.reference} onChange={(e) => setPayoutForm({ ...payoutForm, reference: e.target.value })}
                  placeholder="Últimos 6 dígitos"
                  className="w-full bg-input border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setPayingOut(null)}>Cancelar</Button>
              <Button className="flex-1" onClick={confirmPayout} disabled={savingPayout}>
                {savingPayout ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Confirmar pago
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}