import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronRight, ChevronLeft, Zap, Shield, Clock, Star, Sparkles, Gem } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getProductSlug } from "@/data/purchaseConfig";
import CommunityPopup from "@/components/CommunityPopup";
import RecentOrdersTicker from "@/components/RecentOrdersTicker";
import NightEventBanner from "@/components/home/NightEventBanner";

import ProductCardSkeleton from "@/components/ProductCardSkeleton";
import ProductImage from "@/components/ProductImage";
import CouponsSection from "@/components/home/CouponsSection";
import FAQSection from "@/components/home/FAQSection";
import { getProductRegion } from "@/lib/productRegions";
import FallingLeaves from "@/components/pixelkonoha/FallingLeaves";
import { NinjaSprite, KonohaLeaf, UchihaFan, KonohaSpiral } from "@/components/pixelkonoha/PixelAssets";

const GameEntity = base44.entities.Game;
const GiftCardEntity = base44.entities.GiftCard;
const ServiceEntity = base44.entities.Service;
const SettingEntity = base44.entities.Setting;

const FALLBACK_BANNERS = [
  { src: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/fc312fafe_vegastorevzla_com_BANNER_PASE_BOOYAH_LANA_Y_COLMILLOS_864X323_e6f2db6b.webp", alt: "FREE FIRE BOOYAH PASS" },
  { src: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/d47bff30c_vegastorevzla_com_BANNER_WILD_RIFT_864X323_f9267b2f.webp", alt: "WILD RIFT" },
  { src: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/f350c997b_vegastorevzla_com_BANNER_STARLIGHT_JULIO_864X323_c2849b22.webp", alt: "MLBB STARLIGHT JULY" },
];

// Reusable scroll reveal component
function AnimatedElement({ children, className, delay = 0 }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) { setIsVisible(true); return; }
    const fallback = setTimeout(() => setIsVisible(true), 800 + delay);
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { 
        clearTimeout(fallback); 
        setTimeout(() => setIsVisible(true), delay); 
        observer.unobserve(el); 
      }
    }, { threshold: 0.05, rootMargin: "0px 0px 200px 0px" });
    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(fallback); };
  }, [delay]);
  return (
    <div ref={ref} className={`transition-all duration-1000 ease-out ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"} ${className || ""}`}>
      {children}
    </div>
  );
}

// Global Custom Animations injected directly
const StyleInjector = () => (
  <style dangerouslySetInnerHTML={{__html: `
    @keyframes floatA {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-30px) scale(1.05); }
    }
    @keyframes floatB {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(30px) scale(0.95); }
    }
    @keyframes shimmer {
      100% { transform: translateX(100%); }
    }
    .scrollbar-hide::-webkit-scrollbar {
        display: none;
    }
    .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
  `}} />
);

const banners = [
  {
    src: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/fc312fafe_vegastorevzla_com_BANNER_PASE_BOOYAH_LANA_Y_COLMILLOS_864X323_e6f2db6b.webp",
    alt: "FREE FIRE BOOYAH PASS"
  },
  {
    src: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/d47bff30c_vegastorevzla_com_BANNER_WILD_RIFT_864X323_f9267b2f.webp",
    alt: "WILD RIFT"
  },
  {
    src: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/f350c997b_vegastorevzla_com_BANNER_STARLIGHT_JULIO_864X323_c2849b22.webp",
    alt: "MLBB STARLIGHT JULY"
  }
];

// Colorea los badges por estado (Disponible / Mantenimiento / Próximamente).
function badgeClassFor(badge) {
  const t = String(badge || "").toLowerCase();
  if (t.includes("próxim") || t.includes("proxi")) return "bg-slate-500/90 text-white";
  if (t.includes("manten")) return "bg-amber-500/90 text-black";
  if (t.includes("disponible")) return "bg-green-600/90 text-white";
  return "bg-primary/90 text-primary-foreground";
}

