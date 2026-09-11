import Database from "better-sqlite3";
import type { VeniumProduct } from "../venium/venium.client.js";

export function syncCatalog(db: Database.Database, catalog: VeniumProduct[]): void {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const product of catalog) {
      const productRow = db.prepare(`
        INSERT INTO products (venium_product_id, name, category, active, last_synced_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(venium_product_id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          active = 1,
          last_synced_at = excluded.last_synced_at
      `).run(
        String(product.productId ?? ""),
        String(product.name ?? product.productId ?? "producto"),
        String(product.category ?? ""),
        now,
      );

      const productId = Number(
        db.prepare("SELECT id FROM products WHERE venium_product_id = ?").pluck().get(product.productId),
      );

      for (const field of product.playerFields ?? []) {
        const label = String(field.label ?? "campo");
        const key = String(field.key ?? label.toLowerCase().replaceAll(" ", ""));
        db.prepare(`
          INSERT INTO player_fields (product_id, field_key, label, field_type, required)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(product_id, field_key) DO UPDATE SET
            label = excluded.label,
            field_type = excluded.field_type,
            required = excluded.required
        `).run(productId, key, label, String(field.type ?? "text"), field.required ? 1 : 0);
      }

      for (const item of product.packages ?? []) {
        db.prepare(`
          INSERT INTO packages (
            product_id, venium_package_id, name, cost_usd, out_of_stock, last_synced_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(venium_package_id) DO UPDATE SET
            product_id = excluded.product_id,
            name = excluded.name,
            cost_usd = excluded.cost_usd,
            out_of_stock = excluded.out_of_stock,
            last_synced_at = excluded.last_synced_at
        `).run(
          productId,
          String(item.packageId ?? ""),
          String(item.name ?? item.packageId ?? "paquete"),
          String(item.price ?? 0),
          item.outOfStock ? 1 : 0,
          now,
        );
      }
    }
  });
  transaction();
}

export function listCatalog(db: Database.Database): unknown[] {
  const products = db.prepare(`
    SELECT id, venium_product_id AS productId, name, category, active, last_synced_at AS lastSyncedAt
    FROM products WHERE active = 1 ORDER BY category, name
  `).all() as Array<Record<string, unknown>>;

  return products.map((product) => ({
    ...product,
    packages: db.prepare(`
      SELECT venium_package_id AS packageId, name, cost_usd AS costUsd,
             out_of_stock AS outOfStock
      FROM packages WHERE product_id = ? ORDER BY name
    `).all(product.id).map((item: any) => ({ ...item, outOfStock: Boolean(item.outOfStock) })),
    playerFields: db.prepare(`
      SELECT field_key AS key, label, field_type AS type, required
      FROM player_fields WHERE product_id = ? ORDER BY id
    `).all(product.id).map((item: any) => ({ ...item, required: Boolean(item.required) })),
  }));
}

export function findPackage(db: Database.Database, packageId: string): any {
  return db.prepare(`
    SELECT
      p.id AS packageLocalId,
      p.venium_package_id AS packageId,
      p.name AS packageName,
      p.cost_usd AS costUsd,
      p.out_of_stock AS outOfStock,
      pr.id AS productLocalId,
      pr.venium_product_id AS productId,
      pr.name AS productName
    FROM packages p
    JOIN products pr ON pr.id = p.product_id
    WHERE p.venium_package_id = ?
  `).get(packageId);
}