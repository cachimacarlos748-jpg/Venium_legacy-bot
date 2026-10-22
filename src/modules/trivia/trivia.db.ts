import type Database from "better-sqlite3";

export interface TriviaQuestionRow {
  id: number;
  question: string;
  options: string; // JSON string: ["a","b","c","d"]
  correct: number; // 1..4
  active: number;
}

export interface TriviaSessionRow {
  id: string;
  date: string;           // FEcha VE YYYY-MM-DD (día de la sesión)
  status: "scheduled" | "lobby" | "countdown" | "playing" | "ended";
  prize_diamonds: number;
  question_ids: string | null; // JSON string orden de preguntas de Esta sesión
  started_at: string | null;
  ended_at: string | null;
}

export interface TriviaPlayerRow {
  session_id: string;
  token: string;
  player_id: string;      // ID de jugador de Free Fire (clave del espectador/premio)
  nickname: string;       // nombre en el juego verificado (o custom)
  hearts: number;         // vidas ganadas por compras
  hearts_used: number;    // corazones gastados durante esta sala
  status: "waiting" | "alive" | "eliminated" | "spectator" | "winner";
  question_idx: number;   // índice de la pregunta actual que el jugador responde
  connected: number;      // 1 si WS está conectado
  joined_at: string;
}

export interface TriviaAnswerRow {
  session_id: string;
  token: string;
  question_idx: number;
  chosen: number;
  correct: number;
  ms_taken: number;
  created_at: string;
}

export interface TriviaChatRow {
  id: number;
  session_id: string;
  token: string;
  nickname: string;
  message: string;
  created_at: string;
}

const CREATE_SQLS = [
  `CREATE TABLE IF NOT EXISTS trivia_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    correct INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS trivia_sessions (
    id TEXT PRIMARY KEY,
    date TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    prize_diamonds INTEGER NOT NULL DEFAULT 0,
    question_ids TEXT,
    started_at TEXT,
    ended_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS trivia_players (
    session_id TEXT NOT NULL,
    token TEXT NOT NULL,
    player_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    hearts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'waiting',
    question_idx INTEGER NOT NULL DEFAULT 0,
    connected INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    PRIMARY KEY(session_id, token),
    FOREIGN KEY(session_id) REFERENCES trivia_sessions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trivia_players_player_id ON trivia_players(player_id)`,
  `CREATE TABLE IF NOT EXISTS trivia_answers (
    session_id TEXT NOT NULL,
    token TEXT NOT NULL,
    question_idx INTEGER NOT NULL,
    chosen INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    ms_taken INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(session_id, token, question_idx)
  )`,
  `CREATE TABLE IF NOT EXISTS trivia_chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    token TEXT NOT NULL,
    nickname TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trivia_heart_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    hearts INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'purchase',
    order_id TEXT,
    created_at TEXT NOT NULL
  )`,
  // Configuración del dueño desde el panel (premio, cupos/limites).
  `CREATE TABLE IF NOT EXISTS trivia_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trivia_prize_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    diamonds INTEGER NOT NULL,
    venium_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL
  )`,
];

export function initTriviaTables(db: Database.Database): void {
  for (const sql of CREATE_SQLS) db.exec(sql);
  // Migración compatible con la base SQLite existente.
  try { db.exec("ALTER TABLE trivia_players ADD COLUMN hearts_used INTEGER NOT NULL DEFAULT 0"); } catch { /* ya existe */ }
}

export function seedTriviaQuestions(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM trivia_questions").get() as { n: number }).n;
  if (count > 0) return;
  // Pack inicial de preguntas de Free Fire (se irán ampliando editando la tabla
  // o en un panel futuro; cada una espera 4 opciones numeradas correct 1-4).
  const seed: Array<[string, string[], number]> = [
    ["¿Quién es el personaje de Free Fire masculino que envejece más lento que los demás?", ["Antonio", "Kla", "Jota", "K"], 4],
    ["¿Qué pase solo existe como único pase, no permite modos de juego?", ["Pase Booyah", "Pase Elite", "Pase de Nivel", "Pase de Lote"], 1],
    ["¿Cuál es la habilidad de la personaje Kelly de Free Fire?", ["Salto más rápido", "Esprintar más rápido", "Saltar más alto", "Ver a través de la pared"], 2],
    ["¿En qué año se lanzó Free Fire originalmente?", ["2012", "2015", "2017", "2020"], 3],
    ["¿Qué empresa desarrolló Free Fire?", ["Tencent", "111dots Studio (Garena)", "NetEase", "Riot Games"], 2],
    ["¿Cuál es el nombre del booyah en Free Fire (victoria)?", ["Booyah", "GG", "Winner", "MVP"], 1],
    ["¿Cuántos jugadores habrá normalmente en una partida de Free Fire?", ["50", "80", "100", "150"], 1],
    ["¿Qué es la 'dinería' en Free Fire?", ["Dinero del juego", "Puntos de rango", "Saldo de la tienda interna", "Moneda del pase Booyah"], 1],
    ["¿En qué modo de juego se juega 'patrulla'? (FF modalidades)", ["Modo Escoltas", "Modo de Ficha", "Modo Personalizado", "Modo Ranking"], 3],
    ["¿Qué arma gratuita usualmente roba un pasamontañas en Free Fire?", ["MP40", "AK47", "VSS", "M249"], 2],
    ["¿El 'Alok' de Free Fire es famoso porque...?", ["Canta con movimiento y regenera vida", "Salta paredes", "Aguanta mucho daño", "Corre más rápido que todos"], 1],
    ["¿Cuántos pases de nivel hay disponibles diariamente en Free Fire?", ["6", "10", "12", "20"], 3],
    ["¿Qué es el 'Booyah Pass', el pase de temporada Premium de Free Fire?", ["Un pase con recompensas exclusivas por temporada", "Un personaje", "Un arma", "Un mapa"], 1],
    ["¿'Squad Beatz' es un modo de juego de Free Fire relacionado con...?", ["Karaoke en equipo", "Música, aparece un DJ", "Duelos 1v1", "Bombas"], 2],
    ["¿En Free Fire, el 'grupo standoff' se juega en...", ["Menú ganga (clan)", "Modo Escolta", "Modo Classified", "Modo Duelo por equipo"], 1],
    ["¿Qué 'año nuevo' Free Fire celebra a nivel mundial cada enero con ceremonias in-game?", ["Año nuevo chino", "Aniversario", "Navidad", "Halloween"], 1],
    ["¿A partir de qué nivel es posible entrar a modo clasificado (Rank) en Free Fire?", ["Nivel 1", "Nivel 5", "Nivel 10", "Nivel 15"], 2],
    ["¿Cuál es el máximo de jugadores por equipo en la clasificación normal (squad)?", ["2", "4", "8", "16"], 2],
  ];
  const insert = db.prepare("INSERT INTO trivia_questions (question, options, correct) VALUES (?, ?, ?)");
  for (const [q, opts, correct] of seed) insert.run(q, JSON.stringify(opts), correct);
}