function HeroCarousel() {
  const [current, setCurrent] = useState(0);
  const [banners, setBanners] = useState([
    { creator: true, src: "", alt: "Programa de Creadores" },
    ...FALLBACK_BANNERS,
  ]);

  useEffect(() => {
    let active = true;
    const loadBanners = async () => {
      const all = await SettingEntity.list("-updated_date", 200).catch(() => []);
      if (!active) return;
      const map = {};
      (all || []).forEach((s) => { if (s.key && s.key.startsWith("carousel")) map[s.key] = s.value; });
      const creatorsEnabled = map["carousel_creators_enabled"] !== "false";
      const slides = [];
      if (creatorsEnabled) slides.push({ creator: true, src: map["carousel_creators"] || "", alt: "Programa de Creadores" });
      slides.push(
        { src: map["carousel_1"] || FALLBACK_BANNERS[0].src, alt: FALLBACK_BANNERS[0].alt },
        { src: map["carousel_2"] || FALLBACK_BANNERS[1].src, alt: FALLBACK_BANNERS[1].alt },
        { src: map["carousel_3"] || FALLBACK_BANNERS[2].src, alt: FALLBACK_BANNERS[2].alt },
      );
      setBanners(slides);
    };
    loadBanners();
    const unsub = SettingEntity.subscribe(() => loadBanners());
    return () => { active = false; unsub(); };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrent(p => (p + 1) % banners.length), 5000);
    return () => clearInterval(timer);
  }, [banners.length]);
  
  return (
    <section className="relative bg-background pt-8 pb-12">
      {/* Decorative ambient orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen" style={{ animation: 'floatA 12s ease-in-out infinite' }} />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-accent/5 rounded-full blur-[150px] pointer-events-none mix-blend-screen" style={{ animation: 'floatB 15s ease-in-out infinite alternate' }} />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10"
      >
        {/* Sprite ninja pixelado — esquina superior derecha del hero */}
        <div className="absolute -top-2 right-2 sm:right-6 z-20 pointer-events-none hidden sm:block">
          <div className="animate-ninja-breathe drop-shadow-[0_0_15px_rgba(255,140,0,0.4)]">
            <NinjaSprite size={72} />
          </div>
        </div>
        <div className="relative rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] group border border-[#FF8C00]/20">
          <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent z-10 pointer-events-none" />
          <div
            className="flex transition-transform duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
            style={{ transform: `translateX(-${current * 100}%)` }}
          >
            {banners.map((b, i) => (
              <div key={i} className="w-full flex-shrink-0 relative">
                {b.creator ? (
                  <div className="relative w-full aspect-[21/9] sm:aspect-[864/323] overflow-hidden">
                    {b.src ? (
                      <img src={b.src} alt={b.alt} className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#2A0D4A] via-[#1A0830] to-black">
                        <div className="absolute left-[10%] top-1/2 -translate-y-1/2 w-16 h-16 text-purple-300/30" style={{ animation: "floatA 8s ease-in-out infinite" }}><Gem className="w-full h-full" /></div>
                        <div className="absolute right-[20%] bottom-6 w-10 h-10 text-pink-300/40" style={{ animation: "floatB 10s ease-in-out infinite" }}><Sparkles className="w-full h-full" /></div>
                      </div>
                    )}
                    <Link to="/creadores" className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 z-20 inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-xs sm:text-sm font-bold px-5 py-2.5 rounded-full shadow-lg shadow-pink-500/40 ring-2 ring-white/20 hover:ring-white/40 hover:scale-105 transition-all duration-300">
                      <Sparkles className="w-4 h-4" /> Postúlate aquí
                    </Link>
                  </div>
                ) : (
                  <img
                    src={b.src}
                    alt={b.alt}
                    className="w-full object-cover aspect-[21/9] sm:aspect-[864/323]"
                  />
                )}
              </div>
            ))}
          </div>
          
          <button
            onClick={() => setCurrent(p => (p - 1 + banners.length) % banners.length)}
            className="absolute z-20 left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-background/50 backdrop-blur-md hover:bg-primary border border-white/10 text-white rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          
          <button
            onClick={() => setCurrent(p => (p + 1) % banners.length)}
            className="absolute z-20 right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-background/50 backdrop-blur-md hover:bg-primary border border-white/10 text-white rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20">
            {banners.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`rounded-full transition-all duration-500 ease-out ${i === current ? "w-8 h-2 bg-primary shadow-[0_0_10px_rgba(var(--primary),0.8)]" : "w-2 h-2 bg-white/40 hover:bg-white/80"}`}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// Reusable Section Header matching screenshot
function SectionHeader({ title, linkTo }) {
  return (
    <div className="flex items-center justify-between mb-6 pb-2 border-b border-border/10">
      <h2 className="text-sm sm:text-base font-pixel text-primary tracking-widest uppercase relative flex items-center gap-2">
        <KonohaSpiral size={16} className="text-primary shrink-0" />
        {title}
        <span className="absolute -bottom-[9px] left-0 w-1/2 h-[2px] bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary),0.5)]"></span>
      </h2>
      <Link to={linkTo} className="flex items-center gap-1 text-muted-foreground hover:text-primary text-sm font-medium transition-colors duration-200 group">
        Ver más <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </Link>
    </div>
  );
}

// Reusable Card for Games, GiftCards, Services (matches screenshot aesthetic)
function ProductCard({ item, delay }) {
  return (
    <AnimatedElement delay={delay} className="flex-shrink-0 w-[150px] sm:w-[180px]">
      <Link to={`/comprar/${getProductSlug(item)}`} className="block group">
        <div className="bg-card rounded-xl overflow-hidden border border-border/20 border-b-[3px] border-b-transparent hover:border-b-primary hover:border-border/40 transition-all duration-300 hover:-translate-y-2 shadow-sm hover:shadow-[0_10px_30px_rgba(0,0,0,0.5)] relative">
          
          <div className="relative aspect-square overflow-hidden bg-muted/20">
            <ProductImage
              src={item.image_url}
              alt={item.name}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            {/* Símbolo de clan pixel (Konoha/Uchiha) — esquina superior izquierda */}
            <div className="absolute top-1.5 left-1.5 z-20 bg-black/50 rounded-sm p-0.5 border border-[#FF8C00]/40 animate-pixel-blink">
              {isFps(item.name) ? <UchihaFan size={16} /> : <KonohaLeaf size={16} />}
            </div>
            
            {item.badge && (
              <span className={`absolute top-2 right-2 ${badgeClassFor(item.badge)} backdrop-blur-sm text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-lg`}>
                {item.badge}
              </span>
            )}
          </div>
          
          <div className="p-3 bg-card relative z-10 border-t border-border/10">
            <p className="text-foreground text-sm font-bold truncate text-center group-hover:text-primary transition-colors">
              {item.name}
            </p>
            {getProductRegion(getProductSlug(item)) && (
              <p className="text-[10px] text-muted-foreground font-medium text-center mt-0.5 uppercase tracking-wide">
                {getProductRegion(getProductSlug(item))}
              </p>
            )}
          </div>
        </div>
      </Link>
    </AnimatedElement>
  );
}

const FPS_KEYWORDS = ["free fire", "blood strike", "call of duty", "pubg", "cod", "warzone", "valorant", "bgmi", "farlight", "creative", "modern strike"];
function isFps(name) {
  const n = String(name || "").toLowerCase();
  return FPS_KEYWORDS.some((k) => n.includes(k));
}

// Filtra productos que NO son juegos (gift cards, servicios, billeteras) que
// llegaron a la entidad Game al sincronizar el catálogo del proveedor.
const NON_GAME_KEYWORDS = ["steam", "binance", "zinli", "bigo", "poppo", "playstation", "xbox", "nintendo", "apple", "netflix", "discord", "wally", "spotify", "tiktok", "gift card", "giftcard"];
function isActualGame(item) {
  const s = String(item.slug || item.name || "").toLowerCase();
  return !NON_GAME_KEYWORDS.some((k) => s.includes(k));
}

function GamesSection({ games, loading }) {
  const scrollRef = useRef(null);
  
  const staticFallback = [
    { name: "Free Fire", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/ef6664c9e_vegastorevzla_com_FF_EEUU_LATAM_tNEvelo_78989fe7.webp" },
    { name: "Blood Strike", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/7ce2c6e6b_vegastorevzla_com_BLOODSTRIKE_3574ccaf.webp" },
    { name: "Mobile Legends", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/c1aeaf6b4_vegastorevzla_com_MOBILE_LEGENDS_e07cd821.webp" },
    { name: "Call of Duty Mobile", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/9a0f4fc14_vegastorevzla_com_CALL_OF_DUTY_MOBILE_09e0361f.webp" },
    { name: "Genshin Impact", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/215726e96_vegastorevzla_com_GENSHIN_IMPACT_Rc2JPlT_3aab0265.webp" },
    { name: "Wild Rift", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/4b4f2b383_vegastorevzla_com_WILD_RIFT_7f7ebc10.webp" },
  ];
  const filteredGames = games.filter(isActualGame);
  const items = loading ? [] : [...filteredGames].sort((a, b) => {
    const ao = a.sort_order ?? 9999;
    const bo = b.sort_order ?? 9999;
    return ao - bo;
  });

  return (
    <AnimatedElement>
      <section className="bg-background py-10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <SectionHeader title="Juegos Móviles" linkTo="/Games" />
          
          <div className="relative group">
            <button 
              onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: "smooth" })} 
              className="absolute -left-5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-card border border-border/30 text-card-foreground rounded-full shadow-xl hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-6 pt-2 px-2 -mx-2 scrollbar-hide snap-x">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="snap-start"><ProductCardSkeleton /></div>
                  ))
                : items.map((game, i) => (
                    <div key={i} className="snap-start">
                      <ProductCard item={game} delay={i * 100} />
                    </div>
                  ))}
            </div>
            
            <button 
              onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })} 
              className="absolute -right-5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-card border border-border/30 text-card-foreground rounded-full shadow-xl hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>
    </AnimatedElement>
  );
}

