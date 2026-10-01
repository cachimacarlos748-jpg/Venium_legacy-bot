import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Gamepad2, Gift, Wrench } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getProductSlug } from "@/data/purchaseConfig";

// Modal de búsqueda global (command palette). Filtra en tiempo real entre
// todos los juegos, gift cards y servicios de la tienda.
export default function SearchModal({ open, onClose }) {
  const [query, setQuery] = useState("");
  const [allItems, setAllItems] = useState({ games: [], giftCards: [], services: [] });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  // Carga todos los productos una sola vez al abrir el modal.
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const [games, giftCards, services] = await Promise.all([
          base44.entities.Game.list("-updated_date", 100),
          base44.entities.GiftCard.list("-updated_date", 100),
          base44.entities.Service.list("-updated_date", 100),
        ]);
        if (active) setAllItems({ games: games || [], giftCards: giftCards || [], services: services || [] });
      } catch {}
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Cerrar con tecla Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const filterFn = (item) => !q || (item.name || "").toLowerCase().includes(q);
  const results = {
    games: allItems.games.filter(filterFn).slice(0, 6),
    giftCards: allItems.giftCards.filter(filterFn).slice(0, 6),
    services: allItems.services.filter(filterFn).slice(0, 6),
  };
  const total = results.games.length + results.giftCards.length + results.services.length;

  const handleSelect = (item) => {
    const slug = getProductSlug(item);
    onClose();
    navigate(`/comprar/${slug}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="max-w-2xl mx-4 sm:mx-auto mt-20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-card border border-border/30 rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/20">
                <Search className="w-5 h-5 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar juegos, gift cards, servicios..."
                  className="flex-1 bg-transparent text-foreground placeholder-muted-foreground text-base focus:outline-none"
                />
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted/50 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2">
                {loading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Cargando catálogo...</div>
                ) : total === 0 ? (
                  <div className="p-8 text-center">
                    <Search className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">{q ? `Sin resultados para "${query}"` : "Escribe para buscar"}</p>
                  </div>
                ) : (
                  <>
                    {results.games.length > 0 && (
                      <SearchGroup icon={Gamepad2} title="Juegos" items={results.games} onSelect={handleSelect} />
                    )}
                    {results.giftCards.length > 0 && (
                      <SearchGroup icon={Gift} title="Gift Cards" items={results.giftCards} onSelect={handleSelect} />
                    )}
                    {results.services.length > 0 && (
                      <SearchGroup icon={Wrench} title="Servicios" items={results.services} onSelect={handleSelect} />
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SearchGroup({ icon: Icon, title, items, onSelect }) {
  return (
    <div className="mb-1">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-3 py-2 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {title}
      </p>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-primary/10 transition-colors text-left"
        >
          {item.image_url && <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-lg object-cover border border-border/20" />}
          <span className="text-foreground text-sm font-medium truncate">{item.name}</span>
        </button>
      ))}
    </div>
  );
}