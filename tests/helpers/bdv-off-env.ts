// Verificador de BDVenlínea APAGADO (su estado real en la tienda) + Pabilo como
// proveedor. Debe importarse antes que cualquier modulo de la app: en ESM los
// imports se evaluan antes que el cuerpo del archivo.
process.env.BDV_ENABLED = "false";
process.env.BDV_MODE = "live";
process.env.PAYMENT_PROVIDER = "pabilo";
