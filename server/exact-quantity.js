import { quantityFields, exactNumber, exactQuantity, validExactQuantity } from '../shared/exact-quantity.js';
import { validStoredQuantity } from '../shared/quantity.js';

const quantityColumns = new Set(['quantity', 'completed_quantity', 'actual_quantity', 'expected_quantity', 'stock', 'basis_quantity']);

export function migrateExactQuantities(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'production_%' OR name='products')").all();
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all();
    for (const { name: column } of columns) if (quantityColumns.has(column) && !columns.some(item => item.name === `${column}_fraction`))
      db.exec(`ALTER TABLE ${name} ADD COLUMN ${column}_fraction TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS stock_fraction_reset AFTER UPDATE OF stock ON products
    WHEN NEW.stock != OLD.stock AND NEW.stock_fraction = OLD.stock_fraction
    BEGIN UPDATE products SET stock_fraction='' WHERE id=NEW.id; END;`);
}

export function saveExactQuantity(db, table, id, key, value) {
  if (!/^(production_[a-z_]+|products)$/.test(table) || !quantityColumns.has(key)) throw new Error('数量字段无效。');
  const fields = quantityFields(value, key);
  db.prepare(`UPDATE ${table} SET ${key}=?,${key}_fraction=? WHERE id=?`).run(fields[key], fields[`${key}_fraction`], id);
}

export function validateExactQuantityBackup(data) {
  for (const [table, rows] of Object.entries(data)) {
    if (table !== 'products' && !table.startsWith('production_')) continue;
    for (const row of rows) for (const key of quantityColumns) {
      const field = `${key}_fraction`;
      if (!(field in row) || key === 'quantity' && ['production_bom_nodes', 'production_scraps'].includes(table)) continue;
      const fraction = row[field];
      if (typeof fraction !== 'string' || fraction.length > 4096 || row[key] === null && fraction !== '' ||
          row[key] !== null && (!validExactQuantity(exactQuantity(row, key)) || (fraction ? !/^\d+(?:\.\d{1,4})?\/\d+$/.test(fraction) || exactNumber(fraction) !== row[key] : !validStoredQuantity(row[key]))))
        throw new Error('备份数量与精确分数不一致。');
    }
  }
}
