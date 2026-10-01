import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, LogOut, LayoutDashboard, DollarSign, Video, User, Home as HomeIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import SummaryTab from "@/components/creators/SummaryTab";
import VideosList from "@/components/creators/VideosList";
import RewardsHistory from "@/components/creators/RewardsHistory";
import ProfileEditor from "@/components/creators/ProfileEditor";
import CommissionsTab from "@/components/creators/CommissionsTab";

const TABS = [
  { id: "resumen", label: "Inicio", icon: LayoutDashboard },
  { id: "comisiones", label: "Ganancias", icon: DollarSign },
  { id: "videos", label: "Videos", icon: Video },
  { id: "perfil", label: "Perfil", icon: User },
];

export default function CreatorDashboard({ creator, videos, loading, email, onLogout, onRefresh, err }) {
  const [tab, setTab] = useState("resumen");
  const balance = creator?.balance || 0;
  const isApproved = creator?.status === "approved";

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* === HEADER === */}
      <div className="bg-gradient-to-b from-primary/10 via-card to-background border-b border-border/10 sticky top-0 z-30">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <span className="text-primary font-black text-lg">{(creator?.name || "C")?.[0]?.toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-foreground truncate">{creator?.name || "Creador"}</h3>
                <p className="text-[11px] text-muted-foreground truncate">{email}</p>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={onRefresh} disabled={loading}
                className="p-2.5 rounded-xl bg-card border border-border/20 text-muted-foreground hover:text-primary transition-colors">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button onClick={onLogout}
                className="p-2.5 rounded-xl bg-card border border-border/20 text-muted-foreground hover:text-destructive transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Balance bar */}
          <div className="mt-3 flex items-center gap-2 bg-card/60 border border-border/20 rounded-2xl px-4 py-2.5">
            <DollarSign className="w-4 h-4 text-primary shrink-0" />
            <span className="text-[11px] text-muted-foreground font-medium">Balance:</span>
            <span className="text-sm font-black text-primary">{balance.toFixed(2)} Bs</span>
            {!isApproved && (
              <span className="ml-auto text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                En revisión
              </span>
            )}
          </div>
        </div>
      </div>

      {/* === CONTENT === */}
      <div className="max-w-md mx-auto px-4 py-4">
        {err && <p className="text-xs text-destructive mb-3">{err}</p>}

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {tab === "resumen" && <SummaryTab videos={videos} creator={creator} />}
            {tab === "comisiones" && <CommissionsTab creator={creator} onRefresh={onRefresh} />}
            {tab === "videos" && <VideosList videos={videos} creator={creator} onRefresh={onRefresh} />}
            {tab === "perfil" && <ProfileEditor creator={creator} loading={loading} onSaved={onRefresh} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* === BOTTOM NAV === */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/20">
        <div className="max-w-md mx-auto px-2 py-1.5 flex items-center justify-around">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all ${active ? "text-primary" : "text-muted-foreground"}`}>
                <div className={`p-1.5 rounded-xl transition-all ${active ? "bg-primary/15" : ""}`}>
                  <t.icon className="w-5 h-5" />
                </div>
                <span className={`text-[10px] font-bold ${active ? "text-primary" : ""}`}>{t.label}</span>
              </button>
            );
          })}
          <Link to="/" className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl text-muted-foreground hover:text-foreground transition-colors">
            <div className="p-1.5 rounded-xl">
              <HomeIcon className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold">Tienda</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}