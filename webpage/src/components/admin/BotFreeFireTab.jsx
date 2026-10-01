import FreeFirePanel from "@/pages/FreeFirePanel";

// Wrapper que renderiza el panel del bot embebido (sin su propio header) dentro del Admin.
// onOnlineChange: sube el estado de conectividad (true/false) al Admin para el punto en el sidebar.
export default function BotFreeFireTab({ onOnlineChange }) {
  return <FreeFirePanel embedded onOnlineChange={onOnlineChange} />;
}