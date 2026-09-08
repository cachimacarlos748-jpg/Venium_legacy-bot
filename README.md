# Venium WhatsApp Bot

Servicio modular para:

```text
cotización local → comprobante → extracción Gemini
→ antifraude backend → validación Pabilo → autorización Venium
```

El proyecto arranca en modo seguro:

- Venium: `mock`
- Pabilo: `mock`
- Gemini: `disabled`
- WhatsApp/Baileys: `disabled`
- Creación de órdenes Venium live: bloqueada

No contiene claves reales ni valores reales del archivo de ejemplo de Pabilo.

## Ejecutar localmente de forma segura

```bash
cp .env.example .env
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000/admin
```

El panel usa Basic Auth. Configurar `ADMIN_PASSWORD` antes de abrirlo.

El arranque seguro no requiere credenciales reales: Venium y Pabilo usan
`mock`, mientras Gemini y WhatsApp están deshabilitados. Para probar el flujo
completo localmente se puede configurar un `paymentDestinationJson` ficticio
desde el panel.

## Pabilo implementado

El adaptador usa solamente las formas mostradas en los ejemplos entregados:

- Base URL configurable con `PABILO_BASE_URL`.
- `GET /me/usersbank` está disponible en `/api/admin/pabilo/banks`.
- Verificación con `POST /userbankpayment/{userBankId}/betaserio`.
- Header `appKey`.
- Body con `amount`, `bank_reference` y `movement_type`.
- Solo `data.is_new === true` autoriza el siguiente paso.
- `BANK_NOT_AVAILABLE`, `PAYMENT_NOT_FOUND` y duplicados no autorizan Venium.

La integración se encuentra en `src/modules/pabilo/pabilo.client.ts`.

No se agregaron endpoints distintos a los observados en la documentación de
Pabilo. Para activar live faltan exactamente `PABILO_API_KEY` y el
`PABILO_USER_BANK_ID` de la cuenta que se quiere consultar. El último valor
también puede confirmarse desde `/api/admin/pabilo/banks`.

## Venium y Gemini

Venium usa la API de reseller documentada:

- `GET /api/reseller/catalog`
- `GET /api/reseller/balance`
- `GET /api/reseller/orders`
- `POST /api/reseller/orders`
- Header `X-API-Key: VENIUM_API_KEY`

El catálogo se sincroniza al arrancar y también desde el panel. Para activar
la integración live falta `VENIUM_API_KEY`. La creación de órdenes reales
requiere además `ALLOW_LIVE_ORDER_CREATION=true`; permanece bloqueada mientras
ese flag sea `false`.

Gemini recibe texto o imagen y extrae únicamente `reference`, `amountBs`,
`paymentDate`, `bank` y `recipientData`. Nunca confirma el pago ni decide si
una orden debe crearse. Para activarlo faltan `GEMINI_API_KEY` y
`GEMINI_MODE=live`.

## WhatsApp / Baileys

`WHATSAPP_MODE=live` conecta WhatsApp Web con Baileys. Al arrancar:

1. Se crea o reutiliza la sesión en `WHATSAPP_AUTH_DIR`.
2. Se imprime el QR en los logs; se escanea desde WhatsApp → Dispositivos vinculados.
3. Se guardan las credenciales en el directorio de sesión, que debe estar en un volumen persistente.
4. Los mensajes entrantes pasan por moderación antes de ser procesados.

El flujo conversacional implementado es:

```text
CATÁLOGO → COMPRA <número o packageId> → datos del jugador
→ comprobante como imagen/texto → Gemini extrae
→ antifraude local → Pabilo confirma → Venium crea la orden
```

El bot ignora grupos por defecto (`WHATSAPP_ALLOW_GROUPS=false`) y no procesa
mensajes enviados por sí mismo.

## Flujo del MVP

1. `POST /api/orders` crea un pedido local y congela la cotización.
2. El endpoint público devuelve solamente precio en Bs y datos operativos; no expone costo USD, tasa ni margen.
3. `POST /api/orders/:id/payment` recibe los datos extraídos del comprobante y su hash.
4. El backend compara el monto con el total congelado.
5. SQLite reserva la referencia y el hash antes de contactar Pabilo.
6. Se validan destino configurado, fechas y duplicados.
7. Solo un comprobante antifraude limpio llega a Pabilo.
8. Solo `data.is_new === true` permite avanzar a Venium.
9. En modo mock se crea un `MOCK-*`; en live la creación está bloqueada mientras `ALLOW_LIVE_ORDER_CREATION=false`.
10. `POST /webhooks/venium` verifica HMAC, timestamp e idempotencia.

## Antifraude

Implementado en `src/modules/antifraud/antifraud.service.ts`.

