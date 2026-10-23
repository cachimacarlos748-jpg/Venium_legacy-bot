import { useEffect, useState } from "react";
import { Trophy, Upload, PlayCircle, Square, Save, Loader2, Users, RotateCcw, CalendarDays } from "lucide-react";

// Sección Trivia del panel admin de la WEB: habla con la API del bot
// (mismo prefijo VITE_BOT_API que usa la página /trivia). Permite pegar un
// JSON de preguntas, definir el premio mayor y arrancar/cerrar la partida
// manualmente para probar sin esperar las 8:00 PM.
const BOT_HOST = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BOT_API) || "";
const botUrl = (path) => `${String(BOT_HOST).replace(/\/$/, "")}${path}`;

const SAMPLE = JSON.stringify(
  [{ question: "¿Cuál es la habilidad de Kelly?", options: ["Salto más rápido", "Esprintar más rápido", "Saltar más alto", "Ver a través de la pared"], correct: 2 }],
  null,
  2,
);

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function TriviaTab() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem("vex-trivia-admin-key") || "");
  const [prize, setPrize] = useState("500");
  const [startTime, setStartTime] = useState("20:00");
  const [weekDays, setWeekDays] = useState([0, 6]);
  const [maxWinners, setMaxWinners] = useState("3");
  const [json, setJson] = useState("");
  const [replace, setReplace] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [room, setRoom] = useState(null);
  const [roomStats, setRoomStats] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { ok, text }

  const say = (ok, text) => setMsg({ ok, text });

  const adminFetch = (path, options = {}) => fetch(botUrl(path), {
    ...options,
    headers: { ...(options.headers || {}), ...(adminKey ? { "x-trivia-admin-key": adminKey } : {}) },
  });

  const adminJson = async (path, options) => {
    const response = await adminFetch(path, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  };

  const load = async () => {
    if (!BOT_HOST) { say(false, "Falta VITE_BOT_API (URL del bot) en Settings → Environment."); return; }
    setBusy("load");
    try {
      const [s, q, h, r] = await Promise.all([
        adminJson("/api/admin/trivia/settings"),
        adminJson("/api/admin/trivia/questions"),
        fetch(botUrl("/api/trivia/health")).then((r) => r.json()).catch(() => null),
        adminJson("/api/admin/trivia/results").catch(() => []),
      ]);
      setPrize(String(s.prizeDiamonds ?? 500));
      setStartTime(String(s.startTime || "20:00"));
      setWeekDays(Array.isArray(s.weekDays) && s.weekDays.length ? s.weekDays.map(Number) : [0, 6]);
      setMaxWinners(String(s.maxWinners || 3));
      setQuestions(Array.isArray(q) ? q : []);
      setRoom(h ? `${h.session || h.status || "none"} · ${h.wsClients ?? 0} conectados` : null);
      setRoomStats(h || null);
      setResults(Array.isArray(r) ? r : []);
      say(true, "Datos cargados.");
    } catch (e) {
      say(false, "No pude hablar con el bot: " + e.message);
    } finally {
      setBusy("");
    }
  };

  useEffect(() => { load(); }, []);

  const savePrize = async () => {
    setBusy("prize");
    try {
      await adminJson("/api/admin/trivia/settings", {
        method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ prizeDiamonds: Number(prize), startTime, maxWinners: Number(maxWinners), weekDays }),
      });
      say(true, `Configuración guardada: ${weekDays.map((day) => DAY_LABELS[day]).join(" y ")} a las ${startTime} Venezuela.`);
    } catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const upload = async () => {
    let parsed;
    try { parsed = JSON.parse(json); } catch { say(false, "El JSON no es válido."); return; }
    setBusy("upload");
    try {
      const body = await adminJson("/api/admin/trivia/questions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ replace, questions: parsed }),
      });
      say(true, `Preguntas publicadas: ${body.inserted}${body.replace ? " (banco reemplazado)" : ""}.`);
      setJson("");
      await load();
    } catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const admin = async (action, label) => {
    setBusy(action);
    try {
      await adminJson(`/api/admin/trivia/${action}`, { method: "POST" });
      say(true, label);
      await load();
    } catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const reset = async () => {
    setBusy("reset");
    try { await adminJson("/api/admin/trivia/reset", { method: "POST" }); say(true, "Nueva sala creada; la anterior quedó archivada."); await load(); }
    catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const btn = "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50";
  const btnPrimary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
  const btnGhost = `${btn} bg-muted text-foreground hover:bg-muted/70`;
  const btnDanger = `${btn} bg-destructive text-destructive-foreground hover:bg-destructive/90`;

  const saveAdminKey = () => {
    sessionStorage.setItem("vex-trivia-admin-key", adminKey.trim());
    say(true, "Clave guardada solo en esta sesión del navegador.");
    void load();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Seguridad */}
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h3 className="font-bold mb-1">Seguridad del panel</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Introduce la clave <code>TRIVIA_ADMIN_KEY</code> configurada en Northflank. No se guarda en el código ni en la URL; solo dura esta sesión del navegador.
        </p>
        <div className="flex gap-3 flex-wrap">
          <input
            type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Clave privada del backend"
            autoComplete="off"
            className="flex-1 min-w-56 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          <button className={btnPrimary} onClick={saveAdminKey}>Guardar y comprobar</button>
        </div>
      </div>

      {/* Estado */}
      <div className="rounded-2xl border border-border/10 bg-card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-400" /> Estado de la sala</h3>
          <p className="text-sm text-muted-foreground mt-1">{room ? `Sala: ${room}` : "Sin conexión al bot (o sala programada: 20:00 Venezuela)."}</p>
          {roomStats && <p className="mt-2 text-sm font-semibold"><Users className="mr-1 inline h-4 w-4" />{roomStats.participants ?? 0} registrados · {roomStats.alive ?? 0} vivos</p>}
        </div>
        <button className={btnGhost} onClick={load} disabled={busy === "load"}>
          {busy === "load" ? <Loader2 className="w-4 h-4 animate-spin" /> : "↻"} Refrescar
        </button>
        <button className={btnGhost} onClick={reset} disabled={busy === "reset"}><RotateCcw className="h-4 w-4" /> Nueva sala</button>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.text}
        </div>
      )}

      {/* Premio */}
      <div className="rounded-2xl border border-border/10 bg-card p-5">
        <h3 className="mb-1 flex items-center gap-2 font-bold"><CalendarDays className="h-5 w-5 text-primary" /> Programación semanal y premio</h3>
        <p className="mb-4 text-sm text-muted-foreground">La trivia automática se abrirá únicamente los días seleccionados, usando hora de Venezuela (UTC-4). La sala abre dos horas antes. El premio es una referencia total: se divide entre los sobrevivientes seleccionados y Venium entrega el paquete más cercano disponible.</p>
        <div className="flex gap-3 flex-wrap">
          <label className="text-sm font-semibold">Hora de inicio
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="ml-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          </label>
          <div className="flex w-full flex-wrap items-center gap-2 pt-1">
            <span className="text-sm font-semibold">Días:</span>
            {DAY_LABELS.map((label, day) => (
              <label key={day} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-bold transition ${weekDays.includes(day) ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-background text-muted-foreground"}`}>
                <input type="checkbox" className="sr-only" checked={weekDays.includes(day)} onChange={() => setWeekDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b))} />
                {label}
              </label>
            ))}
          </div>
          <input
            type="number" min="110" value={prize} onChange={(e) => setPrize(e.target.value)}
            className="w-40 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          <label className="text-sm font-semibold">Máximo ganadores
            <input type="number" min="1" max="20" value={maxWinners} onChange={(e) => setMaxWinners(e.target.value)} className="ml-2 w-24 rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
          </label>
          <button className={btnPrimary} onClick={savePrize} disabled={busy === "prize"}>
            <Save className="w-4 h-4" /> Guardar programación
          </button>
        </div>
      </div>

      {/* Preguntas JSON */}
      <div className="rounded-2xl border border-border/10 bg-card p-5">
        <h3 className="font-bold mb-1">Cargar preguntas (JSON)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Pega un array. Formato: <code className="text-xs">{`{ "question": "…", "options": [4 textos], "correct": 1..4 }`}</code>. El motor elige 10 al azar por partida.
        </p>
        <textarea
          rows={9} value={json} onChange={(e) => setJson(e.target.value)} placeholder={SAMPLE}
          className="w-full rounded-xl border border-border bg-background p-3 font-mono text-xs"
        />
        <label className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Reemplazar el banco actual
        </label>
        <button className={`${btnPrimary} mt-3`} onClick={upload} disabled={busy === "upload"}>
          <Upload className="w-4 h-4" /> Publicar preguntas
        </button>
      </div>

      {/* Banco */}
      <div className="rounded-2xl border border-border/10 bg-card p-5">
        <h3 className="font-bold mb-3">Banco de preguntas ({questions.length})</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {questions.length === 0 && <p className="text-sm text-muted-foreground">Sin preguntas todavía.</p>}
          {questions.map((q) => (
            <div key={q.id} className="rounded-xl border border-border/50 bg-background/50 px-3 py-2">
              <p className="text-sm">{q.question}</p>
              <p className="text-xs text-emerald-400 mt-0.5">✅ {q.options?.[q.correct - 1]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Prueba manual */}
      <div className="rounded-2xl border border-border/10 bg-card p-5">
        <h3 className="font-bold mb-1">Probar la partida manualmente</h3>
        <p className="text-sm text-muted-foreground mb-4">
          <b>Arrancar test</b> inicia la partida al instante (incluye la respuesta correcta para probar el flujo ganador). <b>Cerrar sesión</b> reparte el premio.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button className={btnPrimary} onClick={() => admin("start-test", "Partida de prueba arrancada.")} disabled={busy === "start-test"}>
            <PlayCircle className="w-4 h-4" /> Arrancar test
          </button>
          <button className={btnDanger} onClick={() => admin("end", "Sesión cerrada: premio repartido.")} disabled={busy === "end"}>
            <Square className="w-4 h-4" /> Cerrar sesión
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/10 bg-card p-5">
        <h3 className="font-bold mb-3"><Trophy className="mr-2 inline h-5 w-5 text-amber-400" />Resultados recientes</h3>
        {results.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay resultados archivados.</p>}
        <div className="space-y-3">
          {results.map((r) => <div key={r.id} className="rounded-xl border border-border/50 p-3 text-sm">
            <div className="flex justify-between font-semibold"><span>{r.date} · {r.status}</span><span>{r.participants} registrados</span></div>
            <p className="mt-1 text-muted-foreground">{r.winners?.length || 0} ganadores · referencia {r.prize_diamonds} 💎</p>
            {r.winners?.length > 0 && <p className="mt-1">{r.winners.map((w) => `${w.nickname} (${w.player_id})`).join(" · ")}</p>}
          </div>)}
        </div>
      </div>
    </div>
  );
}