function BestSellersSection() {
  const bestsellers = [
    {
      name: "Free Fire",
      category: "Juegos moviles",
      sales: "Más de 10 ventas",
      image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/9a9226135_vegastorevzla_com_FF_EEUU_LATAM_61QuL7H_163d5495.webp",
      desc: "Comprar Diamantes Free Fire Venezuela - Pago Móvil. Te ofrecemos el servicio de recarga más rápido y seguro.",
    },
    {
      name: "Blood Strike",
      category: "Juegos moviles",
      sales: "Más de 10 ventas",
      image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/c113a2df3_vegastorevzla_com_BLOODSTRIKE_e3e185c6.webp",
      desc: "Blood Strike es un FPS gratuito y multiplataforma que se enfoca en la acción rápida y los combates frenéticos.",
    },
    {
      name: "Zinli",
      category: "Servicios",
      sales: "Más de 10 ventas",
      image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/8761ae46a_vegastorevzla_com_ZINLI_BP_824X400_b50843a5.webp",
      desc: "Zinli es una billetera virtual en dólares que te permite tener una Tarjeta Visa prepagada para compras en USD.",
    },
  ];

  return (
    <AnimatedElement>
      <section className="bg-muted/30 py-12 border-y border-border/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <SectionHeader title="Más Vendidos" linkTo="/Games" />
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {bestsellers.map((item, i) => (
              <AnimatedElement key={i} delay={i * 150}>
                <Link to={`/comprar/${getProductSlug(item)}`} className="flex flex-col h-full bg-card rounded-2xl overflow-hidden border border-border/10 hover:border-primary/50 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] group">
                  <div className="relative overflow-hidden aspect-[21/9]">
                    <img 
                      src={item.image_url} 
                      alt={item.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent opacity-80" />
                  </div>
                  
                  <div className="p-6 flex flex-col flex-grow bg-card relative z-10 -mt-2">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-[10px] font-bold text-primary px-2.5 py-1 rounded-sm bg-primary/10 border border-primary/20 uppercase tracking-wide">
                        {item.sales}
                      </span>
                      <span className="text-[10px] font-bold bg-primary text-primary-foreground px-2.5 py-1 rounded-sm uppercase tracking-wide">
                        {item.category}
                      </span>
                    </div>
                    
                    <p className="text-muted-foreground text-sm leading-relaxed mb-6 flex-grow">
                      {item.desc}
                    </p>
                    
                    <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/10 text-foreground font-bold text-sm group-hover:text-primary transition-colors">
                      Ver más detalles del juego 
                      <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </Link>
              </AnimatedElement>
            ))}
          </div>
        </div>
      </section>
    </AnimatedElement>
  );
}

function PromoBannersSection() {
  return (
    <AnimatedElement>
      <section className="bg-background py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <Link to="/comprar/roblox-gift-card" className="block relative rounded-2xl overflow-hidden border border-border/10 group hover:border-primary/50 transition-all duration-500 shadow-2xl hover:shadow-primary/20">
            <div className="absolute inset-0 bg-primary/20 mix-blend-overlay opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10" />
            <img
              src="https://media.base44.com/images/public/6a5b9606e1931edeb474236e/cf63c6584_vegastorevzla_com_1920_X_400_ROBLOX2_GIFT_CARD_7d474410.webp"
              alt="Roblox Gift Card Promoción"
              className="w-full object-cover aspect-[21/9] sm:aspect-[1920/400] group-hover:scale-[1.02] transition-transform duration-1000 ease-out"
            />
          </Link>
        </div>
      </section>
    </AnimatedElement>
  );
}

function GiftCardsSection({ giftCards, loading }) {
  const scrollRef = useRef(null);

  const staticFallback = [
    { name: "Apple USA", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/06214faa2_vegastorevzla_com_APPLE_GIFT_CARDS_1e97eb3f.webp" },
    { name: "Roblox Gift Card", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/f466360c7_vegastorevzla_com_ROBLOX_15477c5c.webp" },
    { name: "Riot Access", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/96578f24b_vegastorevzla_com_RIOT_GIFT_CARDS_5d9b613d.webp" },
    { name: "PlayStation", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/20207fd76_vegastorevzla_com_PLAYSTATION_GIFT_CARDS_Svqb0Wy_c4ca4eab.webp" },
    { name: "Steam USA", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/749fa37f1_vegastorevzla_com_STEAM_GIFT_CARDS_0c79eeed.webp" },
    { name: "Xbox Gift Card", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/202f2cb04_vegastorevzla_com_XBOX_GIFT_CARDS_uCxwiRe_fb587fce.webp" },
  ];
  const items = loading ? [] : [...giftCards].sort((a, b) => {
    const ao = a.sort_order ?? 9999;
    const bo = b.sort_order ?? 9999;
    return ao - bo;
  });

  return (
    <AnimatedElement>
      <section className="bg-background py-10 relative">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-64 h-64 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <SectionHeader title="Tarjetas de Regalo" linkTo="/GiftCards" />
          
          <div className="relative group">
            <button 
              onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: "smooth" })} 
              className="absolute -left-5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-card border border-border/30 text-card-foreground rounded-full shadow-xl hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-6 pt-2 px-2 -mx-2 scrollbar-hide snap-x">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="snap-start"><ProductCardSkeleton /></div>
                  ))
                : items.map((card, i) => (
                    <div key={i} className="snap-start">
                      <ProductCard item={card} delay={i * 100} />
                    </div>
                  ))}
            </div>
            
            <button 
              onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })} 
              className="absolute -right-5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-card border border-border/30 text-card-foreground rounded-full shadow-xl hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>
    </AnimatedElement>
  );
}

