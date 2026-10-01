# Supabase Setup — Legacy Store

## 1. Crear proyecto en Supabase
1. Ve a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Anota la **Project URL** y la **anon key** (Settings > API).

## 2. Configurar en Legacy Store
En el panel de admin > "Pagos y Config", agrega un setting con:
- **Key:** `supabase`
- **Value:** `{"url":"https://xxx.supabase.co","anonKey":"eyJhbGci..."}`

## 3. Deploy de Edge Functions
Las Edge Functions ocultan las API keys (Gemini, UltraMsg, Pabilo) del navegador.

```bash
# Instalar Supabase CLI
npm install -g supabase

# Login
supabase login

# Link al proyecto
supabase link --project-ref xxx

# Configurar secrets (las API keys que antes estaban en el navegador)
supabase secrets set GEMINI_API_KEY=tu_key_de_gemini
supabase secrets set ULTRAMSG_INSTANCE_ID=tu_instance_id
supabase secrets set ULTRAMSG_TOKEN=tu_token_de_ultramsg
supabase secrets set PABILO_API_KEY=tu_key_de_pabilo
supabase secrets set PABILO_BANK_ID=tu_bank_id

# Deploy
supabase functions deploy verify-receipt --no-verify-jwt
supabase functions deploy send-whatsapp --no-verify-jwt
supabase functions deploy verify-payment --no-verify-jwt
```

## 4. Edge Functions disponibles

### verify-receipt
- **Input:** `{ prompt, images: [url], responseJsonSchema }`
- **Output:** respuesta de Gemini (texto o JSON)
- **Env vars:** `GEMINI_API_KEY`

### send-whatsapp
- **Input:** `{ to, message }` o `{ to, image, caption }`
- **Output:** respuesta de UltraMsg
- **Env vars:** `ULTRAMSG_INSTANCE_ID`, `ULTRAMSG_TOKEN`

### verify-payment
- **Input:** `{ reference, amount }`
- **Output:** respuesta de Pabilo
- **Env vars:** `PABILO_API_KEY`, `PABILO_BANK_ID`

## 5. Seguridad
- La **anon key** de Supabase es pública por diseño (protegida por RLS).
- Las **API keys** (Gemini, UltraMsg, Pabilo) viven SOLO en las Edge Functions.
- El navegador nunca ve ni toca las API keys directamente.