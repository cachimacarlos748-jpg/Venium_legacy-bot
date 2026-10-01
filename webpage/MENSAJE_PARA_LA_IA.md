# Códigos de descuento solo para clientes nuevos

Este archivo es el mensaje para la otra IA (la que tiene acceso directo a la base
de datos de Base44). Copiar todo lo de abajo y enviárselo.

---

## Contexto

La página de la tienda ya no está alojada en Base44: ahora se sirve desde
Cloudflare Pages en `https://vexstorevzla.com`. El frontend es el mismo código,
pero el build vive en el repositorio `Venium_legacy-bot`, carpeta `webpage/`.

**Lo que NO cambió:** la base de datos. Todos los datos siguen en Base44
(app id `6a5b9606e1931edeb474236e`) y las consultas del frontend siguen siendo
llamadas REST a `https://base44.app/api/apps/<APP_ID>/entities/<Entity>`.

## Qué se implementó en el frontend

Se añadió a los códigos de descuento un campo nuevo dentro del JSON que se
guarda en el Setting `discount_<CODIGO>`:

```json
{
  "kind": "percent",
  "value": 10,
  "label": "10% de descuento",
  "new_customer_only": true,
  "not_new_message": "Este código es solo para tu primera compra. Como ya tienes pedidos con nosotros, no se puede aplicar."
}
```

- `new_customer_only: true` → el código solo sirve para quien nunca ha comprado.
- `not_new_message` (opcional) → mensaje que ve el cliente si ya tiene pedidos.

### Cómo decide el frontend si la persona ya compró

En `src/lib/discountClient.js`, función `isNewCustomer()`:

1. Consulta la entidad **Order** filtrando por `player_id` (el ID del jugador).
2. Si el producto no pide Player ID, consulta por `customer_email`.
3. Cuenta como "compra previa" cualquier pedido cuyo `status` **no** sea uno de:
   `cancelled`, `canceled`, `failed`, `expired`, `rejected`, `partial_payment`.

El resultado es una función `validateDiscountCode(code, { playerId, email })`
que devuelve `{ error, reason: "not_new" }` cuando la persona ya compró, y el
checkout le muestra una ventana con ese mensaje.

### Dónde seucibe el efecto

- `src/components/purchase/DiscountCode.jsx` → muestra el diálogo.
- `src/components/purchase/SummaryCard.jsx` y `src/pages/Comprar.jsx` → pasan
  `playerId` y `email` al validador.
- `src/components/home/CouponsSection.jsx` → **filtra** y ya no muestra en la
  portada los códigos con `new_customer_only: true`.
- `src/components/admin/DiscountCodesTab.jsx` → casillas para activar y editar
  el campo desde el panel de admin.

## Lo que hay que hacer del lado de Base44

Nada obligatorio: el frontend ya funciona con los registros tal como están.

Pero **para que el código exista**, hay que crearlo. Dos opciones:

### Opción A — desde el admin de la web (lo más simple)

Una vez desplegado el cambio, entrar a la tienda → Admin → Códigos de descuento →
marcar **"Solo para clientes nuevos"** → crear el código `HOKAGE5`.

### Opción B — creando el registro directamente

Si prefieres crearlo por base de datos, es un `Setting` con esta forma:

- `key`: `discount_HOKAGE5`
- `value`: el JSON de arriba en texto plano, con `new_customer_only: true`

## Verificación sugerida

1. Crear el código `HOKAGE5` con `new_customer_only: true`.
2. Abrir la portada: el código **no debe aparecer** en "Cupones Activos".
3. Entrar a la compra de un juego, escribir un Player ID **nuevo**, aplicar
   `HOKAGE5` → debe aplicar el descuento y mostrar "Bienvenida: primera compra".
4. Repetir con un Player ID que ya tenga pedidos → debe salir la ventana
   "Ya eres cliente".

## Aviso importante

El frontend y el backend están desincronizados a propósito: el código nuevo de
la web vive en GitHub y lo despliega Cloudflare. Cualquier cambio que se haga
directamente en Base44 sobre los archivos de la app (no sobre los datos) se
perderá la próxima vez que se redeploye.