function ServicesSection({ services, loading }) {
  const scrollRef = useRef(null);

  const staticFallback = [
    { name: "Zinli", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/2a61ff392_vegastorevzla_com_ZINLI_15511973.webp" },
    { name: "Wally", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/2d69219b1_vegastorevzla_com_WALLY_39d6daad.webp" },
    { name: "Discord Nitro", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/f0845e289_vegastorevzla_com_DISCORD_NITRO_2d5c996b.webp" },
    { name: "Netflix", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/42a2e07f5_vegastorevzla_com_NETFLIX_3AXvbx8_da953bf7.png" },
    { name: "BIGO Live", image_url: "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/df48b8af8_vegastorevzla_com_BIGO_LIVE_d5a1363e.webp" },
  ];
  const items = loading ? [] : [...services].sort((a, b) => {
    const ao = a.sort_order ?? 9999;
    const bo = b.sort_order ?? 9999;
    return ao - bo;
  });

  return (
    <AnimatedElement>
      <section className="bg-background py-10 relative mb-10">
         <div className="absolute right-0 top-1/2 -translate-y-1/2 w-64 h-64 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <SectionHeader title="Servicios" linkTo="/Servicios" />
          
          <div className="relative group">
            <button 
              onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: "smooth" })} 
              className="absolute -left-5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-card border border-border/30 text-card-foreground rounded-full shadow-xl hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-6 pt-2 px-2 -mx-2 scrollbar-hide snap-x">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="snap-start"><ProductCardSkeleton /></div>
                  ))
                : items.map((svc, i) => (
                    <div key={i} className="snap-start">
                      <ProductCard item={svc} delay={i * 100} />
                    </div>
                  ))}
            </div>
            
            <button 
              onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })} 
              className="absolute -right-5 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center bg-card border border-border/30 text-card-foreground rounded-full shadow-xl hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>
    </AnimatedElement>
  );
}

