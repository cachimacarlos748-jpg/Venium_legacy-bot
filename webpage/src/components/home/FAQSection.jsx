import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "¿Cuánto tarda en llegar mi recarga?",
    a: "Las recargas automáticas (Free Fire, Mobile Legends, etc.) llegan en segundos tras verificar tu pago. Los productos manuales (gift cards, servicios) pueden tardar de 1 a 2 horas. Si pasan más de 2 horas sin recibir tu pedido, escríbenos por WhatsApp.",
  },
  {
    q: "¿Qué métodos de pago aceptan?",
    a: "Aceptamos Pago Móvil venezolano (todos los bancos), transferencias bancarias, Zinli, Binance (USDT) y PayPal. Los métodos disponibles se muestran al momento de comprar, junto con los datos exactos para transferir.",
  },
  {
    q: "¿Qué pasa si mi pago falla o se retrasa?",
    a: "Si tu transferencia tuvo un problema, no te preocupes: tu dinero está seguro. Reporta el pago con el número de referencia y si algo falla te contactamos por WhatsApp para resolverlo. Nunca pedimos pagos adelantados fuera de la plataforma.",
  },
  {
    q: "¿Necesito verificar mi ID de jugador?",
    a: "Para la mayoría de los juegos sí. Ingresa tu ID de jugador y zona (si aplica) en el formulario de compra y presiona 'Verificar ID'. Esto asegura que la recarga llegue a la cuenta correcta. Si el ID no verifica, revisa que esté bien escrito.",
  },
  {
    q: "¿Puedo pagar en dos partes (pago parcial)?",
    a: "Sí. Si pagas menos del total, tu pedido queda registrado como 'pago parcial' y el saldo queda guardado. Puedes completar el pago restante después desde el enlace que te enviamos, sin volver a llenar todos los datos.",
  },
  {
    q: "¿Tienen garantía si la recarga no llega?",
    a: "Sí. Todos los pedidos tienen garantía total. Si por alguna razón la recarga no se puede completar, te reembolsamos el 100% o te la reenviamos a otra cuenta. Tu compra está protegida.",
  },
];

function FAQItem({ item, isOpen, onToggle }) {
  return (
    <div className="border border-border/20 rounded-xl overflow-hidden bg-card">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 p-4 sm:p-5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-sm sm:text-base font-bold text-foreground">{item.q}</span>
        <ChevronDown className={`w-5 h-5 text-primary shrink-0 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <p className="px-4 sm:px-5 pb-4 sm:pb-5 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQSection() {
  const [open, setOpen] = useState(0);
  return (
    <section className="bg-background py-12 sm:py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <span className="w-1.5 h-6 rounded-full bg-primary glow-primary" />
            <h2 className="text-lg sm:text-xl font-black text-foreground tracking-tight uppercase">
              Preguntas Frecuentes
            </h2>
          </div>
          <p className="text-muted-foreground text-sm">Resolvemos las dudas más comunes antes de que tengas que preguntar.</p>
        </div>
        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <FAQItem key={i} item={item} isOpen={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}