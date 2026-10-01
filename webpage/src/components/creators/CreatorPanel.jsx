import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Lock } from "lucide-react";
import CreatorDashboard from "@/components/creators/CreatorDashboard";

const SESSION_KEY = "legacy_creator_panel_session";

export default function CreatorPanel({ autoEmail }) {
  const [email, setEmail] = useState(() => autoEmail || "");
  const [pin, setPin] = useState("");
  const [session, setSession] = useState(() => {
    try { const s = localStorage.getItem(SESSION_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [creator, setCreator] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const sessionEmail = (session?.email || "").trim().toLowerCase();

  const load = async (em) => {
    if (!em) return;
    setLoading(true); setErr("");
    try {
      const p = await base44.entities.Creator.filter({ email: em }) || [];
      // Fallback case-insensitive si no hay match exacto
      let creatorRec = p[0] || null;
      if (!creatorRec) {
        const all = await base44.entities.Creator.list() || [];
        creatorRec = all.find((c) => String(c.email || "").toLowerCase() === em) || null;
      }
      setCreator(creatorRec);
      const v = await base44.entities.CreatorVideo.filter({ creator_email: em }) || [];
      // Fallback case-insensitive para videos también
      let videosList = v;
      if (v.length === 0) {
        const allVids = await base44.entities.CreatorVideo.list() || [];
        videosList = allVids.filter((x) => String(x.creator_email || "").toLowerCase() === em);
      }
      videosList.sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime());
      setVideos(videosList);
    } catch { setErr("No se pudo cargar el panel."); }
    setLoading(false);
  };

  useEffect(() => { if (sessionEmail) load(sessionEmail); }, [sessionEmail]);

  const login = async (e) => {
    e.preventDefault();
    setErr("");
    const em = email.trim().toLowerCase();
    if (!em || !pin) { setErr("Ingresa tu correo y PIN."); return; }
    setLoading(true);
    try {
      let list = await base44.entities.Creator.filter({ email: em }) || [];
      let c = list[0];
      if (!c) {
        const all = await base44.entities.Creator.list() || [];
        c = all.find((x) => String(x.email || "").toLowerCase() === em);
      }
      if (!c) { setErr("No tenemos un creador con ese correo."); setLoading(false); return; }
      if (c.status !== "approved") {
        setErr("Tu postulación aún no ha sido aprobada. Te avisaremos por WhatsApp cuando puedas ingresar."); setLoading(false); return;
      }
      if (!c.panel_pin) {
        setErr("Aún no se te ha asignado un PIN. Te llegará por WhatsApp pronto."); setLoading(false); return;
      }
      if (String(c.panel_pin) !== String(pin.trim())) {
        setErr("PIN incorrecto. Revisa el que te envió el bot por WhatsApp."); setLoading(false); return;
      }
      const s = { email: em };
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
    } catch { setErr("No se pudo validar. Intenta de nuevo."); }
    setLoading(false);
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null); setCreator(null); setVideos([]); setPin("");
  };

  if (!sessionEmail) {
    return (
      <div className="bg-card border border-border/20 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-primary"><Lock className="w-4 h-4" /><h3 className="text-sm font-bold">Acceder a mi panel</h3></div>
        <p className="text-xs text-muted-foreground">Te enviamos tu PIN por WhatsApp cuando aprobamos tu postulación. Ingresa tu correo y el PIN para entrar a tu panel, ver tus estadísticas y crear tu código personalizado.</p>
        <form onSubmit={login} className="space-y-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Tu correo" className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={8} placeholder="PIN (ej: 1234)" className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
          {err && <p className="text-xs text-destructive flex gap-1 items-start"><AlertTriangle className="w-4 h-4 mt-0.5" />{err}</p>}
          <Button type="submit" disabled={loading} className="w-full font-bold">{loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Entrar</Button>
        </form>
        <p className="text-[11px] text-muted-foreground text-center pt-1">¿Aún no tienes PIN? Significa que tu postulación está en revisión. Te avisamos por WhatsApp en cuanto sea aprobada.</p>
      </div>
    );
  }

  // Si el creador fue rechazado o ya no está aprobado, cerrar sesión
  if (creator && creator.status !== "approved") {
    return (
      <div className="bg-card border border-border/20 rounded-2xl p-6 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
        <h3 className="text-sm font-bold text-foreground">Tu postulación está en revisión</h3>
        <p className="text-xs text-muted-foreground">Aún no puedes acceder al panel. Te avisaremos por WhatsApp en cuanto sea aprobada y te enviaremos tu PIN de acceso.</p>
        <Button variant="outline" size="sm" onClick={logout}>Cerrar</Button>
      </div>
    );
  }

  return (
    <CreatorDashboard
      creator={creator} videos={videos} loading={loading} err={err}
      email={sessionEmail} onLogout={logout} onRefresh={() => load(sessionEmail)}
    />
  );
}