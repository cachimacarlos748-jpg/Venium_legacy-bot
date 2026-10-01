import { X, Home, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import InstallAppButton from "@/components/InstallAppButton";

const GROUPS = [
  { label: "Catálogo", ids: ["products", "carousel"] },
  { label: "Operaciones", ids: ["orders", "payments", "events", "venium", "bot", "analytics"] },
  { label: "Creadores", ids: ["creators", "commissions"] },
  { label: "Sistema", ids: ["codes", "discounts", "ai"] },
];

export default function AdminSidebar({ tabs, active, onSelect, botOnline, mobileOpen, onCloseMobile }) {
  const renderNav = () => (
    <nav className="flex flex-col gap-5 px-3 py-4 overflow-y-auto">
      {GROUPS.map((g) => (
        <div key={g.label}>
          <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">{g.label}</p>
          <div className="flex flex-col gap-0.5">
            {g.ids.map((id) => {
              const t = tabs.find((x) => x.id === id);
              if (!t) return null;
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => { onSelect(id); onCloseMobile?.(); }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  <t.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {id === "bot" && (
                    <span className={`w-2 h-2 rounded-full ml-auto ${
                      botOnline === null ? "bg-muted-foreground/40" : botOnline ? "bg-green-400" : "bg-red-400"
                    }`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border/20 bg-card/40 sticky top-0 h-screen">
        <div className="h-14 flex items-center gap-2 px-5 border-b border-border/20 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-black text-sm">L</span>
          </div>
          <span className="font-bold text-foreground text-sm">Panel de Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto">{renderNav()}</div>
        <div className="p-3 border-t border-border/20 shrink-0 space-y-1">
          <InstallAppButton variant="full" className="w-full px-3 py-2 rounded-lg hover:bg-muted/60" />
          <Link to="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
            <Home className="w-3.5 h-3.5" /> Ver tienda
          </Link>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCloseMobile} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border/20 flex flex-col">
            <div className="h-14 flex items-center justify-between px-5 border-b border-border/20 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-black text-sm">L</span>
                </div>
                <span className="font-bold text-foreground text-sm">Panel de Admin</span>
              </div>
              <button onClick={onCloseMobile} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderNav()}</div>
            <div className="p-3 border-t border-border/20 space-y-1">
              <InstallAppButton variant="full" className="w-full px-3 py-2 rounded-lg hover:bg-muted/60" />
              <Link to="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60">
                <ArrowLeft className="w-3.5 h-3.5" /> Ver tienda
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}