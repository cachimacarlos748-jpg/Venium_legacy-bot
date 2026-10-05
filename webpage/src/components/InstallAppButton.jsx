import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, X, Smartphone } from "lucide-react";

// Botón de instalación PWA siempre visible.
// Si el navegador ofrece beforeinstallprompt → instala nativamente.
// Si no (iOS, preview, etc.) → abre un modal con instrucciones para todos los navegadores.
export default function InstallAppButton({ variant = "full", className = "" }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    setInstalled(standalone);
    setIsIos(/iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()));

    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    } else {
      setShowHelp(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors ${className}`}
        aria-label="Instalar app"
      >
        <Download className="w-4 h-4 shrink-0" />
        {variant === "full" && <span className="text-sm font-medium truncate">Instalar app</span>}
      </button>

      {showHelp && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
          <div className="max-w-sm w-full bg-card border border-border/30 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary" /> Instalar Vex Store
              </h3>
              <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {isIos ? (
              <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside">
                <li>Abre esta página en <span className="font-bold text-foreground">Safari</span>.</li>
                <li>Toca el botón <span className="font-bold text-foreground">Compartir</span> (cuadrado con flecha arriba).</li>
                <li>Selecciona <span className="font-bold text-foreground">"Agregar a pantalla de inicio"</span>.</li>
                <li>Toca <span className="font-bold text-foreground">"Agregar"</span> y listo 🎉</li>
              </ol>
            ) : (
              <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside">
                <li>Toca el menú del navegador <span className="font-bold text-foreground">⋮</span> (arriba a la derecha).</li>
                <li>Selecciona <span className="font-bold text-foreground">"Instalar aplicación"</span> o <span className="font-bold text-foreground">"Agregar a pantalla de inicio"</span>.</li>
                <li>Confirma y la app quedará en tu teléfono 🎉</li>
              </ol>
            )}
            <p className="text-xs text-muted-foreground/60 mt-4 pt-3 border-t border-border/20">La app funciona sin internet para ver el catálogo y recibe notificaciones de tus pedidos.</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}