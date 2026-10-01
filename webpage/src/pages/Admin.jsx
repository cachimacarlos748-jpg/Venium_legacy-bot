import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Package, ShoppingBag, CreditCard, Bot, Zap, ShieldAlert, Users, Image, BarChart3, Gift, Ticket, Wallet, Search, Menu, Ban, Moon } from "lucide-react";
import InstallAppButton from "@/components/InstallAppButton";
import AdminNotifications from "@/components/admin/AdminNotifications";
import { useAuth } from "@/lib/AuthContext";
import { syncVeniumCatalog } from "@/lib/veniumClient";
import VeniumTab from "@/components/admin/VeniumTab";
import ProductManager from "@/components/admin/ProductManager";
import OrderManager from "@/components/admin/OrderManager";
import SettingsPanel from "@/components/admin/SettingsPanel";
import AIAssistant from "@/components/admin/AIAssistant";
import BotFreeFireTab from "@/components/admin/BotFreeFireTab";
import CreatorsTab from "@/components/admin/CreatorsTab";
import CarouselEditor from "@/components/admin/CarouselEditor";
import AnalyticsTab from "@/components/admin/AnalyticsTab";
import PrizeCodesTab from "@/components/admin/PrizeCodesTab";
import DiscountCodesTab from "@/components/admin/DiscountCodesTab";
import BlocklistTab from "@/components/admin/BlocklistTab";
import CommissionsTab from "@/components/admin/CommissionsTab";
import EventsTab from "@/components/admin/EventsTab";
import AdminKpiStrip from "@/components/admin/AdminKpiStrip";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState("products");
  const [botOnline, setBotOnline] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const setOnline = (v) => setBotOnline(Boolean(v));

  const TABS = [
    { id: "products", label: "Productos", icon: Package, component: <ProductManager /> },
    { id: "orders", label: "Pedidos", icon: ShoppingBag, component: <OrderManager /> },
    { id: "carousel", label: "Carrusel", icon: Image, component: <CarouselEditor /> },
    { id: "payments", label: "Pagos y Config", icon: CreditCard, component: <SettingsPanel /> },
    { id: "ai", label: "Asistente IA", icon: Bot, component: <AIAssistant /> },
    { id: "events", label: "Eventos", icon: Moon, component: <EventsTab /> },
    { id: "venium", label: "Venium", icon: Zap, component: <VeniumTab /> },
    { id: "bot", label: "Sistema Free Fire", icon: Zap, dot: botOnline, component: <BotFreeFireTab onOnlineChange={setOnline} /> },
    { id: "analytics", label: "Métricas", icon: BarChart3, component: <AnalyticsTab /> },
    { id: "creators", label: "Creadores", icon: Users, component: <CreatorsTab /> },
    { id: "commissions", label: "Comisiones", icon: Wallet, component: <CommissionsTab /> },
    { id: "codes", label: "Códigos Premio", icon: Gift, component: <PrizeCodesTab /> },
    { id: "discounts", label: "Descuentos", icon: Ticket, component: <DiscountCodesTab /> },
    { id: "blocklist", label: "Bloqueos", icon: Ban, component: <BlocklistTab /> },
  ];

  useEffect(() => {
    if (user && user.role === "admin") {
      syncVeniumCatalog().catch(() => {});
    }
  }, [user]);

  if (user && user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <ShieldAlert className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-lg font-bold text-foreground mb-2">Acceso restringido</h1>
          <p className="text-sm text-muted-foreground mb-4">Solo administradores pueden ingresar al panel.</p>
          <Link to="/" className="text-primary text-sm hover:underline">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  const Active = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        botOnline={botOnline}
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-border/20 bg-card/80 backdrop-blur-md">
          <div className="h-14 flex items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setMobileNav(true)}
              className="lg:hidden p-2 rounded-lg text-muted-foreground hover:bg-muted"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-black text-sm">L</span>
              </div>
            </div>

            {/* Global search */}
            <div className="hidden sm:flex items-center gap-2 bg-muted/60 border border-border/30 rounded-lg px-3 py-1.5 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                placeholder="Buscar global..."
                className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none w-full"
              />
            </div>

            <div className="ml-auto flex items-center gap-3">
              {/* Notificaciones de pedidos en tiempo real */}
              <AdminNotifications />
              {/* Instalar app (PWA) */}
              <InstallAppButton variant="full" className="hidden sm:flex items-center gap-1.5 border border-border/20 hover:border-primary/50 bg-card/30 rounded-lg px-2.5 py-1.5" />
              {/* Bot status badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border/30">
                <span className={`w-2 h-2 rounded-full ${
                  botOnline === null ? "bg-muted-foreground/40" : botOnline ? "bg-green-400 badge-pulse" : "bg-red-400"
                }`} />
                <span className="text-xs font-bold text-foreground hidden sm:inline">Sistema Free Fire</span>
                <span className={`text-xs font-bold ${botOnline ? "text-green-400" : "text-red-400"}`}>
                  {botOnline === null ? "—" : botOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
              <Link to="/" className="text-xs text-muted-foreground hover:text-primary hidden sm:inline">
                Tienda
              </Link>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 w-full max-w-[1400px] mx-auto">
          <AdminKpiStrip botOnline={botOnline} />

          <div className="mt-6">
            <div className="flex items-center gap-2 mb-4">
              <Active.icon className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-black text-foreground">{Active.label}</h1>
            </div>
            {Active.component}
          </div>
        </main>
      </div>
    </div>
  );
}