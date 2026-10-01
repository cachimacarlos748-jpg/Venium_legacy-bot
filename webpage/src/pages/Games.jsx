import CatalogGrid from "@/components/CatalogGrid";

export default function Games() {
  return (
    <CatalogGrid
      entityName="Game"
      title="Juegos Móviles"
      subtitle="Recargas instantáneas para tus juegos favoritos"
      withCategories
    />
  );
}