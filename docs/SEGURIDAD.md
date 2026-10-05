# Auditoría de seguridad — Vex Store

Fecha: 5 de octubre de 2026.
Alcance: web (`webpage/`), bot (`src/`), API pública del bot y la base de datos
Base44 (`app id 6a5b9606e1931edeb474236e`).

Todo lo de abajo se **comprobó** contra los servicios reales, no es teoría. Las
consultas fueron de solo lectura; no se creó ni modificó ningún registro.

---

## CRÍTICO 1 — Toda la base de datos de clientes es pública

`GET https://base44.app/api/apps/6a5b9606e1931edeb474236e/entities/Order`
responde **200 y 86 pedidos** sin ninguna credencial. Igual con `Creator`
(7 registros) y `CreatorVideo` (11).

Los campos que quedan a la vista de cualquiera:

- `customer_email`, `customer_whatsapp`, `customer_ip`
- `player_id`, `server`, `product_name`, `price`, `bank_reference`
- `receipt_url` — los comprobantes de pago subidos por los clientes
- `delivery_code` — **el código de entrega, es decir el producto que ya pagaron**
- `payment_log`, `vuelto_log`

Impacto: cualquiera puede descargar la lista de clientes con sus teléfonos,
correos e IPs (una base de datos para estafar a tus propios clientes), y
robarse los códigos de recarga no canjeados.

Por qué pasa: el frontend estático habla **directo** con Base44 desde el
navegador, así que Base44 no puede distinguir un cliente legítimo de un
atacante. Toda entidad que el navegador necesite leer termina con lectura
pública.

### Arreglo (hay que hacerlo en el panel de Base44)

En Base44 → Entities → cada entidad → Permisos (RLS):

1. **`Order`**: lectura solo si `created_by_id == $user.id` o el usuario es
   admin. Hoy está en lectura pública.
2. **`Creator`**: quitar `panel_pin` del acceso público (es la contraseña de 6
   dígitos del panel del creador y hoy se puede leer).
3. **`SecretSetting`**: ya está protegido (devuelve `[]` sin autenticación).
   **Mover ahí las claves del punto CRÍTICO 2.**

Mientras se hace el cambio de fondo: no compartir la URL de la API ni el
`app id`, porque no hace falta descubrirlos para explotar esto.

---

## CRÍTICO 2 — Las claves de API están en una entidad de lectura pública

`GET .../entities/Setting?key=pabilo` responde 200 sin credenciales con:

```json
{"api_key":"f9963842-…-a12771b61c06","user_bank_id":"6a810d62…"}
```

Lo mismo con las otras claves guardadas en `Setting`:

| key       | qué expone                                             |
|-----------|--------------------------------------------------------|
| `pabilo`  | clave de verificación de pagos + banco receptor        |
| `gemini`  | API key de Google (gasto a tu nombre)                  |
| `venium`  | `auth_key` del proxy de recargas                        |
| `whatsapp_api` | `api_token` de UltraMsg (enviar WhatsApp como tú) |
| `hlgaming`| `api_key` del proveedor                                |
| `supabase`| URL + `anonKey` (este último es público por diseño)    |

Impacto: quien copie la clave de Pabilo puede quemar tus créditos de
verificación; con la de UltraMsg puede escribirle a tus clientes; con la de
Venium puede tocar tu saldo de recargas.

### Arreglo

1. **Rotar las claves ya** (asumir que están comprometidas): nueva clave de
   Pabilo desde su panel, nueva API key de Gemini, rotar el token de UltraMsg y
   la `auth_key` del proxy de Venium.
2. Guardar cada clave en **`SecretSetting`** (que sí es privado) o en las
   variables de entorno. `webpage/src/components/admin/SettingsPanel.jsx` hoy
   escribe todo en `Setting`; hay que apuntarlo a `SecretSetting`.
3. Para Pabilo existe ya la Edge Function `webpage/supabase/functions/verify-payment`,
   que lee la clave de las variables del proyecto y **no la manda al navegador**.
   Esa es la vía correcta: la web debe usarla y no la llamada directa.

Nota: la escritura sí está protegida (`POST` a `Setting` devuelve 403 sin
sesión de admin), así que el daño es de **confidencialidad**, no de integridad.

---

## MEDIO 3 — `/documentacion` contaba la arquitectura a cualquiera

Página pública que listaba proveedores, entidades, nombres de variables de
entorno y el esquema de la base de datos. **Ya está corregida**: la ruta pasó
detrás de `ProtectedRoute` en `webpage/src/App.jsx`.

---

## MEDIO 4 — Endpoints de escritura del bot sin autenticación

En el bot, abiertos a internet sin credenciales:

- `POST /api/orders` — crea pedidos. Un tercero puede llenar la base de pedidos
  basura y disparar notificaciones.
- `POST /api/orders/:id/payment` y `.../payment-receipt` — aceptan datos de
  pago de un pedido ajeno si se adivina el UUID.
- `POST /api/moderation/check` — consulta la moderación sin coste para el
  atacante.

Los tres exigen conocer el `id` (UUID v4, no adivinable) salvo
`POST /api/orders`, que no pide nada. Lo correcto es exigir la clave interna
que ya existe (`BDV_VERIFY_KEY` o una nueva `INTERNAL_API_KEY`) en la cabecera.

`/api/catalog` y `/health` son públicos a propósito y no exponen datos de
clientes.

`/health` sí publica, a propósito, con qué credenciales de Pabilo trabaja el
contenedor: el **id del banco receptor**, de dónde sale (`env` o panel), el
tipo de movimiento y **los últimos 4 caracteres de la clave**. Es deliberado y
de riesgo bajo: sin la clave el id del banco no sirve para nada, y 4 caracteres
de un UUID no permiten reconstruirlo (es el mismo dato que ya imprime en
pantalla `scripts/pabilo-tool.ts config`). Sin eso no había forma de saber si
un cambio de variables tomó efecto en el contenedor, y el único síntoma era
"los pagos no confirman".

---

## BAJO 5 — Claves "públicas" de los Cloudflare Workers

`webpage/src/proxy/*.worker.js` llevan la llave en el código
(`legacy_bdv_2025`, `legacy_mobentas_2025`, `nxs_pases_2025`,
`legacy_uploads_2025`). El propio código explica que solo evitan el uso casual
y que la seguridad real es el secreto del Worker. Se dejan como están, pero
conviene rotarlas cuando se roten las demás.

---

## Lo que ya estaba bien

- Los endpoints de admin del bot piden Basic Auth (`/api/admin/*` → 401 sin
  credenciales).
- La verificación de pagos nunca convierte un fallo técnico en un rechazo.
- Las firmas de los webhooks de Meta y Venium se comprueban en modo live.
- El apagado de BDV es total: `POST /api/bdv/verify` responde 503 sin tocar el
  banco.
