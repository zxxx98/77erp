export function migrateProductChanges(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS product_changes (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    before_cost REAL NOT NULL, after_cost REAL NOT NULL,
    before_price REAL NOT NULL, after_price REAL NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS product_changes_product_time ON product_changes(product_id,created_at DESC,id DESC);`);
}

// Caller holds the product save transaction, including all synchronized copies.
export function recordProductChange(db, before, after, user) {
  if (before.cost === after.cost && before.price === after.price) return;
  db.prepare(`INSERT INTO product_changes
    (product_id,before_cost,after_cost,before_price,after_price,created_by,created_by_name,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(before.id, before.cost, after.cost, before.price, after.price, user.id, user.username, new Date().toISOString());
}
