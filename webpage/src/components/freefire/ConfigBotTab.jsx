import { useState } from "react";
import { Save, RotateCcw, Wifi, AlertTriangle, Check, Server, Key, Link2 } from "lucide-react";
import { getConfig, setConfig, hasConfig, proxyBase, realHost, DEFAULT_PROXY, DEFAULT_REAL, DEFAULT_KEY } from "@/lib/nexusBotClient";
import { Button } from "@/components/ui/button";

export default function ConfigBotTab() {
  const init = getConfig();
  const [proxy, setProxy] = useState(init.proxyBase || DEFAULT_PROXY);
  const [host, setHost] = useState(init.realHost || DEFAULT_REAL);
  const [key, setKey] = useState(init.apiKey || DEFAULT_KEY);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setConfig(proxy, host, key);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };
  const reset = () => {
    setProxy(DEFAULT_PROXY); setHost(DEFAULT_REAL); setKey(DEFAULT_KEY);
    setConfig(DEFAULT_PROXY, DEFAULT_REAL, DEFAULT_KEY);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const connected = hasConfig();

  const Field = ({ icon: Icon, label, value, onChange, placeholder, mono }) => (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-muted border border-border/30 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors ${mono ? "font-mono" : ""}`}
      />
    </div>
  );

  return (
    <div className="max-w-xl space-y-4">
      {/* Estado de conexión */}
      <div className={`rounded-2xl p-4 border flex items-start gap-3 ${connected ? "bg-green-500/10 border-green-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
        {connected ? <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
        <div className="text-xs">
          <p className={`font-bold mb-0.5 ${connected ? "text-green-300" : "text-amber-300"}`}>
            {connected ? "Configuración activa" : "Sistema sin configurar"}
          </p>
          <p className={connected ? "text-green-300/70" : "text-amber-300/70"}>
            {connected
              ? "El proxy HTTPS resuelve CORS y mixed-content automáticamente."
              : "Configura el proxy y la API key para conectar el panel."}
          </p>
        </div>
      </div>

      {/* Formulario */}
      <div className="bg-card border border-border/20 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-border/20">
          <Server className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Configuración del sistema</h3>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          El sistema se invoca a través de un <strong className="text-foreground">proxy HTTPS con CORS abierto</strong>:
          el navegador lo llama directamente con <code className="text-primary bg-muted/50 px-1.5 py-0.5 rounded">fetch()</code>.
          La API key va como query param <code className="text-primary bg-muted/50 px-1.5 py-0.5 rounded">?key=</code>.
        </p>

        <Field icon={Link2} label="Proxy HTTPS" value={proxy} onChange={setProxy} placeholder={DEFAULT_PROXY} mono />
        <Field icon={Server} label="Servidor Real (IP:Puerto)" value={host} onChange={setHost} placeholder={DEFAULT_REAL} mono />
        <Field icon={Key} label="API Key" value={key} onChange={setKey} mono />

        <div className="flex gap-2 flex-wrap pt-1">
          <Button onClick={save}>
            <Save className="w-4 h-4 mr-2" />{saved ? "Guardado ✓" : "Guardar configuración"}
          </Button>
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="w-4 h-4 mr-2" />Valores por defecto
          </Button>
        </div>
      </div>

      {/* Estado actual */}
      <div className="bg-card border border-border/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wifi className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Estado actual</h3>
        </div>
        <div className="space-y-2 text-xs bg-muted/40 rounded-xl p-4 font-mono">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Proxy:</span>
            <span className="text-foreground break-all text-right">{proxyBase() || "—"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Servidor real:</span>
            <span className="text-foreground break-all text-right">{realHost() || "—"}</span>
          </div>
          <div className="flex justify-between gap-2 pt-2 border-t border-border/10">
            <span className="text-muted-foreground">Resumen:</span>
            {connected
              ? <span className="text-green-400 font-bold">CONFIGURADO</span>
              : <span className="text-red-400 font-bold">NO CONFIGURADO</span>}
          </div>
        </div>
      </div>
    </div>
  );
}