// Debe importarse ANTES que cualquier modulo de la app: en ESM los imports se
// evaluan antes que el cuerpo del archivo, asi que poner esto dentro del test
// llega tarde (config/env.ts ya leyo la clave real del .env.local). Los valores
// son de mentira: el fetch se sustituye en cada test.
process.env.PABILO_MODE = "live";
process.env.PABILO_API_KEY = "clave-de-prueba";
process.env.PABILO_BASE_URL = "https://pabilo.test";
process.env.PABILO_USER_BANK_ID = "banco-del-entorno";
process.env.PABILO_MOVEMENT_TYPE = "GENERIC";
process.env.PABILO_ENABLED = "";
