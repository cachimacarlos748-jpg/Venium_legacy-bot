import { useState, useEffect } from "react";
import { Save, RefreshCw, Wifi, AlertTriangle, Check, Server, Wallet, Package, Loader2, FileImage } from "lucide-react";
import { getVeniumConfig, setVeniumConfig, Venium, syncVeniumCatalog } from "@/lib/veniumClient";
import { getUploadsProxyConfig, setUploadsProxyConfig } from "@/lib/receiptUploadClient";
import { Button } from "@/components/ui/button";

export default function VeniumTab() {
  const [proxyUrl, setProxyUrl] = useState("");
  const [authKey, setAuthKey] = useState("legacy_venium_2025");
  const [markup, setMarkup] = useState(5);
  const [veniumRate, setVeniumRate] = useState("");
  const [rateSpread, setRateSpread] = useState(2);
  const [autoRate, setAutoRate] = useState(null);
  const [saved, setSaved] = useState(false);
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [productCount, setProductCount] = useState(null);
  const [paraleloHint, setParaleloHint] = useState(null);

  // Proxy de comprobantes (worker independiente)
  const [uploadsUrl, setUploadsUrl] = useState("");
  const [uploadsKey, setUploadsKey] = useState("legacy_uploads_2025");
  const [uploadsSaved, setUploadsSaved] = useState(false);

  useEffect(() => {
    getVeniumConfig().then((cfg) => {
      setProxyUrl(cfg.proxy_url || "");
      setAuthKey(cfg.auth_key || "legacy_venium_2025");
      setMarkup(cfg.markup ?? 5);
      setVeniumRate(cfg.venium_rate ? String(cfg.venium_rate) : "");
      setRateSpread(cfg.rate_spread ?? 2);
    });
    getUploadsProxyConfig().then((cfg) => {
      setUploadsUrl(cfg.proxy_url || "");
      setUploadsKey(cfg.auth_key || "legacy_uploads_2025");
    });
    import("@/lib/tasaClient").then(({ getVesRate, getTasa }) => {
      getVesRate().then((r) => setParaleloHint(r || null)).catch(() => {});
      getTasa().then((r) => setAutoRate(r || null)).catch(() => {});
    });
  }, []);

  const saveUploads = async () => {
    await setUploadsProxyConfig({ proxy_url: uploadsUrl, auth_key: uploadsKey });
    setUploadsSaved(true);
    setTimeout(() => setUploadsSaved(false), 2200);
  };

  const save = async () => {
    await setVeniumConfig({
      proxy_url: proxyUrl,
      auth_key: authKey,
      markup: Number(markup) || 5,
      venium_rate: veniumRate ? Number(veniumRate) : 0,
      rate_spread: Number(rateSpread) || 0,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const checkBalance = async () => {
    setBalanceLoading(true);
    try {
      const bal = await Venium.getBalance();
      setBalance(bal);
    } catch (e) {
      setBalance({ error: e?.message || "No se pudo conectar" });
    }
    setBalanceLoading(false);
  };

  const syncCatalog = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncVeniumCatalog();
      setSyncResult(res);
      if (res?.ok) setProductCount(res.total);
    } catch (e) {
      setSyncResult({ ok: false, error: e?.message || "Error sincronizando" });
    }
    setSyncing(false);
  };

  const connected = !!proxyUrl;

  return (
    <div className="max-w-xl space-y-4">
      {/* Estado de conexión */}
      <div className={`rounded-2xl p-4 border flex items-start gap-3 ${connected ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
        {connected ? <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
        <div className="text-xs">
          <p className={`font-bold mb-0.5 ${connected ? "text-green-300" : "text-amber-300"}`}>
            {connected ? "Venium configurado" : "Venium sin configurar"}
          </p>
          <p className={connected ? "text-green-300/70" : "text-amber-300/70"}>
            {connected
              ? "El proxy inyecta tu API key automáticamente. Las recargas son automáticas."
              : "Despliega el Worker (ver archivo venium-proxy.worker.js) y pega la URL aquí."}
          </p>
        </div>
      </div>

      {/* Formulario */}
      <div className="bg-card border border-border/20 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-border/20">
          <Server className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Configuración Venium</h3>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Server className="w-3.5 h-3.5" /> URL del Proxy (Cloudflare Worker)
          </label>
          <input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="https://venium-proxy.xxx.workers.dev"
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
            Key de autorización del proxy
          </label>
          <input
            value={authKey}
            onChange={(e) => setAuthKey(e.target.value)}
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
            Margen de ganancia (%)
          </label>
          <input
            type="number"
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
            Spread sobre Binance P2P (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={rateSpread}
            onChange={(e) => setRateSpread(e.target.value)}
            placeholder="Ej: 2"
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            La tasa se calcula <span className="text-primary font-semibold">automática</span>: tasa USDT P2P de Binance Venezuela + este spread.
            Así coincide con lo que Venium te cobra al recargar la wallet, sin actualizar a mano.
            {autoRate ? <> Hoy: <span className="text-primary font-bold">{Number(autoRate).toFixed(2)} Bs/USD</span>.</> : null}
            {paraleloHint ? <> Paralelo: {Number(paraleloHint).toFixed(2)} Bs.</> : null}
          </p>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
            Tasa manual (override) — opcional
          </label>
          <input
            type="number"
            step="0.01"
            value={veniumRate}
            onChange={(e) => setVeniumRate(e.target.value)}
            placeholder="Vacío = automática"
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            Solo si quieres forzar una tasa fija. Déjalo vacío para usar la automática.
          </p>
        </div>

        <Button onClick={save} disabled={!proxyUrl}>
          <Save className="w-4 h-4 mr-2" />{saved ? "Guardado ✓" : "Guardar configuración"}
        </Button>
      </div>

      {/* Saldo y catálogo */}
      {connected && (
        <div className="bg-card border border-border/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-border/20">
            <Wallet className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Saldo y catálogo</h3>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={checkBalance} disabled={balanceLoading}>
              {balanceLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
              Consultar saldo
            </Button>
            <Button variant="outline" onClick={syncCatalog} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Package className="w-4 h-4 mr-2" />}
              Sincronizar catálogo
            </Button>
          </div>

          {balance && !balance.error && (
            <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-3 text-sm">
              <span className="text-muted-foreground">Saldo V-Coins: </span>
              <span className="text-green-400 font-bold">${Number(balance.balance || 0).toFixed(2)} {balance.currency || "USD"}</span>
            </div>
          )}
          {balance?.error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {balance.error}
            </div>
          )}

          {syncResult?.ok && (
            <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-300">
              Catálogo sincronizado: {syncResult.total} productos · {syncResult.created} nuevos · {syncResult.updated} actualizados
            </div>
          )}
          {syncResult && !syncResult.ok && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {syncResult.error}
            </div>
          )}
        </div>
      )}

      {/* Instrucciones de despliegue */}
      <div className="bg-muted/30 border border-border/20 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-foreground mb-2">Cómo desplegar el proxy de Venium</h3>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Cloudflare Dashboard → Workers & Pages → Create Worker</li>
          <li>Nombre: <code className="text-primary">venium-proxy</code> → Deploy</li>
          <li>Edit code → pega el contenido de <code className="text-primary">venium-proxy.worker.js</code></li>
          <li>Settings → Variables → Add <code className="text-primary">VENIUM_API_KEY</code> = tu key (marcar como Secret)</li>
          <li>Copia la URL del worker y pégala arriba</li>
        </ol>
      </div>

      {/* ===== Proxy de Comprobantes (worker independiente) ===== */}
      <div className={`rounded-2xl p-4 border flex items-start gap-3 ${uploadsUrl ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
        {uploadsUrl ? <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
        <div className="text-xs">
          <p className={`font-bold mb-0.5 ${uploadsUrl ? "text-green-300" : "text-amber-300"}`}>
            {uploadsUrl ? "Proxy de comprobantes configurado" : "Proxy de comprobantes sin configurar"}
          </p>
          <p className={uploadsUrl ? "text-green-300/70" : "text-amber-300/70"}>
            Worker independiente para guardar comprobantes de pago en catbox.moe (gratis, sin Telegram ni créditos).
          </p>
        </div>
      </div>

      <div className="bg-card border border-border/20 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-border/20">
          <FileImage className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Proxy de Comprobantes</h3>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Server className="w-3.5 h-3.5" /> URL del Proxy (Worker independiente)
          </label>
          <input
            value={uploadsUrl}
            onChange={(e) => setUploadsUrl(e.target.value)}
            placeholder="https://legacy-uploads.xxx.workers.dev"
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors font-mono"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
            Key de autorización del proxy
          </label>
          <input
            value={uploadsKey}
            onChange={(e) => setUploadsKey(e.target.value)}
            className="w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors font-mono"
          />
        </div>

        <Button onClick={saveUploads} disabled={!uploadsUrl}>
          <Save className="w-4 h-4 mr-2" />{uploadsSaved ? "Guardado ✓" : "Guardar configuración"}
        </Button>

        <div className="bg-muted/30 border border-border/20 rounded-xl p-4">
          <h4 className="text-xs font-bold text-foreground mb-2">Cómo desplegar el proxy de comprobantes</h4>
          <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Cloudflare Dashboard → Workers & Pages → Create Worker</li>
            <li>Nombre: <code className="text-primary">legacy-uploads</code> → Deploy</li>
            <li>Edit code → pega el contenido de <code className="text-primary">uploads-proxy.worker.js</code></li>
            <li>No necesita variables ni secrets → Deploy</li>
            <li>Copia la URL del worker y pégala arriba</li>
          </ol>
        </div>
      </div>
    </div>
  );
}