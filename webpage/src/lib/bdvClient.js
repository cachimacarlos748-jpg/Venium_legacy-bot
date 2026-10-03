// Cliente del verificador de pagos BDV (Vex Store).
//
// La web (estática en vexstorevzla.com) llama al bot (Fastify + Puppeteer en
// Northflank), que es quien entra a BDVenlínea y lee los movimientos.
//
//   POST {bot}/api/bdv/verify   body: { amount, reference, key }
//     → { verified, isNew, status, raw: { reference, amount, date, description } }
//
// La clave (BDV_VERIFY_KEY) se guarda en localStorage; el admin la configura
// una vez en el panel. El verificación tarda ~40-70 s (login + navegación en
// el banco), por eso el timeout del fetch es de 120 s.

const LS_BOT = "bdv_verify_bot_host";
const LS_KEY = "bdv_verify_key";

// URL del bot en produccion (Northflank). Se puede sobreescribir desde
// localStorage para pruebas.
const DEFAULT_BOT = "https://venium-bot.cachimacarlos748-jpg.workers.dev";

export function getBdvConfig() {
	if (typeof window === "undefined") return { botBase: DEFAULT_BOT, apiKey: "" };
	return {
		botBase: (localStorage.getItem(LS_BOT) || "").trim() || DEFAULT_BOT,
		apiKey: (localStorage.getItem(LS_KEY) || "").trim(),
	};
}

export function setBdvConfig(botBase, apiKey) {
	localStorage.setItem(LS_BOT, botBase || "");
	localStorage.setItem(LS_KEY, apiKey || "");
}

export const BdvVerifier = {
	// Verifica un pago movil. Devuelve el JSON crudo del bot; lanza Error con
	// mensaje legible si el bot no responde o la clave es invalida.
	async verify({ amount, reference }) {
		const { botBase, apiKey } = getBdvConfig();
		if (!botBase) throw new Error("Falta la URL del bot (Config BDV).");
		if (!apiKey) throw new Error("Falta la clave del verificador (Config BDV).");
		const url = `${botBase.replace(/\/+$/, "")}/api/bdv/verify`;
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), 120000);
		try {
			const r = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amount, reference, key: apiKey }),
				signal: ctrl.signal,
			});
			clearTimeout(t);
			const text = await r.text();
			let data;
			try { data = JSON.parse(text); }
			catch { throw new Error("Respuesta no parseable del bot"); }
			if (r.status === 401) throw new Error("Clave invalida. Revisa la configuracion del verificador.");
			if (r.status === 429) throw new Error("El banco esta ocupado (sesion activa). Espera ~3 minutos y reintenta.");
			if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
			return data;
		} catch (e) {
			clearTimeout(t);
			if (e.name === "AbortError") throw new Error("El banco tardo demasiado (timeout 120 s). Reintenta.");
			throw e;
		}
	},
};
