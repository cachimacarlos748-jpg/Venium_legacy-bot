import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Check, X, Eye, ExternalLink, Wallet, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchTikTokViews } from "@/lib/tiktokViewsClient";
import { rewardTierForViews, TIERS } from "@/lib/creatorRewards";

function addDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysSince(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3);
}

const STATUS = {
  pending: { label: "Pendiente", color: "text-amber-400 bg-amber-500/15" },
  approved: { label: "Aprobado", color: "text-cyan-300 bg-cyan-500/15" },
  counting: { label: "Contando", color: "text-cyan-300 bg-cyan-500/15" },
  manual: { label: "Manual", color: "text-orange-300 bg-orange-500/15" },
  completed: { label: "Pagado", color: "text-green-300 bg-green-500/15" },
  rejected: { label: "Rechazado", color: "text-red-400 bg-red-500/15" },
};

export default function CreatorsTab() {
  const { toast } = useToast();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(null);
  const [manualViews, setManualViews] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const v = await base44.entities.CreatorVideo.list("-created_date", 200);
      setVideos(v || []);
    } catch (e) {
      toast({ title: "Error al cargar", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const approve = async (v) => {
    try {
      await base44.entities.CreatorVideo.update(v.id, { status: "approved", week_end_date: addDaysISO(7) });
      toast({ title: "Video aprobado ✓", description: "El creador puede elegir su código en su panel." });
      load();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const reject = async (v) => {
    try {
      await base44.entities.CreatorVideo.update(v.id, { status: "rejected", manual_note: "Rechazado por el administrador." });
      toast({ title: "Video rechazado" });
      load();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  // Lectura automática con las 2 capas. Si ambas fallan → marca para manual.
  const checkViews = async (v) => {
    setChecking(v.id);
    try {
      const r = await fetchTikTokViews(v.tiktok_url);
      const alreadyHasBooyah = (videos || []).some(
        (x) => x.creator_email === v.creator_email && x.id !== v.id && /booyah/i.test(x.reward_label || "") && x.status === "completed"
      );
      if (r.ok) {
        const tier = rewardTierForViews(r.views, alreadyHasBooyah);
        const upd = { views_current: r.views, check_attempts: (v.check_attempts || 0) + 1, view_check_error: "" };
        if (tier.tier !== "none") {
          upd.reward_tier = tier.tier; upd.reward_label = tier.label; upd.status = "counting";
        }
        await base44.entities.CreatorVideo.update(v.id, upd);
        toast({ title: "Vistas leídas ✓", description: `${r.views.toLocaleString()} vistas · ${tier.label}` });
      } else {
        await base44.entities.CreatorVideo.update(v.id, {
          check_attempts: (v.check_attempts || 0) + 1,
          view_check_error: r.error,
          status: "manual",
        });
        toast({ title: "Fallo el bot — captura requerida", description: "El creador debe enviar captura de TikTok.", variant: "destructive" });
      }
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    setChecking(null);
    load();
  };

  const submitManual = async (v) => {
    const views = Number(manualViews[v.id] || 0);
    if (!views) return;
    try {
      const alreadyHasBooyah = (videos || []).some(
        (x) => x.creator_email === v.creator_email && x.id !== v.id && /booyah/i.test(x.reward_label || "") && x.status === "completed"
      );
      const tier = rewardTierForViews(views, alreadyHasBooyah);
      const upd = { views_current: views, status: tier.tier !== "none" ? "counting" : "manual", view_check_error: "", manual_note: "Vistas validadas manualmente con captura." };
      if (tier.tier !== "none") { upd.reward_tier = tier.tier; upd.reward_label = tier.label; }
      await base44.entities.CreatorVideo.update(v.id, upd);
      toast({ title: "Vistas registradas manualmente ✓", description: tier.label });
      setManualViews((p) => ({ ...p, [v.id]: "" }));
      load();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const markPaid = async (v) => {
    try {
      await base44.entities.CreatorVideo.update(v.id, { status: "completed" });
      toast({ title: "Recompensa entregada ✓" });
      load();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const pending = videos.filter((v) => v.status === "pending");
  const counting = videos.filter((v) => v.status === "approved" || v.status === "counting");
  const manual = videos.filter((v) => v.status === "manual");
  const completed = videos.filter((v) => v.status === "completed").slice(0, 20);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-8">
      <Section title="Videos Pendientes de Revisión" subtitle="Postulaciones que esperan tu aprobación según calidad y esfuerzo.">
        {pending.length === 0 ? <Empty icon={Check} text="Sin solicitudes pendientes." /> : pending.map((v) => (
          <Row key={v.id} v={v}>
            <a href={v.tiktok_url} target="_blank" rel="noreferrer" className="text-primary text-xs inline-flex items-center gap-1 hover:underline">
              Ver TikTok <ExternalLink className="w-3 h-3" />
            </a>
            <Button size="sm" onClick={() => approve(v)}><Check className="w-4 h-4 mr-1" /> Aprobar</Button>
            <Button size="sm" variant="destructive" onClick={() => reject(v)}><X className="w-4 h-4 mr-1" /> Rechazar</Button>
          </Row>
        ))}
      </Section>

      <Section title="Videos en Conteo (7 días)" subtitle="Audita vistas — el sistema intenta leerlas con 2 APIs y aplica automáticamente el rango de recompensa. Si todas fallan, el video salta a Revisión Manual.">
        {counting.length === 0 ? <Empty icon={Eye} text="Sin videos activos." /> : counting.map((v) => (
          <Row key={v.id} v={v}>
            <div className="text-xs text-muted-foreground">
              Día {Math.min(daysSince(v.created_date), 7) + 1}/7 · Vistas: <b className="text-foreground">{(v.views_current || 0).toLocaleString()}</b>
              {v.reward_tier && v.reward_tier !== "none" && <> · <span className="text-primary font-bold">{v.reward_label}</span></>}
            </div>
            <Button size="sm" variant="outline" onClick={() => checkViews(v)} disabled={checking === v.id}>
              {checking === v.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />} Comprobar vistas
            </Button>
            {v.reward_tier && v.reward_tier !== "none" && <Button size="sm" onClick={() => markPaid(v)}><Wallet className="w-4 h-4 mr-1" /> Entregar recompensa</Button>}
          </Row>
        ))}
      </Section>

      <Section title="Revisión Manual (Captura)" subtitle="El sistema automático falló — pídele al creador una captura de su TikTok y valida la cifra aquí mismo.">
        {manual.length === 0 ? <Empty icon={AlertTriangle} text="Sin videos para manual." /> : manual.map((v) => (
          <Row key={v.id} v={v}>
            <div className="text-xs text-orange-300">{v.view_check_error || "Fallo técnico — validamos manualmente con captura."}</div>
            {v.screenshot_url && <a href={v.screenshot_url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Ver captura del creador</a>}
            <div className="flex gap-2 items-center">
              <input type="number" inputMode="numeric" placeholder="Vistas finales" value={manualViews[v.id] || ""} onChange={(e) => setManualViews((p) => ({ ...p, [v.id]: e.target.value }))} className="bg-muted border border-border/30 rounded px-2 py-1.5 text-xs w-40" />
              <Button size="sm" onClick={() => submitManual(v)} disabled={!manualViews[v.id]}>Confirmar</Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => checkViews(v)} disabled={checking === v.id}>Reintentar automático</Button>
          </Row>
        ))}
      </Section>

      <Section title="Historial de Recompensas Entregadas" subtitle="Últimos 20 pagos.">
        {completed.length === 0 ? <Empty icon={Check} text="No hay pagos registrados." /> : completed.map((v) => (
          <Row key={v.id} v={v}>
            <div className="text-xs text-muted-foreground">Vistas: <b className="text-foreground">{(v.views_current || 0).toLocaleString()}</b> · Entregado: <span className="text-primary font-bold">{v.reward_label}</span></div>
          </Row>
        ))}
      </Section>

      <Section title="Tabla de Recompensas" subtitle="Cálculo aplicado por el sistema al comprobar vistas.">
        <div className="text-xs grid gap-1.5">
          {TIERS.map((t) => (
            <div key={t.tier} className="flex justify-between items-center bg-card border border-border/20 rounded px-3 py-2">
              <span className="text-foreground font-bold">{t.label}</span>
              <span className="text-primary font-semibold">{t.reward}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ icon: Icon, text }) {
  return (
    <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
      <Icon className="w-4 h-4" /> {text}
    </div>
  );
}

function Row({ v, children }) {
  return (
    <div className="bg-card border border-border/20 rounded-lg p-3 flex flex-wrap items-center gap-3 justify-between">
      <div className="text-xs space-y-0.5">
        <div className="font-bold text-foreground">{v.creator_name || v.creator_email} <span className="text-muted-foreground font-normal">· {v.game} · ID {v.game_id}</span></div>
        <Badge status={v.status} />
      </div>
      <div className="flex flex-wrap gap-2 items-center">{children}</div>
    </div>
  );
}

function Badge({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${s.color}`}>{s.label}</span>;
}