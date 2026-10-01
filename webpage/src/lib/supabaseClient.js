// Cliente ligero para Supabase usando fetch (sin instalar supabase-js).
//
// Arquitectura de seguridad:
// - La URL y anon key de Supabase se guardan en Settings (el anon key es
//   público por diseño, protegido por RLS en Supabase).
// - Las API keys secretas (Gemini, UltraMsg, Pabilo) viven en las Edge
//   Functions de Supabase como environment variables, NUNCA en el navegador.
// - El frontend llama a las Edge Functions, que internamente usan las keys
//   secretas y devuelven solo el resultado al cliente.

import { base44 } from "@/api/base44Client";

let _config = null;

export async function getSupabaseConfig() {
  if (_config) return _config;
  try {
    const recs = await base44.entities.Setting.filter({ key: "supabase" });
    const parsed = recs?.[0]?.value ? JSON.parse(recs[0].value) : {};
    _config = { url: (parsed.url || "").replace(/\/+$/, ""), anonKey: parsed.anonKey || "" };
  } catch {
    _config = { url: "", anonKey: "" };
  }
  return _config;
}

export async function isSupabaseConfigured() {
  const cfg = await getSupabaseConfig();
  return !!(cfg.url && cfg.anonKey);
}

// Llama a una Edge Function de Supabase. Las API keys secretas viven en la
// función (como env vars del proyecto), no en el navegador.
export async function callEdgeFunction(name, body = {}) {
  const cfg = await getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) throw new Error("Supabase no configurado");
  const res = await fetch(`${cfg.url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.anonKey}`,
      apikey: cfg.anonKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Edge function "${name}" falló: ${res.status} ${text}`);
  }
  return res.json();
}

// Consulta la REST API de Supabase (PostgREST) para leer tablas.
export async function supabaseQuery(table, params = {}) {
  const cfg = await getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) throw new Error("Supabase no configurado");
  const url = new URL(`${cfg.url}/rest/v1/${table}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, {
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase query falló: ${res.status}`);
  return res.json();
}

// Inserta una fila en una tabla de Supabase (para logs/analytics).
export async function supabaseInsert(table, data) {
  const cfg = await getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) throw new Error("Supabase no configurado");
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase insert falló: ${res.status}`);
  return true;
}