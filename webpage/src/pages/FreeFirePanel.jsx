import { useState, useEffect, useCallback } from "react";
import { Activity, Zap, Clock, Server, RotateCw, Cpu } from "lucide-react";
import { NexusBot, hasConfig } from "@/lib/nexusBotClient";
import RecargarTab from "@/components/freefire/RecargarTab";
import HistorialTab from "@/components/freefire/HistorialTab";
import ConfigBotTab from "@/components/freefire/ConfigBotTab";
import BotStatusCard from "@/components/freefire/BotStatusCard";

const BOT_INFO = { ip: "151.245.32.185:8080", model: "Sistema de Recargas" };

export default function FreeFirePanel({ embedded = false, onOnlineChange }) {
  const [tab, setTab] = useState("estado");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connErr, setConnErr] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setConnErr("");
    try {
      const s = await NexusBot.getStatus();
      setStatus(s);
      const ok = s?.status === "healthy" || s?.status === "degraded" || s?.productos || s?.server;
      if (onOnlineChange) onOnlineChange(!!ok);
    } catch (e) {
      setStatus(null);
      setConnErr(e.message || "Sin conexión");
      if (onOnlineChange) onOnlineChange(false);
    } finally {
      setLoading(false);
    }
  }, [onOnlineChange]);

  useEffect(() => {
    if (hasConfig()) {
      refresh();
    } else if (onOnlineChange) {
      onOnlineChange(false);
    }
  }, [refresh]);

  // Reintento automático cada 25s
  useEffect(() => {
    if (!hasConfig()) return;
    const id = setInterval(refresh, 25000);
    return () => clearInterval(id);
  }, [refresh]);

  const tabs = [
    { id: "estado", label: "Estado", icon: Activity },
    { id: "recargar", label: "Recargar", icon: Zap },
    { id: "historial", label: "Historial", icon: Clock },
    { id: "config", label: "Config", icon: Server },
  ];

  const online = !!(status && (status.status === "healthy" || status.status === "degraded" || status.productos || status.server));
  const degraded = status?.status === "degraded";
  const saldo = status?.saldo_num ?? status?.saldo;

  const statusBadge = (
    <span className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border ${online ? (degraded ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : "bg-green-500/10 text-green-400 border-green-500/30") : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
      <span className={`w-2 h-2 rounded-full ${online ? (degraded ? "bg-yellow-400" : "bg-green-400") : "bg-red-400"} ${online && !degraded ? "animate-pulse" : ""}`} />
      {loading ? "Verificando..." : online ? (degraded ? "EN COLA" : "OPERATIVO") : "SIN CONEXIÓN"}
    </span>
  );

  const refreshBtn = (
    <button onClick={refresh} disabled={loading} className="w-9 h-9 rounded-xl border border-border/30 flex items-center justify-center hover:bg-muted/50 transition-colors disabled:opacity-50">
      <RotateCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
    </button>
  );

  const subTabs = (
    <div className="flex gap-1 border-b border-border/20 overflow-x-auto scrollbar-hide">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <t.icon className="w-4 h-4" /> {t.label}
        </button>
      ))}
    </div>
  );

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${online ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground"}`}>
          <Cpu className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-base font-black text-foreground flex items-center gap-2">
            {BOT_INFO.model}
            <span className="text-[10px] font-semibold text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">v2.7</span>
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {status?.server || BOT_INFO.model}{saldo != null ? ` · saldo $${saldo}` : ` · ${BOT_INFO.ip}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {statusBadge}
        {refreshBtn}
      </div>
    </div>
  );

  const content = (
    <div className="pt-5">
      {tab === "estado" && <BotStatusCard status={status} connErr={connErr} loading={loading} onRefresh={refresh} />}
      {tab === "recargar" && <RecargarTab status={status} connErr={connErr} onRefresh={refresh} />}
      {tab === "historial" && <HistorialTab />}
      {tab === "config" && <ConfigBotTab />}
    </div>
  );

  if (embedded) {
    return (
      <div className="bg-card border border-border/20 rounded-2xl shadow-lg p-5">
        {header}
        <div className="mt-4">{subTabs}</div>
        {content}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="bg-card border border-border/20 rounded-2xl shadow-lg p-5">
        {header}
        <div className="mt-5">{subTabs}</div>
        {content}
      </div>
    </div>
  );
}