import {
  Wifi, WifiOff, DollarSign, Clock, CheckCircle2, XCircle,
  Layers, Cpu, Activity, Package, Zap, TrendingUp, RefreshCw,
} from "lucide-react";

const fmtPct = (ok, fail) => {
  const t = (ok || 0) + (fail || 0);
  if (!t) return null;
  return ((ok / t) * 100).toFixed(1);
};

export default function BotStatusCard({ status, connErr, loading, onRefresh }) {
  const online = status?.status === "healthy" && String(status?.browser || "").includes("conn");
  const recibiendo = online && !status?.recovering;
  const procesando = !!status?.processing;
  const saldo = status?.saldo_num ?? status?.saldo;
  const stats = status?.stats || {};
  const ultima = status?.ultimaCompra || {};
  const od = ultima?.orderDetails || {};
  const successRate = fmtPct(stats.ok, stats.fail);
  const porProducto = status?.comprasPorProducto || status?.por_producto || [];
  const mem = status?.memoria || status?.memory || {};
  const memPct = mem.rss_pct ?? mem.heap_pct;

  const dot = (on, label) => (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${on ? "bg-green-400" : "bg-red-400"}`} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );

  const StatCard = ({ icon: Icon, label, value, sub, color, children }) => (
    <div className="bg-card border border-border/20 rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color || "bg-foreground/5 text-foreground"}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      {value !== undefined && <p className="text-2xl font-black text-foreground leading-none">{value}</p>}
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header con estado principal */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${online ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
            {online ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              {loading ? "Verificando..." : online ? "Operativo" : "Inactivo"}
              {procesando && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                  <Activity className="w-3 h-3 animate-pulse" /> Procesando
                </span>
              )}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {online
                ? `Recibiendo pedidos ${recibiendo ? "correctamente" : "· en recuperación"}`
                : (connErr || "Sin respuesta del sistema")}
            </p>
          </div>
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-border/30 hover:bg-muted/50 disabled:opacity-50 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {/* Grid principal de métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Clock} label="Tiempo Activo" value={status?.uptime_formatted || "—"} color="bg-blue-500/15 text-blue-400" />
        <StatCard icon={TrendingUp} label="Compras Totales" value={stats.total ?? "—"} color="bg-primary/15 text-primary"
          sub={stats.total ? `${stats.ok || 0} ✓ · ${stats.fail || 0} ✗` : undefined}>
          {successRate && (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-green-400 rounded-full" style={{ width: `${successRate}%` }} />
              </div>
              <span className="text-[11px] font-bold text-green-400">{successRate}%</span>
            </div>
          )}
        </StatCard>
        <StatCard icon={DollarSign} label="Saldo" value={saldo !== undefined ? `$${saldo}` : "—"} color="bg-green-500/15 text-green-400"
          sub={status?.saldo_hace_min != null ? `hace ${status.saldo_hace_min} min` : undefined} />
        <StatCard icon={Layers} label="En Cola" value={status?.cola ?? 0} color="bg-amber-500/15 text-amber-400"
          sub={(status?.cola ?? 0) === 0 ? "Cola vacía" : undefined} />
      </div>

      {/* Estado del sistema + memoria */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estado del Sistema</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {dot(!!status?.browser, "Browser")}
            {dot(!!status?.page || online, "Página")}
            {dot(online, "Estable")}
            <span className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${procesando ? "bg-blue-400 animate-pulse" : "bg-muted-foreground/40"}`} />
              <span className="text-muted-foreground">Procesando</span>
            </span>
          </div>
        </div>

        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Memoria</span>
          </div>
          {mem.heap || mem.rss ? (
            <>
              <p className="text-sm font-bold text-foreground mb-2">
                {mem.heap ? `${mem.heap} MB heap` : ""}{mem.rss ? ` / ${mem.rss} MB RSS` : ""}
              </p>
              {memPct != null && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${Math.min(memPct, 100)}%` }} />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{memPct}%</span>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sin datos de memoria</p>
          )}
        </div>
      </div>

      {/* Compras por producto */}
      {porProducto.length > 0 && (
        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <Package className="w-3.5 h-3.5" /> Compras por Producto
          </h4>
          <div className="space-y-1.5">
            {porProducto.slice(0, 8).map((p, i) => {
              const nombre = p.producto || p.nombre || p[0] || "—";
              const count = p.count ?? p.cantidad ?? p[1] ?? 0;
              const max = Math.max(...porProducto.map((x) => x.count ?? x.cantidad ?? x[1] ?? 0));
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-foreground w-32 truncate shrink-0">{nombre}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full" style={{ width: `${max ? (count / max) * 100 : 0}%` }} />
                  </div>
                  <span className="text-xs font-bold text-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Última compra */}
      {ultima?.ok !== undefined && (
        <div className="bg-card border border-border/20 rounded-2xl p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Última Compra
          </h4>
          <div className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ultima.ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
              {ultima.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground truncate">
                {ultima.producto_nombre || ultima.producto}
                {ultima.nickname && <span className="text-muted-foreground font-normal"> → {ultima.nickname}</span>}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono">
                ID: {ultima.id_juego} · {ultima.dur || "—"}
                {od.fecha && ` · ${od.fecha}`}
              </p>
              {od.transactionId && (
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Tx: {od.transactionId}</p>
              )}
            </div>
            <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${ultima.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
              {ultima.ok ? "ÉXITO" : "FALLÓ"}
            </span>
          </div>
        </div>
      )}

      {/* Log crudo */}
      <div className="bg-card border border-border/20 rounded-2xl p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" /> Respuesta del Sistema (JSON)
        </h4>
        <pre className="text-[10px] leading-relaxed text-muted-foreground bg-muted/40 rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap break-words font-mono">
{status ? JSON.stringify(status, null, 2) : (connErr || "Sin datos del sistema.")}
        </pre>
      </div>
    </div>
  );
}