// Trivia Online Vex Store — página del participante.
// Motor en vivo por WebSocket (mismo host del bot, /ws/trivia). Reglas
// exactas que pidió el dueño:
//   · Gratis, una sesión diaria a las 20:00 hora de Venezuela.
//   · Registro con ID de jugador de Free Fire; ese ID recibe el premio.
//   · 10 preguntas × 10 s; 5 s de pausa entre respuesta y siguiente.
//   · Countdown de 3 s antes de la primera ("¡prepárate!").
//   · Voz (TTS del navegador) lee la pregunta en español.
//   · Corazones ganados por comprar (máx 3, tope diario); un fallo gasta
//     uno y revive. A partir de la 8ª pregunta ya no se pueden usar.
//   · Sin corazones → modo espectador (sigue viendo el juego y el chat).
//   · Chat en vivo para todos los participantes.
//   · Al final, ganadores = los vivos; premio 500 💎 repartido en partes
//     iguales y recargado por Venium a cada ID (lo hace el backend).
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Send, Trophy, Users, Volume2, VolumeX, PlayCircle, Clock } from "lucide-react";
import { verificarId } from "@/lib/mobentasClient";

const LS_TOKEN = "vex-trivia-token";
const LS_PLAYER_ID = "vex-trivia-player-id";
const LS_PLAYER_NICKNAME = "vex-trivia-player-nickname";
// La web de producción puede hablar con el bot vía mismo origen si lo
// despliegan bajo el mismo dominio, o con su URL pública configurada.
const BOT_HOST = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BOT_API) || "";
const botUrl = (path) => `${String(BOT_HOST).replace(/\/$/, "")}${path}`;
const botWsUrl = (path) => {
  const base = BOT_HOST
    ? String(BOT_HOST).replace(/^http/, "ws").replace(/\/$/, "")
    : window.location.origin.replace(/^http/, "ws");
  return `${base}${path}`;
};

function speak(text, enabled) {
  if (!enabled) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 1.1;
    synth.speak(u);
  } catch { /* silencio */ }
}

