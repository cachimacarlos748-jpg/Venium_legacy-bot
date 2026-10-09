import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, Search, ChevronDown, Globe, ChevronRight, Shield, Sparkles, User as UserIcon, Package, Gift } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";
import SearchModal from "@/components/SearchModal";
import PendingPaymentsNav from "@/components/PendingPaymentsNav";
import InstallAppButton from "@/components/InstallAppButton";

const LOGO_URL = "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/ce368c5aa_file_000000005e7071f7aee19aec1b4a0992.png";
const WA_LOGO = "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/628deb648_images2.png";

export function VexLogo({ className = "h-10 sm:h-11" }) {
  return <img src={LOGO_URL} alt="Vex Store" className={`w-auto object-contain ${className}`} />;
}
export { WA_LOGO };

export default function Header() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="glass border-b border-border/60 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-6">

          {/* Logo de Vex Store, adaptado al look premium */}
          <Link to="/" className="flex items-center gap-2 flex-shrink-0 group">
            <VexLogo className="h-10 sm:h-11 group-hover:scale-105 transition-transform duration-300" />
          </Link>

          {/* Desktop Nav - Matching visual complexity of screenshot */}
          <nav className="hidden sm:flex items-center gap-2 lg:gap-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/50 transition-all duration-200">
              Inicio
            </Link>
            <div className="relative group cursor-pointer">
              <Link to="/Games" className="text-muted-foreground hover:text-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/50 transition-all duration-200 flex items-center gap-1">
                Juegos Móviles <ChevronDown className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
              </Link>
            </div>
            <Link to="/GiftCards" className="text-muted-foreground hover:text-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/50 transition-all duration-200">
              Gift Cards
            </Link>
            <Link to="/creadores" className="text-muted-foreground hover:text-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/50 transition-all duration-200 flex items-center gap-1.5">
              Creadores <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            </Link>
            <Link to="/canjear" className="text-muted-foreground hover:text-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/50 transition-all duration-200 flex items-center gap-1.5">
              Canjear <Gift className="w-3.5 h-3.5 text-primary" />
            </Link>
            {isAdmin && (
              <Link to="/freefire" className="text-primary hover:text-primary/80 text-sm font-medium px-3 py-2 rounded-md hover:bg-primary/10 transition-all duration-200">
                Recargas FF
              </Link>
            )}
            <Link to="/Servicios" className="text-muted-foreground hover:text-foreground text-sm font-medium px-3 py-2 rounded-md hover:bg-muted/50 transition-all duration-200">
              Servicios
            </Link>
            <PendingPaymentsNav variant="desktop" />
          </nav>

          {/* Centered Search Bar (Desktop) - Opens search modal */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden sm:flex flex-1 max-w-md items-center gap-2 bg-card/50 border border-border/20 text-muted-foreground rounded-full pl-4 pr-4 py-2 text-sm hover:border-primary/50 transition-all duration-300"
          >
            <Search className="w-4 h-4" />
            <span>Buscar en Vex Store...</span>
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            {/* Install PWA (mobile) */}
            <InstallAppButton variant="icon" className="sm:hidden p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all duration-200" />

            {/* Mobile Search Toggle - Opens search modal */}
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 sm:hidden text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-all duration-200"
              aria-label="Buscar"
            >
              <Search className="w-5 h-5" />
            </button>

            {/* Install PWA */}
            <InstallAppButton variant="full" className="hidden sm:flex items-center gap-1.5 border border-border/20 hover:border-primary/50 bg-card/30 rounded-full px-3 py-1.5" />

            {/* Currency selector - Styled to match screenshot */}
            <button className="hidden sm:flex items-center gap-2 border border-border/20 hover:border-border/50 bg-card/30 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all duration-200">
              <Globe className="w-3.5 h-3.5 text-primary" />
              <span>BSD</span>
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>

            {isAdmin && (
              <Link to="/admin" className="hidden sm:flex items-center gap-1.5 border border-border/20 hover:border-primary/50 bg-card/30 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-all duration-200">
                <Shield className="w-3.5 h-3.5" /> Admin
              </Link>
            )}
            {user ? (
              <Link to="/perfil" className="hidden sm:flex items-center gap-1.5 border border-border/20 hover:border-primary/50 bg-card/30 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-all duration-200">
                <UserIcon className="w-3.5 h-3.5" /> Mi Perfil
              </Link>
            ) : (
              <Link to="/Login" className="relative hidden sm:inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider overflow-hidden shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all duration-300 hover:-translate-y-0.5 group">
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite]" />
                INICIAR SESIÓN
              </Link>
            )}

            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild className="sm:hidden">
                <button className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full transition-all duration-200">
                  <Menu className="w-6 h-6" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="bg-background border-l border-border/10 w-80 p-6 overflow-y-auto">
                <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
                <div className="flex items-center gap-2 mb-8">
                  <VexLogo className="h-9" />
                </div>
                
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => { setSearchOpen(true); closeMobile(); }}
                    className="w-full flex items-center gap-2 bg-card border border-border/20 text-muted-foreground rounded-lg pl-3 pr-4 py-2.5 text-sm hover:border-primary transition-colors mb-4"
                  >
                    <Search className="w-4 h-4" />
                    Buscar productos...
                  </button>

                  <Link to="/" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    Inicio <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  <Link to="/Games" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    Juegos Móviles <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  <Link to="/GiftCards" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    Gift Cards <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  <Link to="/creadores" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    <span className="flex items-center gap-2">Creadores <Sparkles className="w-4 h-4 text-pink-400" /></span> <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  <Link to="/canjear" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    <span className="flex items-center gap-2">Canjear <Gift className="w-4 h-4 text-primary" /></span> <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  {isAdmin && (
                    <Link to="/freefire" onClick={closeMobile} className="text-primary hover:text-primary/80 text-base font-medium px-4 py-3 rounded-lg hover:bg-primary/10 border border-transparent transition-all duration-200 flex items-center justify-between">
                      Recargas FF <ChevronRight className="w-4 h-4 opacity-50" />
                    </Link>
                  )}
                  <Link to="/Servicios" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    Servicios <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  <Link to="/mis-pedidos" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                    <span className="flex items-center gap-2">Mis Pedidos <Package className="w-4 h-4 opacity-50" /></span> <ChevronRight className="w-4 h-4 opacity-50" />
                  </Link>
                  <PendingPaymentsNav onNavigate={closeMobile} />
                  {user && (
                    <Link to="/perfil" onClick={closeMobile} className="text-foreground/80 hover:text-primary text-base font-medium px-4 py-3 rounded-lg hover:bg-card border border-transparent hover:border-border/20 transition-all duration-200 flex items-center justify-between">
                      <span className="flex items-center gap-2">Mi Perfil <UserIcon className="w-4 h-4 opacity-50" /></span> <ChevronRight className="w-4 h-4 opacity-50" />
                    </Link>
                  )}
                  
                  <div className="mt-8 pt-8 border-t border-border/10">
                    <InstallAppButton variant="full" className="w-full justify-center bg-card border border-border/20 hover:border-primary/50 rounded-xl py-3 mb-4" />
                    {user ? (
                      <Link to="/perfil" onClick={closeMobile} className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl text-sm font-bold uppercase tracking-wider shadow-lg shadow-primary/20 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2">
                        <UserIcon className="w-4 h-4" /> MI PERFIL
                      </Link>
                    ) : (
                      <Link to="/Login" onClick={closeMobile} className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl text-sm font-bold uppercase tracking-wider shadow-lg shadow-primary/20 active:scale-95 transition-all duration-300 flex items-center justify-center">
                        INICIAR SESIÓN
                      </Link>
                    )}
                    
                    <div className="mt-6 grid grid-cols-2 gap-3">
                      {["BSD", "USD", "COP", "CLP"].map(c => (
                        <button key={c} onClick={closeMobile} className="flex items-center justify-center gap-2 bg-card border border-border/20 hover:border-primary/50 rounded-lg py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all duration-200">
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}