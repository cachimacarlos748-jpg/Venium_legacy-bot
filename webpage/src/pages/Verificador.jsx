import { useState } from "react";
import { BdvVerifier, getBdvConfig, setBdvConfig } from "@/lib/bdvClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Verificador publico de pago movil: consulta BDVenlínea en vivo a traves del
// bot y confirma si una referencia con su monto aparece como CREDITO.
// La verificacion tarda ~40-70 s (el bot entra al banco, navega y sale).

const LIMPIAR_REF = (v) => v.replace(/\D/g, "").slice(0, 20);
const LIMPIAR_MONTO = (v) => v.replace(/[^0-9.,]/g, "").replace(",", ".").slice(0, 12);

export default function Verificador() {
	const [reference, setReference] = useState("");
	const [amount, setAmount] = useState("");
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState(null);
	const [error, setError] = useState("");
	const [showConfig, setShowConfig] = useState(false);

	const cfg = getBdvConfig();

	const verificar = async (e) => {
		e.preventDefault();
		setError("");
		setResult(null);
		if (!reference || !amount) {
			setError("Completa la referencia y el monto.");
			return;
		}
		setLoading(true);
		try {
			const data = await BdvVerifier.verify({ amount: LIMPIAR_MONTO(amount), reference: LIMPIAR_REF(reference) });
			setResult(data);
		} catch (err) {
			setError(err?.message || "Error al verificar.");
		} finally {
			setLoading(false);
		}
	};

	const guardarConfig = (bot, key) => {
		setBdvConfig(bot, key);
		setShowConfig(false);
	};

	return (
		<div className="mx-auto w-full max-w-lg px-4 py-10">
			<div className="mb-8 text-center">
				<h1 className="text-3xl font-extrabold tracking-tight">Verificador de Pago Móvil</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					Confirma en vivo contra BDVenlínea si tu pago llegó. Tarda 40–70 segundos.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Datos del pago</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={verificar} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="reference">Referencia</Label>
							<Input
								id="reference"
								inputMode="numeric"
								placeholder="Ej: 910795687"
								value={reference}
								onChange={(e) => setReference(LIMPIAR_REF(e.target.value))}
								disabled={loading}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="amount">Monto (Bs)</Label>
							<Input
								id="amount"
								inputMode="decimal"
								placeholder="Ej: 1.00"
								value={amount}
								onChange={(e) => setAmount(LIMPIAR_MONTO(e.target.value))}
								disabled={loading}
							/>
						</div>
						<Button type="submit" className="w-full" disabled={loading}>
							{loading ? (
								<>
									<span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
									Verificando en el banco… (40–70 s)
								</>
							) : (
								"Verificar pago"
							)}
						</Button>
					</form>

					{error && (
						<div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
							{error}
						</div>
					)}

					{result && (
						<div className="mt-4 space-y-3">
							{result.verified ? (
								<div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
									<p className="text-lg font-bold text-emerald-600">✅ Pago confirmado</p>
									<p className="mt-1 text-sm text-muted-foreground">
										{result.isNew
											? "Tu pago es nuevo y quedó registrado."
											: "Este pago ya había sido verificado antes."}
									</p>
								</div>
							) : (
								<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
									<p className="text-lg font-bold text-amber-600">⏳ Pago no encontrado aún</p>
									<p className="mt-1 text-sm text-muted-foreground">
										{result.status === "duplicate"
											? "Esta referencia ya fue usada en otro pedido."
											: "El banco aún no lo muestra. Si acabas de pagar, espera 2–5 minutos y reintenta."}
									</p>
								</div>
							)}
							{result.raw && (
								<dl className="rounded-lg border p-3 text-sm">
									{result.raw.reference && (
										<div className="flex justify-between py-0.5">
											<dt className="text-muted-foreground">Referencia</dt>
											<dd className="font-mono">{result.raw.reference}</dd>
										</div>
									)}
									{result.raw.amount != null && (
										<div className="flex justify-between py-0.5">
											<dt className="text-muted-foreground">Monto</dt>
											<dd>{result.raw.amount} Bs</dd>
										</div>
									)}
									{result.raw.date && (
										<div className="flex justify-between py-0.5">
											<dt className="text-muted-foreground">Fecha</dt>
											<dd>{result.raw.date}</dd>
										</div>
									)}
									{result.raw.description && (
										<div className="flex justify-between py-0.5">
											<dt className="text-muted-foreground">Descripción</dt>
											<dd className="text-right">{result.raw.description}</dd>
										</div>
									)}
								</dl>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			<button
				type="button"
				onClick={() => setShowConfig((v) => !v)}
				className="mt-6 text-xs text-muted-foreground underline hover:text-foreground"
			>
				Configuración del verificador
			</button>
			{showConfig && (
				<ConfigForm initial={cfg} onSave={guardarConfig} />
			)}
		</div>
	);
}

function ConfigForm({ initial, onSave }) {
	const [bot, setBot] = useState(initial.botBase);
	const [key, setKey] = useState(initial.apiKey);
	return (
		<Card className="mt-3">
			<CardContent className="space-y-3 pt-4">
				<div className="space-y-1">
					<Label htmlFor="cfg-bot">URL del bot</Label>
					<Input id="cfg-bot" value={bot} onChange={(e) => setBot(e.target.value)} placeholder="https://tu-bot.onrender.com" />
				</div>
				<div className="space-y-1">
					<Label htmlFor="cfg-key">Clave del verificador</Label>
					<Input id="cfg-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BDV_VERIFY_KEY" />
				</div>
				<Button size="sm" onClick={() => onSave(bot, key)}>Guardar</Button>
			</CardContent>
		</Card>
	);
}
