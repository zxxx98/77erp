import { validateImageUrl, validateProductImage } from './imagebed.js';
import { inspectionConfig } from '../shared/inspection.js';

export function productDetails(body, existing = {}) {
  const values = {};
  for (const [key, max] of [['specification', 500], ['note', 2000]]) {
    const value = body[key] === undefined ? (existing[key] ?? '') : body[key];
    if (typeof value !== 'string' || value.length > max)
      throw new Error(`${key === 'note' ? '备注' : '规格型号'}最多 ${max} 字。`);
    values[key] = value.trim();
  }
  const image = body.image === undefined ? (existing.image ?? '') : body.image;
  validateImageUrl(image);
  return { ...values, image, is_fixed_asset: fixedAssetValue(body, existing), ...inspectionConfig(body, existing) };
}

// Accept booleans, 0/1 and their string forms; undefined keeps the stored value.
export function fixedAssetValue(body, existing = {}) {
  const value = body.is_fixed_asset === undefined ? (existing.is_fixed_asset ?? 0) : body.is_fixed_asset;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw new Error('固定资产标记无效。');
}

export function categoryPaths(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const paths = new Map();
  const siblings = new Set();
  for (const c of categories) {
    if (!Number.isSafeInteger(c.id) || c.id < 1 || typeof c.name !== 'string' || !c.name.trim() || c.name !== c.name.trim() || c.name.length > 100 ||
        !(c.parent_id === null || byId.has(c.parent_id))) throw new Error('分类名称或上级分类无效。');
    if (c.parent_id !== null && byId.get(c.parent_id).warehouse_id !== c.warehouse_id)
      throw new Error('上级分类必须属于同一仓库。');
    const key = JSON.stringify([c.warehouse_id, c.parent_id, c.name]);
    if (siblings.has(key)) throw new Error('同级分类名称不能重复。');
    siblings.add(key);
    const chain = [], seen = new Set();
    let node = c;
    while (node) {
      if (seen.has(node.id)) throw new Error('分类不能移到自身或下级分类中。');
      seen.add(node.id);
      chain.unshift(node.name);
      if (chain.length > 10) throw new Error('分类最多支持 10 层。');
      node = byId.get(node.parent_id);
    }
    paths.set(c.id, chain.join(' / '));
  }
  return paths;
}

