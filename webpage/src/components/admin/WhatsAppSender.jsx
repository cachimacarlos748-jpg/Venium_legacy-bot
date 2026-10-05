import { useState } from "react";
import { X, Send, Loader2, CheckCircle2 } from "lucide-react";
import { sendWhatsAppMessage, paymentVerifiedMessage, completionMessage } from "@/lib/whatsappClient";
import { Button } from "@/components/ui/button";

const TEMPLATE_TEXTS = {
  verified: "*✅ PAGO VERIFICADO*\n\nTu pago ha sido confirmado correctamente.\n\n⏳ *Tu recarga está en proceso*\nTiempo estimado: 1-2 horas\n\nTe avisaremos cuando esté lista. ¡Gracias por tu compra en Vex Store! 🎮",
  completed: "*🎉 ¡RECARGA COMPLETADA!*\n\nTu recarga ha sido aplicada a tu cuenta de juego.\n\n✅ *¡Todo listo!* Disfruta tu recarga.\n\n¡Gracias por confiar en Vex Store! 🎮",
  custom: "",
};

const TEMPLATES = [
  { key: "verified", label: "✅ Pago verificado" },
  { key: "completed", label: "🎉 Recarga completada" },
  { key: "custom", label: "✏️ Personalizado" },
];

// Modal para enviar mensajes personalizados de WhatsApp desde el panel admin.
// Si recibe `order`, pre-llena el número y usa las plantillas con datos del pedido.
// Si no (envío personalizado), el admin ingresa el número manualmente.
export default function WhatsAppSender({ order, onClose }) {
  const [number, setNumber] = useState(order?.customer_whatsapp || "");
  const [template, setTemplate] = useState(order ? "completed" : "custom");
  const [message, setMessage] = useState(() => order ? completionMessage(order) : "");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  const applyTemplate = (t) => {
    setTemplate(t);
    if (t === "verified") setMessage(order ? paymentVerifiedMessage(order, "") : TEMPLATE_TEXTS.verified);
    else if (t === "completed") setMessage(order ? completionMessage(order) : TEMPLATE_TEXTS.completed);
    else setMessage(TEMPLATE_TEXTS.custom);
  };

  const send = async () => {
    const num = number.replace(/\D/g, "");
    if (!num || !message.trim()) return;
    setStatus("sending");
    const res = await sendWhatsAppMessage(num, message);
    if (res.ok) setStatus("sent");
    else if (res.skipped) {
      // API no configurada → abre wa.me como respaldo.
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(message)}`, "_blank");
      setStatus("sent");
    } else setStatus("error");
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-card border border-border/30 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border/20 sticky top-0 bg-card z-10">
          <h3 className="text-sm font-bold text-foreground">Enviar WhatsApp</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Número de WhatsApp</label>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Ej: 584121234567 (con código de país)"
              className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
            />
            {order && !order.customer_whatsapp && (
              <p className="text-xs text-amber-400 mt-1">Pedido viejo sin número — ingrésalo manualmente.</p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Plantilla</label>
            <div className="flex gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => applyTemplate(t.key)}
                  className={`flex-1 text-xs font-medium px-2 py-1.5 rounded-lg border transition-colors ${template === t.key ? "bg-primary/20 border-primary text-primary" : "bg-muted border-border/30 text-muted-foreground hover:border-border/50"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Mensaje</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={10}
              className="w-full bg-muted border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>
          {status === "sent" && (
            <p className="text-xs text-green-500 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Mensaje enviado correctamente</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive">Error al enviar. Revisa las credenciales de UltraMsg en Config.</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">Cerrar</Button>
            <Button onClick={send} disabled={status === "sending" || !number.replace(/\D/g, "") || !message.trim()} className="flex-1">
              {status === "sending" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</> : <><Send className="w-4 h-4 mr-2" /> Enviar</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}