function TrustSection() {
  const features = [
    { icon: Zap, title: "Entrega Inmediata", desc: "Sistema automatizado para envíos al instante." },
    { icon: Shield, title: "Pagos Seguros", desc: "Múltiples métodos de pago protegidos y validados." },
    { icon: Clock, title: "Soporte 24/7", desc: "Atención al cliente dedicada a cualquier hora." },
    { icon: Star, title: "Garantía Total", desc: "Miles de recargas exitosas en toda LATAM." },
  ];
  return (
    <AnimatedElement>
      <section className="bg-muted/30 py-16 border-t border-border/10 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-background/0 to-background/0 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          
          <div className="text-center max-w-2xl mx-auto mb-12">
             <h2 className="text-3xl md:text-4xl font-black text-foreground tracking-tight mb-4">
              Por qué confiar en <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-300">Legacy Store</span>
            </h2>
            <p className="text-muted-foreground text-lg">Tu plataforma premium para recargas de videojuegos y tarjetas de regalo.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <AnimatedElement key={i} delay={i * 150}>
                <div className="flex flex-col items-center text-center p-8 rounded-2xl bg-card border border-border/10 hover:border-primary/40 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.3)] group relative overflow-hidden">
                  <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/5 rounded-full blur-[30px] group-hover:bg-primary/10 transition-colors duration-500" />
                  
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-6 shadow-inner border border-primary/20 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
                    <f.icon className="w-8 h-8 text-primary" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-foreground text-lg font-bold mb-3">{f.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{f.desc}</p>
                </div>
              </AnimatedElement>
            ))}
          </div>
        </div>
      </section>
    </AnimatedElement>
  );
}

