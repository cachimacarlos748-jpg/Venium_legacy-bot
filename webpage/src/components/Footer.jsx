import { Link } from "react-router-dom";
import { Instagram, Facebook, ExternalLink } from "lucide-react";
import SupportWhatsapp from "@/components/SupportWhatsapp";

const LOGO_URL = "https://media.base44.com/images/public/6a5b9606e1931edeb474236e/ce368c5aa_file_000000005e7071f7aee19aec1b4a0992.png";

export default function Footer() {
  return (
    <footer className="bg-card border-t border-border/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">

          {/* Links */}
          <div>
            <p className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-4">Información</p>
            <nav className="flex flex-col gap-2">
              <a href="#" className="text-muted-foreground hover:text-primary text-sm transition-colors duration-200">Sobre nosotros</a>
              <a href="#" className="text-muted-foreground hover:text-primary text-sm transition-colors duration-200">Términos</a>
              <a href="#" className="text-muted-foreground hover:text-primary text-sm transition-colors duration-200">Política de privacidad</a>
              <a href="#" className="text-muted-foreground hover:text-primary text-sm transition-colors duration-200">Reembolsos</a>
              <a href="#" className="text-muted-foreground hover:text-primary text-sm transition-colors duration-200">Preguntas frecuentes</a>
              <a href="#" className="text-muted-foreground hover:text-primary text-sm transition-colors duration-200">Atención al cliente</a>
            </nav>
          </div>

          {/* Logo center */}
          <div className="flex flex-col items-center justify-center">
            <Link to="/" className="flex flex-col items-center gap-3">
              <img src={LOGO_URL} alt="Legacy Store" className="h-14 w-auto object-contain" />
            </Link>
            <p className="text-muted-foreground text-xs text-center mt-3 max-w-48 leading-relaxed">
              Tu tienda de recargas de videojuegos en Venezuela y LATAM.
            </p>
          </div>

          {/* Social */}
          <div className="sm:text-right">
            <p className="text-muted-foreground text-xs font-bold tracking-widest uppercase mb-4">Síguenos</p>
            <div className="flex sm:justify-end gap-3">
              <a
                href="https://www.instagram.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 border border-border/30 hover:border-primary/50 hover:text-primary text-muted-foreground px-3 py-2 rounded-lg text-sm transition-all duration-200 hover:-translate-y-0.5"
              >
                <Instagram className="w-4 h-4" />
                <span>Instagram</span>
              </a>
              <a
                href="https://www.facebook.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 border border-border/30 hover:border-primary/50 hover:text-primary text-muted-foreground px-3 py-2 rounded-lg text-sm transition-all duration-200 hover:-translate-y-0.5"
              >
                <Facebook className="w-4 h-4" />
                <span>Facebook</span>
              </a>
            </div>
            <div className="mt-4 sm:text-right">
              <p className="text-muted-foreground text-xs">Disponible en</p>
              <div className="flex sm:justify-end gap-1 mt-1">
                {["VE", "CO", "CL", "US"].map(c => (
                  <span key={c} className="text-[10px] border border-border/30 text-muted-foreground px-1.5 py-0.5 rounded">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/20 pt-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              <span className="text-primary font-semibold">© 2026 Legacy Store</span>. Todos los derechos reservados.
            </p>
            <div className="flex items-center gap-4">
              <Link to="/Games" className="text-muted-foreground hover:text-primary text-xs transition-colors duration-200">Juegos</Link>
              <Link to="/GiftCards" className="text-muted-foreground hover:text-primary text-xs transition-colors duration-200">Gift Cards</Link>
              <SupportWhatsapp />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}