export function migrateCatalog(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES categories(id));
    CREATE UNIQUE INDEX IF NOT EXISTS categories_sibling_name ON categories(COALESCE(parent_id,0),name);`);
  const columns = new Set(db.prepare('PRAGMA table_info(products)').all().map(c => c.name));
  for (const [key, definition] of Object.entries({active: 'INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))', category_id: 'INTEGER REFERENCES categories(id)', image: "TEXT NOT NULL DEFAULT ''", specification: "TEXT NOT NULL DEFAULT ''", note: "TEXT NOT NULL DEFAULT ''", is_fixed_asset: 'INTEGER NOT NULL DEFAULT 0 CHECK(is_fixed_asset IN (0,1))', inspection_date: "TEXT NOT NULL DEFAULT ''", inspection_interval: 'INTEGER NOT NULL DEFAULT 0', inspection_unit: "TEXT NOT NULL DEFAULT 'month'", last_inspected_on: "TEXT NOT NULL DEFAULT ''"}))
    if (!columns.has(key)) db.exec(`ALTER TABLE products ADD COLUMN ${key} ${definition}`);
  const scoped = db.prepare('PRAGMA table_info(categories)').all().some(c => c.name === 'warehouse_id');
  for (const p of db.prepare(`SELECT id,category${scoped ? ',warehouse_id' : ''} FROM products WHERE category_id IS NULL`).all()) {
    let c = scoped
      ? db.prepare('SELECT id FROM categories WHERE warehouse_id=? AND parent_id IS NULL AND name=?').get(p.warehouse_id, p.category)
      : db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name=?').get(p.category);
    if (!c) c = {id: Number(scoped
      ? db.prepare('INSERT INTO categories(name,parent_id,warehouse_id) VALUES (?,NULL,?)').run(p.category, p.warehouse_id).lastInsertRowid
      : db.prepare('INSERT INTO categories(name,parent_id) VALUES (?,NULL)').run(p.category).lastInsertRowid)};
    db.prepare('UPDATE products SET category_id=? WHERE id=?').run(c.id, p.id);
  }
}

// Preserve the main warehouse's IDs; every other existing warehouse gets its own
// complete copy, including unused categories. Also used when restoring old backups.
export function splitLegacyCategories(categories, warehouses, products) {
  categoryPaths(categories);
  let nextId = categories.reduce((max, c) => Math.max(max, c.id), 0) + 1;
  const copies = [], mappings = new Map();
  for (const warehouse of [...warehouses].sort((a, b) => a.id - b.id)) {
    const ids = new Map(categories.map(c => [c.id, warehouse.id === 1 ? c.id : nextId++]));
    mappings.set(warehouse.id, ids);
    for (const c of categories) copies.push({ ...c, id: ids.get(c.id), parent_id: c.parent_id === null ? null : ids.get(c.parent_id), warehouse_id: warehouse.id });
  }
  const remapped = products.map(p => {
    const id = mappings.get(p.warehouse_id)?.get(p.category_id);
    if (!id) throw new Error('物料分类或仓库关联无效。');
    return { ...p, category_id: id };
  });
  return { categories: copies, products: remapped };
}

export function migrateWarehouseCategories(db) {
  if (db.prepare('PRAGMA table_info(categories)').all().some(c => c.name === 'warehouse_id')) return;
  // SQLite requires foreign keys to be off while adding a referenced column with
  // a non-null default to a populated table. Verify all references before commit.
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    const data = splitLegacyCategories(db.prepare('SELECT * FROM categories ORDER BY id').all(),
      db.prepare('SELECT id FROM warehouses ORDER BY id').all(),
      db.prepare('SELECT id,category_id,warehouse_id FROM products').all());
    db.exec(`ALTER TABLE categories ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id);
      DROP INDEX categories_sibling_name;
      CREATE UNIQUE INDEX categories_sibling_name ON categories(warehouse_id,COALESCE(parent_id,0),name);
      PRAGMA defer_foreign_keys=ON;`);
    const insert = db.prepare('INSERT INTO categories(id,name,parent_id,warehouse_id) VALUES (?,?,?,?)');
    for (const c of data.categories) if (c.warehouse_id !== 1) insert.run(c.id, c.name, c.parent_id, c.warehouse_id);
    const update = db.prepare('UPDATE products SET category_id=? WHERE id=? AND category_id!=?');
    for (const p of data.products) update.run(p.category_id, p.id, p.category_id);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('分类迁移后的数据关联无效。');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

// Explicit product synchronization copies the source path by name into the target
// tree, reusing matching branches without changing unrelated target categories.
export function copyCategoryToWarehouse(db, categoryId, warehouseId) {
  const chain = [];
  let category = db.prepare('SELECT * FROM categories WHERE id=?').get(categoryId);
  if (!category) throw new Error('物料分类不存在。');
  const sourceWarehouse = category.warehouse_id;
  const seen = new Set();
  while (category) {
    if (category.warehouse_id !== sourceWarehouse || seen.has(category.id)) throw new Error('物料分类树无效。');
    seen.add(category.id);
    chain.unshift(category.name);
    if (category.parent_id === null) break;
    category = db.prepare('SELECT * FROM categories WHERE id=?').get(category.parent_id);
    if (!category) throw new Error('上级分类不存在。');
  }
  let parent = null;
  for (const name of chain) {
    let target = db.prepare('SELECT id FROM categories WHERE warehouse_id=? AND parent_id IS ? AND name=?').get(warehouseId, parent, name);
    if (!target) target = { id: Number(db.prepare('INSERT INTO categories(name,parent_id,warehouse_id) VALUES (?,?,?)').run(name, parent, warehouseId).lastInsertRowid) };
    parent = target.id;
  }
  return parent;
}

export function installCatalog(app, db) {
  const categories = warehouseId => db.prepare('SELECT * FROM categories WHERE warehouse_id=? ORDER BY name,id').all(warehouseId);
  const paths = warehouseId => categoryPaths(categories(warehouseId));
  // Legacy clients and CSV imports may still send a flat category name.
  function resolveCategory(body, warehouseId) {
    if (body.category_id !== undefined && body.category_id !== null && body.category_id !== '') {
      if (!Number.isSafeInteger(body.category_id) || !paths(warehouseId).has(body.category_id)) throw new Error('请选择当前仓库的有效物料分类。');
      return body.category_id;
    }
    const name = body.category.trim();
    const matches = [...paths(warehouseId)].filter(([, path]) => path === name);
    if (matches.length === 1) return matches[0][0];
    let c = db.prepare('SELECT id FROM categories WHERE warehouse_id=? AND parent_id IS NULL AND name=?').get(warehouseId, name);
    if (!c) {
      if (name.length > 100) throw new Error('分类名称最多 100 字，请选择已有分类。');
      c = { id: Number(db.prepare('INSERT INTO categories(name,parent_id,warehouse_id) VALUES (?,NULL,?)').run(name, warehouseId).lastInsertRowid) };
    }
    return c.id;
  }
  function catalogValues(body, existing, warehouseId = existing?.warehouse_id ?? 1) {
    const { image, specification, note, is_fixed_asset, inspection_date, inspection_interval, inspection_unit } = productDetails(body, existing);
    validateProductImage(db, image, existing?.image);
    const id = resolveCategory(body, warehouseId);
    return { path: paths(warehouseId).get(id), values: [id, image, specification, note, is_fixed_asset, inspection_date, inspection_interval, inspection_unit] };
  }
  const mutate = fn => (req, res) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = fn(req);
      const allPaths = paths(req.warehouse.id);
      const update = db.prepare('UPDATE products SET category=? WHERE category_id=? AND warehouse_id=?');
      for (const [id, path] of allPaths) update.run(path, id, req.warehouse.id);
      db.exec('COMMIT');
      res.json(result);
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      res.status(400).json({ error: e.message.includes('UNIQUE') ? '同级分类名称不能重复。' : e.message });
    }
  };
  app.get('/api/categories', (req, res) => res.json(categories(req.warehouse.id)));
  const save = (req, id) => {
    const { name, parent_id = null } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请填写 1–100 字的分类名称。');
    const rows = categories(req.warehouse.id);
    if (parent_id !== null && (!Number.isSafeInteger(parent_id) || !rows.some(c => c.id === parent_id))) throw new Error('上级分类不存在或不属于当前仓库。');
    if (id) {
      if (!rows.some(c => c.id === id)) throw new Error('分类不存在或不属于当前仓库。');
      db.prepare('UPDATE categories SET name=?,parent_id=? WHERE id=? AND warehouse_id=?').run(name.trim(), parent_id, id, req.warehouse.id);
      return { id };
    }
    return { id: Number(db.prepare('INSERT INTO categories(name,parent_id,warehouse_id) VALUES (?,?,?)').run(name.trim(), parent_id, req.warehouse.id).lastInsertRowid) };
  };
  app.post('/api/categories', mutate(req => save(req)));
  app.put('/api/categories/:id', mutate(req => save(req, Number(req.params.id))));
  app.post('/api/categories/:id/delete', mutate(req => {
    const id = Number(req.params.id);
    if (!categories(req.warehouse.id).some(c => c.id === id)) throw new Error('分类不存在或不属于当前仓库。');
    if (db.prepare('SELECT 1 FROM categories WHERE parent_id=?').get(id) || db.prepare('SELECT 1 FROM products WHERE category_id=?').get(id))
      throw new Error('请先移走下级分类和物料，再删除分类。');
    if (!db.prepare('DELETE FROM categories WHERE id=? AND warehouse_id=?').run(id, req.warehouse.id).changes) throw new Error('分类不存在。');
    return { ok: true };
  }));
  return { catalogValues };
}
