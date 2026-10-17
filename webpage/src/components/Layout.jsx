import { Outlet } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import { isAppMode } from "@/lib/isAppMode";

// La web queda exactamente igual. En modo app (APK) solo se añade espacio
// superior para respetar la barra de estado del sistema (edge-to-edge).
export default function Layout() {
  const appMode = isAppMode();
  return (
    <div className="bg-background text-foreground min-h-screen flex flex-col">
      <Header />
      <main className={`flex-1 ${appMode ? "pt-[env(safe-area-inset-top)]" : ""}`}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