export default function Trivia() {
  const [phase, setPhase] = useState(() => localStorage.getItem(LS_PLAYER_ID) ? "restoring" : "connecting");
  const [socketOk, setSocketOk] = useState(false);
  const socketRef = useRef(null);
  const [me, setMe] = useState(null); // {status, hearts, nickname}
  const [token, setToken] = useState(() => localStorage.getItem(LS_TOKEN) || "");
  const [question, setQuestion] = useState(null); // {idx, text, options, ms}
  const [chosen, setChosen] = useState(null);
  const [correct, setCorrect] = useState(null);
  const [roundResult, setRoundResult] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [lobbyStartsAt, setLobbyStartsAt] = useState(0);
  const [lobbySeconds, setLobbySeconds] = useState(0);
  const [spectatorReason, setSpectatorReason] = useState("");
  const [countdown, setCountdown] = useState(3);
  const [chat, setChat] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [stats, setStats] = useState({ participants: 0, online: 0 });
  const [result, setResult] = useState(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [notice, setNotice] = useState("");
  const chatBoxRef = useRef(null);
  const voiceRef = useRef(true);

  useEffect(() => { voiceRef.current = voiceOn; }, [voiceOn]);

  // Revalida el registro guardado al volver a abrir la página. Si el token
  // anterior caducó o el servicio fue reiniciado, el mismo ID obtiene un
  // token nuevo sin obligar al participante a escribirlo otra vez.
  useEffect(() => {
    const savedPlayerId = localStorage.getItem(LS_PLAYER_ID);
    if (!savedPlayerId) return undefined;
    let alive = true;
    verifyPlayerId(savedPlayerId)
      .then((nickname) => fetch(botUrl("/api/trivia/register"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: savedPlayerId, nickname }),
      }))
      .then((res) => res.json())
      .then((data) => {
        if (!alive || !data?.token) return;
        localStorage.setItem(LS_TOKEN, data.token);
        if (data.nickname) localStorage.setItem(LS_PLAYER_NICKNAME, data.nickname);
        setToken(data.token);
        setMe({ status: "waiting", hearts: Number(data.hearts || 0), nickname: data.nickname });
        setPhase((prev) => (prev === "form" || prev === "connecting" || prev === "restoring" ? "lobby" : prev));
      })
      .catch(() => { /* la sala o el verificador pueden estar temporalmente cerrados */ });
    return () => { alive = false; };
  }, []);

  // Conexión WebSocket principal.
  useEffect(() => {
    let disposed = false;
    const url = token
      ? `${botWsUrl("/ws/trivia")}?token=${encodeURIComponent(token)}`
      : botWsUrl("/ws/trivia");
    const socket = new WebSocket(url);
    socketRef.current = socket;
    socket.onopen = () => {
      setSocketOk(true);
      setPhase((prev) => (prev === "connecting" ? "form" : prev));
    };
    socket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      handleMessage(msg);
    };
    socket.onclose = () => {
      if (disposed) return;
      setSocketOk(false);
      setTimeout(() => {
        if (disposed) return;
        try { socket.close(); } catch {}
        window.location.reload();
      }, 2000);
    };
    socket.onerror = () => setSocketOk(false);
    return () => {
      disposed = true;
      try { socket.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight; }, [chat]);

  useEffect(() => {
    if (phase !== "playing" || timeLeft <= 0) return undefined;
    const timer = setInterval(() => setTimeLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase, timeLeft]);

  useEffect(() => {
    if (phase !== "roundResult" || cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase, cooldown]);

  useEffect(() => {
    if (phase !== "lobby" || !lobbyStartsAt) return undefined;
    const update = () => setLobbySeconds(Math.max(0, Math.ceil((lobbyStartsAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [phase, lobbyStartsAt]);

  function handleMessage(msg) {
    switch (msg.type) {
      case "state":
        setStats({ participants: Number(msg.participants || 0), online: Number(msg.online || 0) });
        break;
      case "lobby":
        setPhase("lobby");
        if (msg.startsAt) setLobbyStartsAt(Number(msg.startsAt));
        break;
      case "countdown":
        setPhase("countdown");
        setCountdown(Number(msg.seconds || 5));
        speak("¡Prepárate! La trivia va a empezar", voiceRef.current);
        break;
      case "question":
        setPhase("playing");
        setChosen(null);
        setCorrect(null);
        setRoundResult(null);
        setTimeLeft(Math.ceil(Number(msg.ms || 10000) / 1000));
        setQuestion({ idx: Number(msg.idx || 0), text: String(msg.question || ""), options: msg.options || [], ms: Number(msg.ms || 10000) });
        speak(String(msg.question || ""), voiceRef.current);
        break;
      case "round_result":
        setCorrect(Number(msg.correct));
        setRoundResult({
          outcome: String(msg.outcome || "wrong"),
          chosen: msg.chosen == null ? null : Number(msg.chosen),
          correct: Number(msg.correct),
        });
        setPhase("roundResult");
        setCooldown(5);
        speak(msg.outcome === "correct" ? "¡Correcto!" : msg.outcome === "timeout" ? "¡Tiempo!" : "Respuesta incorrecta", voiceRef.current);
        break;
      case "answer_ack":
        if (msg.ok) {
          setRoundResult({
            outcome: msg.correct ? "correct" : "wrong",
            chosen: msg.chosen == null ? null : Number(msg.chosen) - 1,
            correct: Number(msg.correctIndex || 0),
          });
          setPhase("roundResult");
          speak(msg.correct ? "¡Correcto!" : "Respuesta incorrecta", voiceRef.current);
        }
        break;
      case "reveal":
        setCorrect(Number(msg.correct));
        setRoundResult((previous) => previous ? { ...previous, correct: Number(msg.correct) } : previous);
        setCooldown(5);
        break;
      case "chat":
        setChat((prev) => [...prev.slice(-100), { nickname: String(msg.nickname), text: String(msg.text) }]);
        break;
      case "you":
        setMe({ status: String(msg.status), hearts: Number(msg.hearts || 0), nickname: String(msg.nickname || "") });
        setPhase((prev) => (prev === "connecting" ? "lobby" : prev));
        if (String(msg.status) === "spectator") {
          setSpectatorReason(String(msg.reason || "no_hearts"));
          setNotice(String(msg.reason) === "late_stage" ? "Llegaste a la etapa final: ya no se pueden usar corazones." : "Perdiste todas tus vidas. Quedaste en modo espectador.");
        }
        if (String(msg.status) === "revived") {
          setSpectatorReason("");
          setNotice("❤️ Usaste un corazón y estás de vuelta en la trivia.");
        }
        break;
      case "late_join":
        setNotice(String(msg.message || "La trivia ya comenzó; podrás jugar en la próxima sala."));
        break;
      case "ended":
        setPhase("ended");
        setResult({
          winners: (msg.winners || []).map((w) => ({ nickname: String(w?.nickname || ""), playerId: String(w?.playerId || "") })),
          prize: Number(msg.prize || 0),
        });
        speak(`Trivia terminada. ${(msg.winners || []).length} ganadores hoy.`, voiceRef.current);
        break;
      default:
        break;
    }
  }

  async function register() {
    const input = document.getElementById("ff-id");
    const playerId = (input?.value || "").trim();
    if (!/^\d{6,12}$/.test(playerId)) {
      setNotice("Escribe tu ID de jugador de Free Fire (solo números, 6-12 dígitos).");
      return;
    }
    try {
      setNotice("Verificando tu ID de Free Fire...");
      const verifiedNickname = await verifyPlayerId(playerId);
      const res = await fetch(botUrl("/api/trivia/register"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, nickname: verifiedNickname, sessionId: undefined }),
      });
      const data = await res.json();
      if (data.error) { setNotice(String(data.error)); return; }
      localStorage.setItem(LS_PLAYER_ID, playerId);
      localStorage.setItem(LS_PLAYER_NICKNAME, verifiedNickname);
      localStorage.setItem(LS_TOKEN, data.token);
      setToken(data.token);
      setMe({ status: "waiting", hearts: Number(data.hearts || 0), nickname: data.nickname });
      setPhase("lobby");
      setNotice(`¡ID verificado: ${verifiedNickname}! Te esperamos a las 8:00 pm 🎉`);
    } catch (e) {
      setNotice(e?.message || "No se pudo verificar tu ID. Revisa el número e inténtalo de nuevo.");
    }
  }

  async function verifyPlayerId(playerId) {
    const result = await verificarId("free-fire", playerId);
    if (!result?.ok || !result.nickname) {
      throw new Error(result?.error || "No se encontró un jugador con ese ID.");
    }
    return String(result.nickname).trim().slice(0, 24);
  }

  function answer(i) {
    if (!question || chosen !== null || (me && me.status === "spectator")) return;
    setChosen(i);
    socketRef.current?.send(JSON.stringify({ type: "answer", chosen: i + 1, msTaken: 0 }));
  }

  function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;
    socketRef.current?.send(JSON.stringify({ type: "chat", text: text.slice(0, 200) }));
    setChatDraft("");
  }

  const hearts = useMemo(() => Array.from({ length: Math.max(0, me?.hearts ?? 0) }), [me?.hearts]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#3217f5] text-white px-4 pb-24 pt-6 max-w-md mx-auto">
      <div className="pointer-events-none absolute -left-24 top-[330px] h-72 w-72 rounded-full bg-[#ffd019]" />
      <div className="pointer-events-none absolute -right-28 top-0 h-96 w-80 rounded-[45%] bg-[#12b8a6]" />
      <div className="pointer-events-none absolute -right-28 bottom-0 h-80 w-80 rounded-[45%] bg-[#12b8a6]" />
      <div className="relative z-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${socketOk ? "bg-green-500 animate-pulse" : "bg-gray-500"}`} />
            Trivia Online · gratis
          </p>
          <h1 className="text-2xl font-black tracking-tight mt-0.5">
            Vex <span className="text-primary">Trivia</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceOn((v) => !v)}
            className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center tap"
            aria-label={voiceOn ? "Silenciar voz" : "Activar voz"}
          >
            {voiceOn ? <Volume2 className="w-5 h-5 text-primary" /> : <VolumeX className="w-5 h-5 text-muted-foreground" />}
          </button>
          <div className="px-3 h-10 rounded-full bg-card border border-border flex items-center gap-1 text-xs">
            <Heart className="w-4 h-4 text-red-500 fill-red-500" />
            <span className="font-bold">{hearts.length}</span>
          </div>
        </div>
      </div>

      {stats.participants > 0 && (
        <div className="surface rounded-2xl px-4 py-3 mb-4 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Users className="w-4 h-4 text-primary" /> {stats.participants} anotados
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> {stats.online} en línea
          </span>
          <span className="flex items-center gap-2 font-medium">
            <Trophy className="w-4 h-4 text-amber-400" /> 500 💎
          </span>
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase === "connecting" && (
          <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 text-center text-muted-foreground">
            Conectando a la trivia…
          </motion.div>
        )}

        {phase === "restoring" && (
          <motion.div key="restoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-20 text-center text-white/80">
            Restaurando tu registro verificado…
          </motion.div>
        )}

        {phase === "form" && (
          <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="surface rounded-2xl p-5">
            <h2 className="text-lg font-black mb-1">Regístrate para jugar</h2>
            <p className="text-sm text-muted-foreground mb-4">Ingresa tu ID de jugador de Free Fire. Ese ID es tu usuario y el destino del premio si ganas.</p>
            <input id="ff-id" inputMode="numeric" placeholder="ID de jugador (ej. 7879946990)"
              className="w-full h-12 rounded-xl bg-input border border-border px-4 mb-3 outline-none focus:border-primary" />
            <button onClick={register} className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold tap glow-primary">
              Unirme a la trivia
            </button>
            {notice && <p className="mt-3 text-sm text-amber-400">{notice}</p>}
            <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
              ⏰ Todos los días a las <b className="text-foreground">8:00 pm</b> (Venezuela) abre la sala.
              Gratis, 10 preguntas sobre Free Fire, 10 s por pregunta y voz que te lee la pregunta.
              Compra recargas para ganar <Heart className="w-3 h-3 inline text-red-500 fill-red-500" /> corazones (máx 3 al día).
            </p>
          </motion.div>
        )}

        {phase === "lobby" && (
          <motion.div key="lobby" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="surface rounded-2xl p-5 text-center">
            <PlayCircle className="w-12 h-12 text-primary mx-auto mb-2" />
            <h2 className="text-lg font-black">Estás dentro, {me?.nickname}!</h2>
            <p className="text-sm text-muted-foreground mt-1">La trivia comenzará a la hora programada. Deja esta página abierta.</p>
            <div className="my-5 text-5xl font-black tracking-wider text-white">{String(Math.floor(lobbySeconds / 3600)).padStart(2, "0")}:{String(Math.floor((lobbySeconds % 3600) / 60)).padStart(2, "0")}:{String(lobbySeconds % 60).padStart(2, "0")}</div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/70">Cuando llegue a cero: prepárate</p>
            <div className="flex items-center justify-center gap-1 mt-4">
              {hearts.map((_, i) => <Heart key={i} className="w-5 h-5 text-red-500 fill-red-500" />)}
              <span className="text-xs text-muted-foreground ml-2">{hearts.length} corazones</span>
            </div>
            {notice && <p className="mt-3 text-sm text-primary">{notice}</p>}
          </motion.div>
        )}

        {phase === "countdown" && (
          <motion.div key="countdown" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="py-20 text-center">
            <motion.div key={countdown} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="text-7xl font-black text-primary">{countdown}</motion.div>
            <p className="mt-4 text-lg font-bold flex justify-center items-center gap-2"><Clock className="w-5 h-5 text-primary" /> ¡Prepárate, la trivia va a empezar!</p>
          </motion.div>
        )}

        {phase === "playing" && question && (
          <motion.div key={`q-${question.idx}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            {me?.status === "spectator" && (
              <div className="mb-4 rounded-3xl border-2 border-[#ffd019] bg-[#11104c]/95 p-5 text-center shadow-xl">
                <p className="text-2xl font-black">Perdiste</p>
                <p className="mt-1 text-white/80">{spectatorReason === "late_stage" ? "Llegaste a la etapa final." : "Te quedaste sin vidas."}</p>
                <p className="mt-2 text-sm font-bold text-[#ffd019]">Estás en modo espectador. Puedes seguir viendo la Trivia.</p>
              </div>
            )}
            <div className="flex items-center justify-between mb-4 text-lg font-bold">
              <span>Pregunta {question.idx + 1} / 10</span>
              <span className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#101044] bg-[#3217f5] text-xl font-black shadow-lg">00:{String(timeLeft).padStart(2, "0")}</span>
            </div>
            <div className="rounded-3xl bg-white px-5 py-8 text-center text-[#17143f] shadow-xl">
              <h2 className="text-xl font-black leading-tight">{question.text}</h2>
            </div>
            <div className="mt-4 space-y-3">
              {question.options.map((opt, i) => {
                const isChosen = chosen === i;
                const isCorrect = correct !== null && correct === i + 1;
                const disabled = chosen !== null || !me || me.status === "spectator";
                const cls = isCorrect ? "bg-[#20c997]"
                  : isChosen ? "bg-[#ef5b63]"
                  : "bg-[#087cf1] hover:bg-[#1b8bff]";
                return (
                  <button key={i} onClick={() => answer(i)} disabled={disabled}
                    className={`w-full min-h-[76px] text-left rounded-3xl px-5 py-4 text-lg font-bold shadow-lg tap transition-colors ${cls} ${disabled ? "opacity-80" : ""}`}>
                    <span className="mr-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/10 font-black">{String.fromCharCode(65 + i)}</span>{opt}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {phase === "roundResult" && question && roundResult && (
          <motion.div key="round-result" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
            <h2 className="text-6xl font-black tracking-tight drop-shadow-lg">
              {roundResult.outcome === "correct" ? "¡CORRECTO!" : roundResult.outcome === "timeout" ? "¡TIEMPO!" : "¡FALLASTE!"}
            </h2>
            {roundResult.outcome === "timeout" && <p className="mt-8 text-xl font-bold text-white/80">No respondiste a tiempo: cuenta como fallo</p>}
            {roundResult.outcome === "wrong" && <p className="mt-8 text-xl font-bold text-white/80">Tu respuesta no era la correcta: cuenta como fallo</p>}
            <p className="mt-3 text-xl font-bold text-white/75">La respuesta correcta era:</p>
            <div className="mt-4 text-4xl font-black text-[#35e0a1]">{String.fromCharCode(64 + roundResult.correct)}</div>
            <div className="mt-8 rounded-3xl bg-[#11104c]/90 p-5 text-left flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#6e67aa] text-2xl font-black text-white/90">{cooldown}</div>
              <div><p className="text-sm font-black uppercase tracking-wider">Siguiente pregunta</p><p className="text-lg font-bold text-white/70">{cooldown ? "Prepárate..." : "¡Ya viene!"}</p></div>
            </div>
          </motion.div>
        )}

        {phase === "ended" && result && (
          <motion.div key="ended" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="surface rounded-2xl p-5 text-center">
            <Trophy className="w-14 h-14 text-amber-400 mx-auto mb-3" />
            <h2 className="text-xl font-black">{result.winners.length ? "¡Trivia terminada!" : "Hoy no hubo ganadores"}</h2>
            {result.winners.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground mt-2">
                  {result.winners.length} ganador{result.winners.length > 1 ? "es" : ""} · {result.prize} 💎 para cada uno
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  {result.winners.slice(0, 10).map((w, i) => (
                    <li key={i}>🏆 {w.nickname || "Jugador"} ({w.playerId})</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground mt-3">La recarga de diamantes se envía automática a cada ID ganador.</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6">
        <div ref={chatBoxRef} className="h-40 overflow-y-auto scrollbar-hide rounded-2xl bg-[#11104c]/90 p-3 space-y-1.5 text-sm">
          {chat.length === 0 && <p className="text-muted-foreground text-xs">Saluda a los demás jugadores 👋 (el chat es del lobby; el bot y los admins moderan el contenido)</p>}
          {chat.map((m, i) => (
            <p key={i}><span className="text-primary font-semibold">{m.nickname}:</span> {m.text}</p>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
            placeholder="Escribe un mensaje…"
            className="flex-1 h-11 rounded-xl bg-input border border-border px-4 outline-none focus:border-primary" />
          <button onClick={sendChat} className="w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center tap" aria-label="Enviar mensaje">
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
