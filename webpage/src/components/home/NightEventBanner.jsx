import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Moon, Zap, Flame } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatPrice } from "@/lib/priceFormat";

const EventEntity = base44.entities.NightEvent;

export default function NightEventBanner() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const load = () => {
      EventEntity.filter({ status: "active" })
        .then((r) => setEvents((r || []).filter((e) => (e.stock_sold || 0) < (e.stock_total || 0))))
        .catch(() => setEvents([]));
    };
    load();
    const unsub = EventEntity.subscribe(() => load());
    return () => unsub();
  }, []);

  if (events.length === 0) return null;
  const event = events[0]; // el más relevante (primer activo)
  const remaining = Math.max(0, (event.stock_total || 0) - (event.stock_sold || 0));

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-background py-6"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Link to={`/comprar/${event.product_slug}`} className="block">
          <div className="relative overflow-hidden rounded-2xl border-2 border-[#FF8C00]/50 bg-gradient-to-br from-[#2a1500] via-[#0A0705] to-black shadow-[0_10px_40px_rgba(255,140,0,0.2)] group hover:border-[#FF8C00]/80 transition-all duration-300">
            {/* Glow decorativo — paleta Naruto naranja/ámbar */}
            <div className="absolute -top-20 -right-10 w-56 h-56 bg-[#FF8C00]/20 rounded-full blur-[80px] pointer-events-none" />
            <div className="absolute -bottom-20 -left-10 w-56 h-56 bg-[#F59E0B]/15 rounded-full blur-[80px] pointer-events-none" />

            <div className="relative z-10 p-5 sm:p-6 flex items-center gap-4">
              {/* Icono luna */}
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-amber-500/30 to-primary/20 border border-amber-500/40 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                <Moon className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400" />
              </div>

              {/* Texto */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-400 bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 rounded-full uppercase tracking-wide">
                    <Flame className="w-3 h-3" /> Evento Nocturno
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/15 px-2 py-0.5 rounded-full">
                    <Zap className="w-3 h-3" /> Quedan {remaining}
                  </span>
                </div>
                <p className="text-sm sm:text-base font-black text-foreground truncate">
                  {event.product_name || event.product_slug}
                </p>
                <p className="text-xs text-muted-foreground truncate">{event.package_label}</p>
              </div>

              {/* Precio */}
              <div className="text-right shrink-0">
                <p className="text-xl sm:text-2xl font-black text-amber-400 leading-none">{formatPrice(event.event_price)}<span className="text-sm font-bold ml-1">Bs</span></p>
                <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">Precio flash</p>
              </div>
            </div>
          </div>
        </Link>
      </div>
    </motion.section>
  );
}