// Skeleton animado para tarjetas de producto mientras cargan las imágenes.
// Da una sensación premium en lugar de que las imágenes aparezcan de golpe.
export default function ProductCardSkeleton({ width = "w-[150px] sm:w-[180px]" }) {
  return (
    <div className={`flex-shrink-0 ${width}`}>
      <div className="bg-card rounded-xl overflow-hidden border border-border/20">
        <div className="aspect-square bg-muted/40 animate-pulse" />
        <div className="p-3 border-t border-border/10">
          <div className="h-3.5 bg-muted/50 rounded animate-pulse mx-auto w-3/4" />
        </div>
      </div>
    </div>
  );
}