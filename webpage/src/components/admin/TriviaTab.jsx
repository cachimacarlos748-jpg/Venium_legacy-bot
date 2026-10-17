import { useEffect, useState } from "react";
import { Trophy, Upload, PlayCircle, Square, Save, Loader2 } from "lucide-react";

// Sección Trivia del panel admin de la WEB: habla con la API del bot
// (mismo prefijo VITE_BOT_API que usa la página /trivia). Permite pegar un
// JSON de preguntas, definir el premio mayor y arrancar/cerrar la partida
// manualmente para probar sin esperar las 8:00 PM.
const BOT_HOST = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BOT_API) || "";

const SAMPLE = JSON.stringify(
  [{ question: "¿Cuál es la habilidad de Kelly?", options: ["Salto más rápido", "Esprintar más rápido", "Saltar más alto", "Ver a través de la pared"], correct: 2 }],
  null,
  2,
);

export default function TriviaTab() {
  const [prize, setPrize] = useState("500");
  const [json, setJson] = useState("");
  const [replace, setReplace] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [room, setRoom] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { ok, text }

  const say = (ok, text) => setMsg({ ok, text });

  const load = async () => {
    if (!BOT_HOST) { say(false, "Falta VITE_BOT_API (URL del bot) en Settings → Environment."); return; }
    setBusy("load");
    try {
      const [s, q, h] = await Promise.all([
        fetch(`${BOT_HOST}/api/admin/trivia/settings`).then((r) => r.json()),
        fetch(`${BOT_HOST}/api/admin/trivia/questions`).then((r) => r.json()),
        fetch(`${BOT_HOST}/api/trivia/health`).then((r) => r.json()).catch(() => null),
      ]);
      setPrize(String(s.prizeDiamonds ?? 500));
      setQuestions(Array.isArray(q) ? q : []);
      setRoom(h ? `${h.session || h.status || "none"} · ${h.wsClients ?? 0} conectados` : null);
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
      const r = await fetch(`${BOT_HOST}/api/admin/trivia/settings`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prizeDiamonds: Number(prize) }),
      });
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      say(true, `Premio guardado: ${Number(prize)} 💎 (vale para la próxima sala).`);
    } catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const upload = async () => {
    let parsed;
    try { parsed = JSON.parse(json); } catch { say(false, "El JSON no es válido."); return; }
    setBusy("upload");
    try {
      const r = await fetch(`${BOT_HOST}/api/admin/trivia/questions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ replace, questions: parsed }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      say(true, `Preguntas publicadas: ${body.inserted}${body.replace ? " (banco reemplazado)" : ""}.`);
      setJson("");
      await load();
    } catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const admin = async (action, label) => {
    setBusy(action);
    try {
      const r = await fetch(`${BOT_HOST}/api/admin/trivia/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      say(true, label);
      await load();
    } catch (e) { say(false, e.message); } finally { setBusy(""); }
  };

  const btn = "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50";
  const btnPrimary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
  const btnGhost = `${btn} bg-muted text-foreground hover:bg-muted/70`;
  const btnDanger = `${btn} bg-destructive text-destructive-foreground hover:bg-destructive/90`;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Estado */}
      <div className="rounded-2xl border border-border/10 bg-card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-400" /> Estado de la sala</h3>
          <p className="text-sm text-muted-foreground mt-1">{room ? `Sala: ${room}` : "Sin conexión al bot (o sala programada: 20:00 Venezuela)."}</p>
        </div>
        <button className={btnGhost} onClick={load} disabled={busy === "load"}>
          {busy === "load" ? <Loader2 className="w-4 h-4 animate-spin" /> : "↻"} Refrescar
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.text}
        </div>
      )}

      {/* Premio */}
      <div className="rounded-2xl border border-border/10 bg-card p-5">
        <h3 className="font-bold mb-1">Premio mayor</h3>
        <p className="text-sm text-muted-foreground mb-4">Diamantes repartidos en partes iguales entre los sobrevivientes (mínimo 110). Aplica a la próxima sala.</p>
        <div className="flex gap-3 flex-wrap">
          <input
            type="number" min="110" value={prize} onChange={(e) => setPrize(e.target.value)}
            className="w-40 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          <button className={btnPrimary} onClick={savePrize} disabled={busy === "prize"}>
            <Save className="w-4 h-4" /> Guardar premio
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
    </div>
  );
}
