// A persistent sequence also invalidates editors after deletion, reset or restore.
export function migrateProductVersions(db) {
  if (!db.prepare('PRAGMA table_info(products)').all().some(c => c.name === 'version'))
    db.exec('ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)');
  db.exec(`INSERT OR IGNORE INTO app_metadata(key,value) VALUES ('product_version','0');
    UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM products)) WHERE key='product_version';`);
  const fields = ['name','barcode','category','category_id','unit','cost','price','threshold','color','image','specification','note','customer_part_numbers','production_type','default_route_id','active','is_fixed_asset','unit_round_up','inspection_date','inspection_interval','inspection_unit','last_inspected_on'];
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='product_version';
    UPDATE products SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='product_version') WHERE id=NEW.id;`;
  db.exec(`DROP TRIGGER IF EXISTS product_version_update;
    CREATE TRIGGER IF NOT EXISTS product_version_insert AFTER INSERT ON products BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS product_version_update AFTER UPDATE OF ${fields.join(',')} ON products
    WHEN ${fields.map(f => `OLD.${f} IS NOT NEW.${f}`).join(' OR ')} BEGIN ${advance} END;`);
}
