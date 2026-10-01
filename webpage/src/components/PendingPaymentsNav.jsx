import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";
import { getPendingOrders } from "@/lib/pendingPayments";

// Entrada de menú que aparece SOLO cuando hay pagos parciales pendientes
// (cacheados en localStorage). Lleva directo a la página de completar el
// pago más reciente, para que el cliente no pierda el acceso aunque haya
// refrescado o cerrado el navegador.
export default function PendingPaymentsNav({ onNavigate, variant = "mobile" }) {
  const [pending, setPending] = useState(getPendingOrders());

  useEffect(() => {
    const update = () => setPending(getPendingOrders());
    window.addEventListener("storage", update);
    window.addEventListener("legacy-pending-updated", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("legacy-pending-updated", update);
    };
  }, []);

  if (!pending.length) return null;
  const latest = pending[0];
  const count = pending.length;
  const to = `/completar-pago/${latest.id}`;

  if (variant === "desktop") {
    return (
      <Link
        to={to}
        className="relative hidden sm:flex items-center gap-1.5 border border-amber-500/40 hover:border-amber-500 bg-amber-500/10 rounded-full px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-all duration-200"
      >
        <Wallet className="w-3.5 h-3.5" /> Pago pendiente
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-[10px] font-black text-white flex items-center justify-center">{count}</span>
      </Link>
    );
  }

  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="text-amber-300 hover:text-amber-200 text-base font-medium px-4 py-3 rounded-lg hover:bg-amber-500/10 border border-transparent hover:border-amber-500/30 transition-all duration-200 flex items-center justify-between"
    >
      <span className="flex items-center gap-2"><Wallet className="w-4 h-4" /> Pago pendiente ({count})</span>
      <span className="text-xs font-bold text-amber-400">Completar</span>
    </Link>
  );
}