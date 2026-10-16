import { validateStockExpression } from '../shared/stock-compare.js';

const key = 'stock_expression';

export function getStockExpression(db) {
  const row = db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key);
  if (!row) return null;
  try {
    return validateStockExpression(JSON.parse(row.value), db.prepare('SELECT id FROM warehouses').all().map(w => w.id));
  } catch {
    return null;
  }
}

export function saveStockExpression(db, expression) {
  const warehouseIds = db.prepare('SELECT id FROM warehouses').all().map(w => w.id);
  const normalized = validateStockExpression(expression, warehouseIds);
  db.prepare(`INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(key, JSON.stringify(normalized ?? null));
  return normalized;
}
