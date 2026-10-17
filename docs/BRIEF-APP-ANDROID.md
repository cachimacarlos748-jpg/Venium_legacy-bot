# BRIEF — Envoltorio Android de Vex Store para Google Play

Documento de especificación. Quien reciba este brief construye **un envoltorio
Android** alrededor de una web que **ya existe y que no le pertenece**. Todo lo
de abajo está verificado contra el código y contra la web en vivo; no es una
escriba de intenciones.

---

## 1. Objetivo

Generar un **Android App Bundle (AAB)** publicable en Google Play que muestre
la tienda existente `https://vexstorevzla.com` a pantalla completa, con la
experiencia de una app nativa.

Tecnología elegida: **Trusted Web Activity (TWA)** empaquetada con
**Bubblewrap CLI** (GoogleChromeLabs/bubblewrap). No Capacitor, no WebView
propia: la web ya es una PWA instalable y una TWA la reutiliza sin duplicar
nada.

---

## 2. FUENTE DE VERDAD — qué NO se toca bajo ninguna circunstancia

La web vive en su propio repositorio y la mantiene otra persona. Esta IA
**no tiene permiso para modificarla**.

Prohibido:
- Clonar, editar o "arreglar" el código de la web (`webpage/…`).
- Cambiar colores, tipografía, componentes, rutas, textos o el flujo de compra.
- Añadir funciones nuevas "por si acaso" (carrito, login propio, notificaciones,
  geolocalización, permisos de cámara/micrófono/ubicación/ contactos).
- Cambiar la arquitectura (framework, router, backend, base de datos).
- Reescribir el `manifest.json`, el `sw.js` o cualquier archivo servido por
  `https://vexstorevzla.com`.
- Generar contenido de política de privacidad, texto legal o imágenes de marca.

Si para lograr algo hace falta cambiar la web → **PARAR y reportar**, con el
porqué y la propuesta. No parchear desde el lado de la app.

Todo lo demás (colores, textos, catálogo, precios, logos) se lee del sitio en
producción, no se redefine aquí.

---

## 3. Datos exactos de la web (verificados en vivo y en el repositorio)

| Dato | Valor exacto |
|---|---|
| URL de la app | `https://vexstorevzla.com` (HTTPS, certificado válido, responde 200) |
| Nombre de la app | `Vex Store` (del `manifest.json`) |
| Nombre corto | `Vex Store` |
| `start_url` / `scope` | `/` |
| `display` | `standalone` |
| `orientation` | `portrait` |
| `background_color` | `#0d0a14` (casi negro) |
| `theme_color` | `#7c3aed` (violeta de marca) |
| Fondo real de la app | `#0d0a14` |
| Acento de marca | `#7c3aed` (violeta); verde = éxito; ámbar = dinero; rojo = error |
| Tipografía | `Outfit` (cargada desde Google Fonts) |
| Iconos actuales | Solo SVG: `/icon.svg` y `/icon-maskable.svg`. **No existe ningún PNG** |
| Service worker | `https://vexstorevzla.com/sw.js`, registrado, con auto-actualización cada 60 s |
| Viewport | `viewport-fit=cover` |

### Rutas que existen (router real de la web)

```
/                      Home
/Games                 Juegos móviles
/GiftCards             Gift cards
/Servicios             Servicios
/comprar/:slug         Ficha de compra de un producto
/pagar/:slug           Pantalla de datos de pago
/completar-pago/:orderId  Reporte de pago
/creadores             Programa de creadores
/canjear               Canjear código
/mis-pedidos           Historial de pedidos
/Login  /Register  /forgot-password  /reset-password
/perfil                (requiere sesión)
/admin  /freefire  /documentacion   (solo administrador, protegidas)
```

Cualquier URL desconocida cae en un 404 propio de la web. No hace falta que la
app conozca estas rutas: la navegación vive dentro del sitio.

### Comportamientos del sitio relevantes para el envoltorio

- **Barra inferior de navegación NO existe.** En móvil la navegación es un
  drawer lateral desde la cabecera. No "arreglar" esto desde la app.
- **Los controles de flecha del carrusel y de las filas deslizables solo
  aparecen con hover** (`Home.jsx` líneas 184, 191, 301, 320, 450, 469, 506,
  525). En táctil no se ven; los carruseles se mueven arrastrando. Es así a
  propósito.
- **Los insets de sistema** (`env(safe-area-inset-*)`) solo están aplicados en
  la barra fija de compra (`Comprar.jsx`). El resto depende del sistema.
- **Hay un botón "Instalar app"** que **se oculta solo** cuando la web corre en
  modo standalone (`InstallAppButton.jsx`). No tocar.
- **El logotipo viene de un CDN externo** (`media.base44.com`). Si falla, la web
  funciona sin logo. No sustituirlo ni cachearlo dentro del APK.

---

## 4. Requisitos del envoltorio Android (lo que SÍ hay que construir)

- `applicationId`: **`com.vexstorevzla.app`** (única decisión nueva de este
  brief; si el dueño pide otro, reemplazar en todo el proyecto de forma
  consistente).
- Versión: `versionCode 1`, `versionName "1.0"`.
- **`targetSdk` 36 o superior** (obligatorio para envíos desde el 31-ago-2026).
  `minSdk` 24.
- Salida: **AAB** firmado (Play no acepta APK nuevos) + APK de prueba para
  instalación local.
- Paleta de marca para la pantalla de lanzamiento: fondo `#0d0a14`, acento
  `#7c3aed`.
