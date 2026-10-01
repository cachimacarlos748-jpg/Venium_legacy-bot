import { ExternalLink, Mail, Gift } from "lucide-react";
import { getRedemptionGuide } from "@/lib/redemptionGuide";

// Guía de canje que se muestra tras verificar el pago para productos que se
// entregan por correo (el cliente recibe un código y debe canjearlo en el
// sitio oficial del producto).
export default function RedemptionGuide({ slug }) {
  const guide = getRedemptionGuide(slug);
  if (!guide) return null;

  return (
    <div className="w-full rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Gift className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">
            Cómo canjear tu código de {guide.siteName}
          </p>
          <p className="text-[11px] text-muted-foreground">Guía paso a paso</p>
        </div>
      </div>

      <ol className="space-y-2 mb-3">
        {guide.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-xs text-foreground/90">
            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
              {i + 1}
            </span>
            <span className="leading-relaxed pt-0.5">{s}</span>
          </li>
        ))}
      </ol>

      <a
        href={guide.siteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
      >
        <ExternalLink className="w-3.5 h-3.5" /> {guide.siteUrl}
      </a>

      <p className="text-[11px] text-muted-foreground mt-3 flex items-start gap-1.5 bg-muted/50 rounded-lg p-2.5">
        <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>{guide.note}</span>
      </p>
    </div>
  );
}