- Referencia bancaria única en SQLite.
- Hash de comprobante único para valores no vacíos.
- Reserva transaccional antes de Pabilo para proteger concurrencia.
- Comparación contra el monto congelado.
- Comparación de los datos del receptor contra `paymentDestinationJson`.
- Registro de banco, fecha, receptor, cliente, hash, estados y `venium_order_id`.
- Eventos sospechosos en `payment_security_events`.
- Un pago sospechoso nunca llama a Pabilo ni Venium.

El destino esperado se configura desde el panel como JSON, por ejemplo con valores ficticios:

```json
{"bank":"Banco Demo","account":"0000"}
```

## Anti-spam y moderación

Implementado en `src/modules/moderation/moderation.service.ts`.

- Rate limit por usuario dentro de una ventana configurable.
- Detección de mensajes repetidos mediante hash.
- Advertencias.
- Cooldown.
- Bloqueo automático configurable.
- Lista de bloqueados y desbloqueo administrativo.
- Historial de motivos y acciones.
- Clasificaciones `abuse`, `harassment` e `insult`.
- La clasificación `competitor` no genera una infracción por sí sola.

El adaptador también expone:

```text
POST /api/moderation/check
```

antes de procesar o responder un mensaje. El flujo Baileys ya lo consulta
internamente.

## Pruebas manuales seguras

Con el servidor en modo mock, crear una cotización:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"whatsappJid":"demo@s.whatsapp.invalid","packageId":"mock-100-diamantes","playerData":{"playerid":"123"}}'
```

Para probar Pabilo mock, usar un `PABILO_USER_BANK_ID` ficticio, por ejemplo:

```text
PABILO_USER_BANK_ID=mock-bank
```

No usar un User Bank ID real en pruebas.

## Variables de entorno y secretos

Ver `.env.example`. Las claves y secretos son únicamente:

- `VENIUM_API_KEY`
- `PABILO_API_KEY`
- `GEMINI_API_KEY`
- `VENIUM_WEBHOOK_SECRET`
- `ADMIN_PASSWORD`
- `WHATSAPP_AUTH_DIR` (ruta, no secreto; debe ser persistente)

Las claves nunca se guardan en SQLite, en el código ni en el panel. En
producción deben configurarse como secrets/variables del proveedor:

```text
VENIUM_MODE=live
VENIUM_API_KEY=...
ALLOW_LIVE_ORDER_CREATION=false
PABILO_MODE=live
PABILO_API_KEY=...
PABILO_USER_BANK_ID=...
GEMINI_MODE=live
GEMINI_API_KEY=...
WHATSAPP_MODE=live
ADMIN_PASSWORD=...
VENIUM_WEBHOOK_SECRET=...
```

## Seguridad y operación

- El flujo live no se puede verificar sin las credenciales reales del operador.
- Pabilo sigue siendo la autoridad: Gemini no puede autorizar órdenes.
- `ALLOW_LIVE_ORDER_CREATION=false` es el valor recomendado hasta completar una prueba controlada.
- El panel usa Basic Auth y debe exponerse únicamente detrás de HTTPS.
- El volumen persistente debe incluir `/app/data`, tanto para SQLite como para la sesión de WhatsApp.
- El `PABILO_USER_BANK_ID` no se inventa: se configura con el identificador real devuelto por Pabilo.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

SQLite queda persistido en el volumen `venium-data`.

## Desplegar en Northflank

Crear un servicio desde este repositorio usando `Dockerfile`. No es necesario
usar `docker-compose` en Northflank.

1. Configura el puerto HTTP del servicio en `3000` o usa el valor de `PORT` que
   Northflank inyecte.
2. Añade un volumen persistente montado en `/app/data`.
3. Configura todas las variables de `.env.example` en la sección de variables
   y secrets; nunca subas `.env`.
4. Empieza con `VENIUM_MODE=mock`, `PABILO_MODE=mock`,
   `GEMINI_MODE=disabled` y `WHATSAPP_MODE=disabled`.
5. Verifica `/health`, el panel y las pruebas de cotización.
6. Cambia a live solamente cuando tengas `VENIUM_API_KEY`,
   `PABILO_API_KEY`, `PABILO_USER_BANK_ID`, `GEMINI_API_KEY`,
   `VENIUM_WEBHOOK_SECRET` y el destino de pago configurado.
7. Para WhatsApp live, establece `WHATSAPP_MODE=live`, despliega, escanea el
   QR de los logs y conserva el volumen `/app/data` en cada redeploy.
8. Cuando el flujo de pago esté probado, habilita
   `ALLOW_LIVE_ORDER_CREATION=true` de forma explícita.

La URL pública del webhook de Venium será:

```text
https://TU_DOMINIO_NORTHFLANK/webhooks/venium
```

El contenedor incluye `HEALTHCHECK`, escucha en `0.0.0.0` y usa
`node dist/src/server.js` como comando de producción.