- La TWA debe abrir `https://vexstorevzla.com` a pantalla completa.
- El **botón Atrás** debe navegar hacia atrás dentro del sitio (historial), y
  solo cerrar la app en la página de inicio.
- **Edge-to-edge**: con `targetSdk 36` Android obliga a dibujar bajo la barra de
  estado. Cualquier ajuste de insets debe resolverse **en el lado Android**
  (o desde el envoltorio), nunca editando la web.
- No se solicita ningún permiso. Si algo propuesto pide `INTERNET` no pasa nada
  (es implícita), pero **no pedir cámara, micrófono, ubicación, contactos,
  almacenamiento ni notificaciones push**.
- No incluir SDK de terceros (analytics, publicidad, crash reporters) sin
  autorización expresa.

### Requisitos de Play que la cuenta del dueño cumple por su lado

- Cuenta de desarrollador (25 USD, una vez).
- Play App Signing obligatorio para apps nuevas.
- Si la cuenta es **personal**: prueba cerrada con **12 testers durante 14
  días** antes de pasar a producción.
- El envío necesita además: **feature graphic 1024×500**, icono **PNG 512×512**
  y **capturas de pantalla**. Ver sección 6.

---

## 5. Digital Asset Links (para que la TWA se vea a pantalla completa)

Sin esto, Chrome muestra el sitio como Custom Tab con barra de navegador
encima. Se resuelve en dos pasos y **el segundo lo hace el dueño del sitio**.

1. La IA genera el proyecto y produce la **huella SHA-256 del certificado de
   carga**.
2. El dueño publica en su servidor, en la ruta exacta
   `https://vexstorevzla.com/.well-known/assetlinks.json`, un JSON con:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package": "com.vexstorevzla.app",
    "sha256_cert_fingerprints": ["<HUELLA_SHA256_DEL_CERTIFICADO_DE_APP_DE_PLAY>"]
  }
}]
```

**Advertencia obligatoria:** el archivo debe servirse con
`Content-Type: application/json`, sin redirecciones. Hoy esa URL **no existe**
y el servidor devuelve el `index.html` de la SPA con `Content-Type: text/html`,
así que la verificación fallaría.

**Advertencia 2:** Play re-firma la app distribuida, así que la huella que va en
`assetlinks.json` es la del **certificado de la app en Play Console**, no la del
keystore local. Pedir esa huella al dueño antes de verificar. La IA genera el
archivo y deja la huella marcada como `<PENDIENTE>`; no inventa huellas.

---

## 6. Recursos gráficos — qué falta y qué NO se inventa

- **No existe ningún PNG en el proyecto.** Solo `webpage/public/icon.svg` y
  `webpage/public/icon-maskable.svg` (ambos `image/svg+xml`).
- Play y Bubblewrap exigen **PNG 512×512**. Derivarlo del SVG es aceptable;
  **diseñar un logo nuevo no lo es**.
- Feature graphic 1024×500 y capturas: pedirlos al dueño. No generar marketing
  ni textos de la ficha de Play (política de Google sobre texto y metadatos de
  la ficha: son responsabilidad del desarrollador).
- La web tiene `og:image` apuntando a un SVG; eso no afecta a la app, ignorarlo.

---

## 7. Política de privacidad — pendiente del DUEÑO, no de la IA

Google exige una URL de política de privacidad publicada para enviar la app.
En la web actual los enlaces de "Política de privacidad" y "Términos" del
footer son **enlaces vacíos (`href="#"`)**.

- La IA **no redacta** ese documento ni lo aloja.
- La IA solo deja el campo de la URL preparado en la ficha de Play.
- El dueño crea la página y da la URL cuando la tenga.

---

## 8. Datos que la IA NO tiene y debe pedir, nunca asumir

| Dato | Por qué |
|---|---|
| Huella SHA-256 del certificado de la app en Play | Digital Asset Links |
| Keystore de carga / acceso a Play App Signing | Firma del AAB |
| URL de la política de privacidad | Requisito de ficha |
| Icono PNG 512 y feature graphic (si el dueño quiere versiones propias) | Ficha de Play |
| Cualquier clave, token, URL interna o credencial | **No hace falta ninguna**: la app solo carga el sitio público |

Ningún secreto entra en el APK. Si algo le pide credenciales, está mal planteado.

---

## 9. Definición de terminado (checklist verificable)

- [ ] `bubblewrap doctor` sin errores.
- [ ] AAB generado y firmado; APK de prueba instalable.
- [ ] `targetSdk >= 36` comprobado en el `build.gradle` generado.
- [ ] Al abrir la app: sitio a pantalla completa, sin barra de navegador, logo
      visible, catálogo navegable con el dedo.
- [ ] Botón Atrás navega dentro del sitio y solo cierra en `/`.
- [ ] No se pidió ningún permiso nuevo al usuario.
- [ ] Ningún archivo de la web modificado (`git status` limpio en el repo de la
      web).
- [ ] `assetlinks.json` generado con la huella marcada como `<PENDIENTE>`.
- [ ] Reporte final listando lo que falta del lado del dueño (huella, PNG,
      privacidad, capturas, testers).

---

## 10. Fuente de referencia oficial

- Guía TWA: https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- Bubblewrap CLI: https://github.com/GoogleChromeLabs/bubblewrap
- Digital Asset Links: https://developer.android.com/training/app-links/configure-assetlinks
- Requisito de API objetivo: https://support.google.com/googleplay/android-developer/answer/11926878
- Android App Bundle: https://developer.android.com/guide/app-bundle
