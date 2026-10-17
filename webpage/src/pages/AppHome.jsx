// Home alternativo SOLO en modo app: layout de app (buscador, chips,
// filas horizontales tipo app) que reutiliza exactamente las mismas consultas
// de datos, slugs y tarjetas del Home web. El flujo de comprar no cambia:
// cada tarjeta navega a /comprar/:slug igual que en la web.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Bell, ChevronRight, Gamepad2, Gift, Wrench, Flame, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getProductSlug } from "@/data/purchaseConfig";
import ProductImage from "@/components/ProductImage";
import { NON_GAME_KEYWORDS_NEEDED } from "./homeAppShared";

const GameEntity = base44.entities.Game;
const GiftCardEntity = base44.entities.GiftCard;
const ServiceEntity = base44.entities.Service;

function RowCard({ item, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      className="flex-shrink-0 w-36 sm:w-40"
    >
      <Link to={`/comprar/${getProductSlug(item)}`} className="block tap group">
        <div className="surface overflow-hidden rounded-2xl border-b-[3px] border-b-transparent hover:border-b-primary transition-all duration-300">
          <div className="relative aspect-square bg-muted/20">
            <ProductImage
              src={item.image_url}
              alt={item.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            {item.badge && (
              <span className="absolute top-2 right-2 bg-primary/90 text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                {item.badge}
              </span>
            )}
          </div>
          <div className="p-2.5">
            <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{item.name}</p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function Rows({ title, icon: Icon, items, loading, onSeeAll, accent = "primary" }) {
  return (
    <section className="py-5">
      <div className="flex items-center justify-between px-4 mb-3">
        <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
          <Icon className={`w-4.5 h-4.5 text-${accent}`} />
          {title}
        </h2>
        <button onClick={onSeeAll} className="flex items-center gap-1 text-sm muted-foreground hover:text-primary transition-colors">
          Ver más <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 snap-x">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-36 sm:w-40 aspect-[3/4] rounded-2xl bg-muted/40 animate-pulse" />
            ))
          : items.map((p, i) => (
              <div key={i} className="snap-start"><RowCard item={p} delay={i * 0.06} /></div>
            ))}
        {!loading && !items.length && (
          <p className="text-sm muted-foreground px-1">Catálogo cargando. Desliza o reintenta en un momento.</p>
        )}
      </div>
    </section>
  );
}

export default function AppHome() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [giftCards, setGiftCards] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      GameEntity.list("-updated_date", 100).catch(() => []),
      GiftCardEntity.list("-updated_date", 20).catch(() => []),
      ServiceEntity.list("-updated_date", 20).catch(() => []),
    ]).then(([g, gc, sv]) => {
      setGames(g); setGiftCards(gc); setServices(sv); setLoading(false);
    });
    const unsubs = [
      GameEntity.subscribe(() => GameEntity.list("-updated_date", 100).then(setGames).catch(() => {})),
      GiftCardEntity.subscribe(() => GiftCardEntity.list("-updated_date", 20).then(setGiftCards).catch(() => {})),
      ServiceEntity.subscribe(() => ServiceEntity.list("-updated_date", 20).then(setServices).catch(() => {})),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const realGames = useMemo(() => games.filter((g) => !NON_GAME_KEYWORDS_NEEDED.some((k) => String(g.slug || g.name || "").toLowerCase().includes(k))), [games]);
  const sortAsc = (a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
  const gamesSorted = [...realGames].sort(sortAsc);
  const giftsSorted = [...giftCards].sort(sortAsc);
  const servicesSorted = [...services].sort(sortAsc);
  const popular = [...gamesSorted.slice(0, 6), ...giftsSorted.slice(0, 3)];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen bg-background"
    >
      {/* Cabecera saludo + buscador */}
      <header className="pt-5 pb-2 px-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Bienvenido a</p>
            <h1 className="text-2xl font-black tracking-tight">
              Vex <span className="text-primary">Store</span>
            </h1>
          </div>
          <Link to="/mis-pedidos" className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center tap" aria-label="Mis pedidos">
            <Bell className="w-5 h-5 text-primary" />
          </Link>
        </div>
        <button
          onClick={() => navigate("/Games")}
          className="w-full h-12 rounded-2xl bg-card border border-border px-4 flex items-center gap-3 text-muted-foreground tap glow-primary"
        >
          <Search className="w-5 h-5 text-primary" />
          <span className="text-sm">Buscar recargas, gift cards…</span>
        </button>
        {/* Chips de categorías */}
        <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide">
          <Link to="/Games" className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-primary/15 border border-primary/30 text-primary text-sm font-bold tap">
            <Flame className="w-4 h-4" /> Juegos
          </Link>
          <Link to="/GiftCards" className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-card border border-border text-sm font-bold tap">
            <Gift className="w-4 h-4 text-accent" /> Gift Cards
          </Link>
          <Link to="/Servicios" className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-card border border-border text-sm font-bold tap">
            <Wrench className="w-4 h-4 text-muted-foreground" /> Servicios
          </Link>
        </div>
      </header>

      {/* Destacados */}
      <Rows title="Populares ahora" icon={Flame} items={popular} loading={loading} onSeeAll={() => navigate("/Games")} />
      <Rows title="Juegos móviles" icon={Gamepad2} items={gamesSorted} loading={loading} onSeeAll={() => navigate("/Games")} />
      <Rows title="Tarjetas de regalo" icon={Gift} items={giftsSorted} loading={loading} onSeeAll={() => navigate("/GiftCards")} accent="accent" />
      <Rows title="Servicios" icon={Wrench} items={servicesSorted} loading={loading} onSeeAll={() => navigate("/Servicios")} accent="accent" />

      <Link to="/canjear" className="mx-4 my-6 flex items-center gap-3 rounded-2xl bg-primary/10 border border-primary/25 p-4 tap">
        <Sparkles className="w-6 h-6 text-primary" />
        <div className="flex-1">
          <p className="font-bold text-sm">¿Tienes un código?</p>
          <p className="text-xs text-muted-foreground">Canjéalo aquí y recibe tu saldo al instante</p>
        </div>
        <ChevronRight className="w-5 h-5 text-primary" />
      </Link>
    </motion.div>
  );
}
