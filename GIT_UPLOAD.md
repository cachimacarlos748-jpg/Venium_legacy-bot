# Subir este proyecto a Git

Este paquete contiene el bot de ventas en Node.js + TypeScript. No incluye
`node_modules`, `dist`, la base SQLite local ni secretos.

```bash
tar -xzf venium-whatsapp-bot-git.tar.gz
cd venium-whatsapp-bot
cp .env.example .env
npm install
npm run check
npm test
git init
git add .
git commit -m "Initial Venium WhatsApp bot"
git branch -M main
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

Antes de subirlo, revisa `.env` y confirma que no exista ningún secreto real.
El proyecto arranca con Venium, Pabilo, Gemini y WhatsApp en modo seguro o
deshabilitado.

## Desplegar en Northflank

1. Crea un servicio desde el repositorio de GitHub y selecciona el
   `Dockerfile` de la raíz.
2. Expón el puerto `3000` y configura un volumen persistente en `/app/data`.
   Ese volumen conserva SQLite y la sesión de WhatsApp.
3. Añade como variables o secrets los valores de `.env.example`. En
   producción, las credenciales que faltan para activar los proveedores son:
   `VENIUM_API_KEY`, `PABILO_API_KEY`, `PABILO_USER_BANK_ID`,
   `GEMINI_API_KEY`, `VENIUM_WEBHOOK_SECRET` y `ADMIN_PASSWORD`.
4. Empieza con `VENIUM_MODE=mock`, `PABILO_MODE=mock`,
   `GEMINI_MODE=disabled`, `WHATSAPP_MODE=disabled` y
   `ALLOW_LIVE_ORDER_CREATION=false`.
5. Verifica `https://TU_DOMINIO/health`. Después configura el destino de pago
   esperado desde el panel administrativo.
6. Para activar WhatsApp, cambia `WHATSAPP_MODE=live`, conserva el volumen,
   revisa los logs del despliegue y escanea el QR con WhatsApp → Dispositivos
   vinculados.
7. Para activar APIs reales usa `VENIUM_MODE=live`, `PABILO_MODE=live` y
   `GEMINI_MODE=live` junto con sus secrets. Habilita
   `ALLOW_LIVE_ORDER_CREATION=true` solo después de una prueba controlada.
8. Configura en Venium el webhook:
   `https://TU_DOMINIO/webhooks/venium`.