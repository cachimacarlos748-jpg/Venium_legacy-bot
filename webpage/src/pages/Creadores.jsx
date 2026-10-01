import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Loader2, Check, Send, AlertTriangle, DollarSign } from "lucide-react";
import { TIERS } from "@/lib/creatorRewards";
import TermsCard from "@/components/creators/TermsCard";
import CreatorPanel from "@/components/creators/CreatorPanel";
import { sendWhatsAppMessage, getAdminNumber } from "@/lib/whatsappClient";

const GAMES = ["Free Fire", "Blood Strike", "Mobile Legends", "Roblox", "PUBG", "Honor of Kings"];

export default function Creadores() {
  const { user } = useAuth();
  const [tab, setTab] = useState("apply");
  return (
    <div className="min-h-screen bg-background pb-20">
      <Hero />
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex gap-1 bg-card border border-border/20 rounded-xl p-1 mt-6">
          <TabBtn active={tab === "apply"} onClick={() => setTab("apply")}>Postular video</TabBtn>
          <TabBtn active={tab === "panel"} onClick={() => setTab("panel")}>Mi panel</TabBtn>
        </div>
        <div className="mt-6">
          {tab === "apply" ? <ApplyTab user={user} afterSubmit={() => setTab("panel")} /> : <CreatorPanel autoEmail={user?.email} />}
        </div>
        <TermsCard />
        <HowItWorks />
        <CodeEarningsInfo />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div className="relative bg-gradient-to-b from-primary/10 via-card to-background border-b border-border/10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <span className="inline-block text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-3">Programa de Creadores</span>
        <h1 className="text-3xl md:text-4xl font-black text-foreground">Gana diamantes con cada video</h1>
        <p className="text-muted-foreground mt-2 text-sm">Promociona Legacy Store en TikTok. Tu video entra en cola de revisión y, una vez aprobado, eliges tu propio código de creador. Te regalamos diamantes por cada rango de vistas que alcances en 7 días.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">@legacy_store.vzla</span>
          <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full">#legacystorevzl</span>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, children, ...props }) {
  return (
    <button {...props} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{children}</button>
  );
}

function ApplyTab({ user, afterSubmit }) {
  const [form, setForm] = useState({ name: user?.full_name || "", email: user?.email || "", whatsapp: "", tiktok_url: "", game: "Free Fire", game_id: "", tiktok_handle: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  if (!user) {
    return (
      <div className="bg-card border border-border/20 rounded-2xl p-6 text-center">
        <p className="text-sm text-muted-foreground mb-4">Necesitas una cuenta en Legacy Store para postular como creador.</p>
        <div className="flex gap-2 justify-center">
          <Link to="/Login"><Button>Entrar</Button></Link>
          <Link to="/Register"><Button variant="outline">Crear cuenta</Button></Link>
        </div>
      </div>
    );
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!/tiktok\.com/i.test(form.tiktok_url)) { setErr("Ingresa un enlace de TikTok válido."); return; }
    if (!form.email.includes("@")) { setErr("Ingresa tu correo."); return; }
    if (form.whatsapp.replace(/\D/g, "").length < 7) { setErr("Número de WhatsApp inválido."); return; }
    if (!form.game_id) { setErr("Ingresa el ID de tu juego."); return; }

    setSubmitting(true);
    try {
      const active = await base44.entities.CreatorVideo.filter({ creator_email: user.email }) || [];
      const locksmith = active.filter((x) => ["pending", "approved", "counting"].includes(x.status));
      if (locksmith.length >= 2) {
        setErr("Ya tienes 2 videos activos. Espera a que termine el plazo de 7 días para postular uno nuevo.");
        setSubmitting(false); return;
      }

      const normalizedEmail = String(user.email || "").trim().toLowerCase();
      const profile = await base44.entities.Creator.filter({ email: normalizedEmail }) || [];
      let isNewCreator = false;
      if (profile.length === 0) {
        await base44.entities.Creator.create({
          name: form.name || user.full_name || "", email: normalizedEmail,
          whatsapp: form.whatsapp, tiktok_handle: form.tiktok_handle || "",
          status: "pending",
        });
        isNewCreator = true;
      } else if (profile[0].whatsapp !== form.whatsapp || profile[0].tiktok_handle !== form.tiktok_handle) {
        await base44.entities.Creator.update(profile[0].id, {
          whatsapp: form.whatsapp, tiktok_handle: form.tiktok_handle, name: form.name || profile[0].name,
        });
      }

      await base44.entities.CreatorVideo.create({
        creator_email: normalizedEmail,
        creator_name: form.name || user.full_name || "",
        whatsapp: form.whatsapp,
        tiktok_url: form.tiktok_url,
        game: form.game,
        game_id: form.game_id,
        status: "pending",
        views_initial: 0,
        views_current: 0,
        check_attempts: 0,
      });

      // Notificar al admin por WhatsApp (nuevo creador o nuevo video)
      try {
        const adminNum = await getAdminNumber();
        if (adminNum) {
          const msg = [
            isNewCreator ? "🌟 *¡Nuevo creador postulado!* — Legacy Store" : "🎬 *Nuevo video de creador* — Legacy Store",
            "",
            `👤 ${form.name || user.full_name || "—"}`,
            `📧 ${user.email}`,
            `📱 ${form.whatsapp}`,
            form.tiktok_handle ? `🎵 TikTok: ${form.tiktok_handle}` : "",
            `🎮 Juego: ${form.game}`,
            `🆔 ID: ${form.game_id}`,
            `🔗 ${form.tiktok_url}`,
            "",
            isNewCreator ? "Entra al panel de admin para aprobarlo y asignarle un PIN." : "Entra al panel para revisar el video.",
          ].filter(Boolean).join("\n");
          sendWhatsAppMessage(adminNum, msg).catch(() => {});
        }
      } catch {}

      setOk(true);
      setSubmitting(false);
      setTimeout(() => { afterSubmit(); }, 1200);
    } catch (e) {
      setErr(e.message || "No se pudo enviar la postulación.");
      setSubmitting(false);
    }
  };

  if (ok) return (
    <div className="bg-card border border-border/20 rounded-2xl p-6 text-center">
      <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-3"><Check className="w-8 h-8 text-primary" /></div>
      <h3 className="text-lg font-bold text-foreground">¡Postulación enviada!</h3>
      <p className="text-sm text-muted-foreground mt-1">Tu video está en cola de revisión. Cuando lo aprobemos te enviaremos un <span className="text-primary font-bold">PIN por WhatsApp</span> para que entres a tu panel y elijas tu código personalizado.</p>
      <p className="text-xs text-muted-foreground mt-2">Revisa tu WhatsApp en las próximas 24-48 horas.</p>
    </div>
  );

  const input = "w-full bg-muted border border-border/30 rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary";

  return (
    <form onSubmit={submit} className="bg-card border border-border/20 rounded-2xl p-5 space-y-4">
      <h2 className="text-sm font-bold text-foreground">Sube tu video</h2>
      <p className="-mt-2 text-xs text-muted-foreground">Máximo 2 videos activos por semana. La recompensa se contabiliza una sola vez sobre las vistas a los 7 días.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Tu nombre / Apodo"><input value={form.name} onChange={set("name")} className={input} required /></Field>
        <Field label="Correo (tu cuenta)"><input value={form.email} disabled className={input + " opacity-70"} /></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="WhatsApp del contacto"><input value={form.whatsapp} onChange={set("whatsapp")} placeholder="+58 424-..." className={input} required /></Field>
        <Field label="TikTok @usuario"><input value={form.tiktok_handle} onChange={set("tiktok_handle")} placeholder="@legacy_store_..." className={input} /></Field>
      </div>
      <Field label="Enlace del video de TikTok"><input value={form.tiktok_url} onChange={set("tiktok_url")} placeholder="https://www.tiktok.com/@tuvideo/1234567890" className={input} required /></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Juego que recargas">
          <select value={form.game} onChange={set("game")} className={input}>
            {GAMES.map((g) => <option key={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="ID / Tag del juego"><input value={form.game_id} onChange={set("game_id")} className={input} required /></Field>
      </div>

      {err && <p className="text-xs text-destructive flex gap-1.5 items-start"><AlertTriangle className="w-4 h-4 mt-0.5" />{err}</p>}

      <Button type="submit" size="lg" disabled={submitting} className="w-full font-bold">
        {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />} Enviar postulación
      </Button>
    </form>
  );
}



function Field({ label, children }) {
  return <label className="block space-y-1"><span className="text-xs text-muted-foreground font-medium">{label}</span>{children}</label>;
}

function HowItWorks() {
  return (
    <div className="mt-10 bg-muted/30 border border-border/20 rounded-2xl p-5">
      <h3 className="text-sm font-bold text-foreground mb-3">Cómo funciona</h3>
      <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
        <li>Subes tu video de TikTok mencionando a <span className="text-primary font-bold">@legacy_store.vzla</span> y usando el hashtag <span className="text-primary font-bold">#legacystorevzl</span>.</li>
        <li>Nosotros lo revisamos por calidad y esfuerzo.</li>
        <li>Si lo aprueban, eliges tu código de creador único.</li>
        <li>El sistema cuenta las vistas a los 7 días (con respaldo manual si el bot no logra leerlas).</li>
      </ol>
      <h4 className="text-xs font-bold text-foreground mt-4 mb-2">Tabla de recompensas</h4>
      <div className="space-y-1.5">
        {TIERS.map((t) => (
          <div key={t.tier} className="flex justify-between items-center bg-card border border-border/20 rounded-lg px-3 py-2 text-xs">
            <span className="text-foreground font-bold">{t.label}</span>
            <span className="text-primary font-bold">{t.reward}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-3 italic">Máximo 2 videos activos por semana por creador.</p>
    </div>
  );
}

function CodeEarningsInfo() {
  return (
    <div className="mt-6 bg-gradient-to-b from-primary/5 to-card border border-border/20 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Gana dinero con tu código personalizado</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Además de las recompensas por vistas, puedes generar ingresos pasivos compartiendo tu código de creador con tus seguidores.</p>
      <ol className="text-xs text-muted-foreground space-y-2 list-decimal pl-4">
        <li>Te aprueban como creador y recibes tu PIN por WhatsApp.</li>
        <li>Entras a tu panel y eliges tu código personalizado (ej: <span className="text-primary font-bold">JUAN10</span>).</li>
        <li>Tus seguidores usan tu código al comprar en Legacy Store y reciben un descuento.</li>
        <li>Tú ganas una comisión del 2% de cada venta con tu código, hasta 100 Bs por compra.</li>
        <li>Acumulas balance y lo retiras por Pago Móvil cuando llegues al mínimo.</li>
      </ol>
      <div className="mt-4 bg-muted/40 border border-border/20 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
        <p><span className="text-foreground font-bold">Ejemplo:</span> Un cliente compra 500 Bs en diamantes con tu código.</p>
        <p>Tu comisión: <span className="text-primary font-bold">10 Bs</span> (2% de 500, dentro del tope).</p>
        <p>El cliente ahorra y tú ganas — ¡ganan ambos!</p>
      </div>
    </div>
  );
}