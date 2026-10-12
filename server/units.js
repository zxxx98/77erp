const defaults = ['个', '件', '台', '本', '条', '支', '箱', '包'];
const key = 'product_units';

export function migrateUnits(db) {
  if (db.prepare('SELECT 1 FROM app_metadata WHERE key=?').get(key)) return;
  const existing = db.prepare('SELECT DISTINCT unit FROM products ORDER BY id').all().map(p => p.unit.trim()).filter(Boolean);
  db.prepare('INSERT INTO app_metadata(key,value) VALUES (?,?)').run(key, JSON.stringify([...new Set([...defaults, ...existing])]));
}

export function getUnits(db) {
  return JSON.parse(db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key).value);
}

export function validateUnits(units) {
  if (!Array.isArray(units) || !units.length || units.length > 100 ||
      units.some(unit => typeof unit !== 'string' || !unit.trim() || unit.length > 100))
    throw new Error('请配置 1–100 个计量单位，每个单位为 1–100 字。');
  const normalized = units.map(unit => unit.trim());
  if (new Set(normalized).size !== normalized.length) throw new Error('计量单位名称不能重复。');
  return normalized;
}

export function saveUnits(db, units) {
  db.prepare('UPDATE app_metadata SET value=? WHERE key=?').run(JSON.stringify(units), key);
}
