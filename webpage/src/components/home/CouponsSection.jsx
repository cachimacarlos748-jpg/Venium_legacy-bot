import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Ticket, Copy, Check, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Lee los códigos de descuento activos (Setting keys "discount_*") y los
// muestra en la Home para incentivar la primera compra. El cliente puede
// copiar el código con un click.
export default function CouponsSection() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const all = await base44.entities.Setting.list("-updated_date", 200);
        if (!active) return;
        const found = (all || [])
          .filter((s) => s.key && s.key.startsWith("discount_"))
          .map((s) => {
            const code = s.key.replace("discount_", "");
            let cfg = {};
            try { cfg = JSON.parse(s.value); } catch {}
            return {
              code,
              kind: cfg.kind === "fixed" ? "fixed" : "percent",
              value: Number(cfg.value) || 0,
              label: cfg.label || "",
              creator_id: cfg.creator_id || null,
            };
          })
          .filter((c) => c.value > 0 && !c.creator_id);
        setCoupons(found);
      } catch {}
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const handleCopy = (code) => {
    try { navigator.clipboard.writeText(code); } catch {}
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading || coupons.length === 0) return null;

  return (
    <section className="bg-muted/20 py-8 border-y border-border/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 mb-5">
          <Ticket className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-black text-foreground tracking-wide uppercase">Cupones Activos</h2>
          <span className="text-xs text-muted-foreground ml-1 hidden sm:block">— Úsalos al finalizar tu compra</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {coupons.map((c, i) => (
            <motion.div
              key={c.code}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 80 }}
              className="relative bg-card border border-dashed border-primary/40 rounded-xl p-4 flex items-center gap-4 hover:border-primary transition-colors group overflow-hidden"
            >
              <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-20 h-20 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />
              <div className="shrink-0 w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground font-medium">
                  {c.kind === "percent" ? `${c.value}% de descuento` : `${c.value} ${c.currency || "Bs"} de descuento`}
                </p>
                <p className="text-lg font-black text-foreground tracking-wider truncate">{c.code}</p>
                {c.label && <p className="text-[11px] text-muted-foreground truncate">{c.label}</p>}
              </div>
              <button
                onClick={() => handleCopy(c.code)}
                className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground flex items-center justify-center transition-colors"
                aria-label="Copiar código"
              >
                {copied === c.code ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}