export default function Home() {
  const [games, setGames] = useState([]);
  const [giftCards, setGiftCards] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Preserve API calls
    Promise.all([
      GameEntity.list("-updated_date", 100).catch(() => []),
      GiftCardEntity.list("-updated_date", 20).catch(() => []),
      ServiceEntity.list("-updated_date", 20).catch(() => []),
    ]).then(([g, gc, sv]) => {
      setGames(g); setGiftCards(gc); setServices(sv); setLoading(false);
    });

  }, []);

  // Suscripciones en tiempo real: cuando el admin cambia productos o banners,
  // el Home se actualiza solo sin que el cliente tenga que recargar la página.
  useEffect(() => {
    const unsubGames = GameEntity.subscribe(() => GameEntity.list("-updated_date", 100).then(setGames).catch(() => {}));
    const unsubGiftCards = GiftCardEntity.subscribe(() => GiftCardEntity.list("-updated_date", 20).then(setGiftCards).catch(() => {}));
    const unsubServices = ServiceEntity.subscribe(() => ServiceEntity.list("-updated_date", 20).then(setServices).catch(() => {}));
    return () => { unsubGames(); unsubGiftCards(); unsubServices(); };
  }, []);

  return (
    <div className="pixel-konoha min-h-screen bg-background selection:bg-primary/30 selection:text-primary relative">
      <StyleInjector />
      <FallingLeaves />
      <CommunityPopup />
      <NightEventBanner />
      <HeroCarousel />
      <RecentOrdersTicker />
      <CouponsSection />
      <GamesSection games={games} loading={loading} />
      <GiftCardsSection giftCards={giftCards} loading={loading} />
      <ServicesSection services={services} loading={loading} />
      <PromoBannersSection />
      <BestSellersSection />
      <TrustSection />
      <FAQSection />
    </div>
  );
}