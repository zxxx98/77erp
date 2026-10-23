import { validateBom, bomRequiredQuantity, bomShortage } from '../shared/bom.js';
import { validQuantity } from '../shared/quantity.js';
import { operationRequest, saveOperationRequest } from './operations.js';

export const bomTables = ['boms', 'bom_items'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const pattern = value => `%${value.replace(/[\\%_]/g, c => `\\${c}`)}%`;
const publicProduct = product => Object.fromEntries(['id', 'name', 'barcode', 'specification', 'unit', 'active', 'stock'].map(key => [key, product[key]]));

function readSnapshot(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

export function migrateBom(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS boms (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL,
    base_quantity REAL NOT NULL CHECK(base_quantity>0), base_unit TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1, created_by_name TEXT NOT NULL, updated_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(warehouse_id,product_id));
    CREATE TABLE IF NOT EXISTS bom_items (
    id INTEGER PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES boms(id),
    product_id INTEGER NOT NULL REFERENCES products(id), quantity REAL NOT NULL CHECK(quantity>0),
    unit TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
    UNIQUE(bom_id,product_id));
    CREATE INDEX IF NOT EXISTS boms_warehouse ON boms(warehouse_id,updated_at);
    CREATE INDEX IF NOT EXISTS bom_items_product ON bom_items(product_id);
    INSERT OR IGNORE INTO app_metadata(key,value) VALUES ('bom_version','0');
    UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM boms)) WHERE key='bom_version';`);
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='bom_version';
    UPDATE boms SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='bom_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS bom_version_insert AFTER INSERT ON boms BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS bom_version_update AFTER UPDATE OF name,product_id,base_quantity,base_unit,note,enabled,updated_at,updated_by_name ON boms BEGIN ${advance} END;`);
}

export function clearBom(db, warehouseId) {
  if (warehouseId === undefined) db.exec('DELETE FROM bom_items; DELETE FROM boms;');
  else {
    db.prepare('DELETE FROM bom_items WHERE bom_id IN (SELECT id FROM boms WHERE warehouse_id=?)').run(warehouseId);
    db.prepare('DELETE FROM boms WHERE warehouse_id=?').run(warehouseId);
  }
}

export function listBoms(db, warehouseId, query = {}) {
  const { q = '', status = 'all', product_id, offset = '0', limit = '30' } = query;
  if (typeof q !== 'string' || q.length > 100 || !['all', 'enabled', 'disabled'].includes(status) ||
      typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
      typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
      (product_id !== undefined && (typeof product_id !== 'string' || !/^\d+$/.test(product_id) || !Number.isSafeInteger(Number(product_id)) || Number(product_id) < 1)))
    fail('用料清单筛选或分页参数无效。');
  const clauses = ['b.warehouse_id=?'], params = [warehouseId];
  if (q.trim()) { clauses.push("(b.name LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')"); params.push(...Array(3).fill(pattern(q.trim()))); }
  if (status !== 'all') { clauses.push('b.enabled=?'); params.push(status === 'enabled' ? 1 : 0); }
  if (product_id !== undefined) { clauses.push('b.product_id=?'); params.push(Number(product_id)); }
  const from = `FROM boms b JOIN products p ON p.id=b.product_id WHERE ${clauses.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params).n;
  const boms = db.prepare(`SELECT b.*,p.name AS product_name,p.barcode,p.unit AS product_unit,p.active AS product_active,
    (SELECT COUNT(*) FROM bom_items WHERE bom_id=b.id) AS item_count ${from} ORDER BY b.updated_at DESC,b.id DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), Number(offset));
  return { boms, total, has_more: Number(offset) + boms.length < total, next_offset: Number(offset) + boms.length };
}

export function getBom(db, warehouseId, id) {
  if (!Number.isSafeInteger(id) || id < 1) fail('用料清单编号无效。');
  return readSnapshot(db, () => {
    const bom = db.prepare('SELECT * FROM boms WHERE id=? AND warehouse_id=?').get(id, warehouseId);
    if (!bom) fail('用料清单不存在或不属于当前仓库。', 404);
    bom.product = publicProduct(db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(bom.product_id, warehouseId));
    bom.items = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY position,id').all(id).map(item => ({
      ...item, product: publicProduct(db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(item.product_id, warehouseId)),
    }));
    return bom;
  });
}

export function calculateBom(db, warehouse, id, productionQuantity, version) {
  if (!validQuantity(productionQuantity, true)) fail('生产数量需为正数，最多 6 位小数。');
  const bom = getBom(db, warehouse.id, id);
  if (version !== undefined && version !== bom.version) fail('用料清单已变化，请重新打开后测算。', 409);
  if (!bom.enabled) fail('用料清单已停用，请启用后测算。');
  if (!bom.product.active || bom.items.some(item => !item.product.active)) fail('成品或材料已停用，请核对物料后测算。');
  if (bom.base_unit !== bom.product.unit || bom.items.some(item => item.unit !== item.product.unit))
    fail('物料单位已变化，请编辑用料清单、核对用量并重新保存后测算。', 409);
  const rows = bom.items.map(item => {
    const required = bomRequiredQuantity(item.quantity, productionQuantity, bom.base_quantity);
    return { product_id: item.product_id, name: item.product.name, barcode: item.product.barcode, specification: item.product.specification,
      unit: item.unit, quantity: item.quantity, required, stock: item.product.stock, shortage: bomShortage(required, item.product.stock), note: item.note };
  });
  return { bom_id: bom.id, version: bom.version, name: bom.name, product: bom.product, base_quantity: bom.base_quantity,
    production_quantity: productionQuantity, warehouse: { id: warehouse.id, name: warehouse.name }, captured_at: new Date().toISOString(), rows };
}

export function validateBomBackup(data) {
  const products = new Map(data.products.map(p => [p.id, p]));
  const warehouses = new Set(data.warehouses.map(w => w.id));
  const boms = new Map(data.boms.map(b => [b.id, b]));
  const grouped = new Map();
  for (const item of data.bom_items) {
    if (!boms.has(item.bom_id) || !Number.isSafeInteger(item.position) || item.position < 0 || item.position >= 100)
      fail('备份用料清单明细关联或排序无效。');
    const items = grouped.get(item.bom_id) || [];
    items.push(item); grouped.set(item.bom_id, items);
  }
  const parents = new Set();
  for (const bom of data.boms) {
    const items = grouped.get(bom.id) || [];
    validateBom({ ...bom, items });
    const key = `${bom.warehouse_id}:${bom.product_id}`;
    if (!warehouses.has(bom.warehouse_id) || products.get(bom.product_id)?.warehouse_id !== bom.warehouse_id || parents.has(key) ||
        items.some(item => products.get(item.product_id)?.warehouse_id !== bom.warehouse_id) ||
        new Set(items.map(item => item.position)).size !== items.length ||
        !Number.isSafeInteger(bom.version) || bom.version < 1 ||
        ['created_by_name', 'updated_by_name'].some(k => typeof bom[k] !== 'string' || !bom[k].trim() || bom[k].length > 60) ||
        ['created_at', 'updated_at'].some(k => typeof bom[k] !== 'string' || bom[k].length > 100 || !Number.isFinite(Date.parse(bom[k]))))
      fail('备份用料清单字段或仓库关联无效。');
    parents.add(key);
  }
}

export function installBom(app, db) {
  const route = (fn, write = false) => (req, res) => {
    try {
      if (write) db.exec('BEGIN IMMEDIATE');
      const request = write ? operationRequest(db, req) : null;
      const result = request?.previous || fn(req);
      if (write) { if (!request.previous) saveOperationRequest(db, request, result); db.exec('COMMIT'); }
      res.json(result);
    } catch (error) {
      if (write && db.isTransaction) db.exec('ROLLBACK');
      res.status(error.status || 400).json({ error: error.message.includes('UNIQUE') ? '该成品已有用料清单，请编辑现有清单或选择其他成品。' : error.message });
    }
  };
  const current = req => getBom(db, req.warehouse.id, Number(req.params.id));
  const checkVersion = (req, bom) => {
    if (!Number.isSafeInteger(req.body.version) || req.body.version !== bom.version) fail('用料清单已被修改，请重新打开后再保存。当前填写内容已保留。', 409);
  };
  const save = (req, existing) => {
    const body = validateBom(req.body);
    const product = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(body.product_id, req.warehouse.id);
    if (!product || !product.active) fail('请选择当前仓库已启用的成品物料。');
    if (product.unit !== body.base_unit) fail('成品单位已变化，请重新选择成品并核对基准产量。', 409);
    for (const item of body.items) {
      const material = db.prepare('SELECT unit,active FROM products WHERE id=? AND warehouse_id=?').get(item.product_id, req.warehouse.id);
      if (!material || !material.active) fail('材料不存在、已停用或不属于当前仓库，请重新选择。');
      if (item.unit !== material.unit) fail('材料单位已变化，请重新选择材料并核对用量。', 409);
    }
    const at = new Date().toISOString(), owner = req.user.name || req.user.username;
    let id = existing?.id;
    if (existing) {
      checkVersion(req, existing);
      db.prepare('UPDATE boms SET product_id=?,name=?,base_quantity=?,base_unit=?,note=?,enabled=?,updated_by_name=?,updated_at=? WHERE id=?')
        .run(body.product_id, body.name.trim(), body.base_quantity, body.base_unit, body.note.trim(), body.enabled, owner, at, id);
      db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(id);
    } else id = Number(db.prepare('INSERT INTO boms(warehouse_id,product_id,name,base_quantity,base_unit,note,enabled,created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.warehouse.id, body.product_id, body.name.trim(), body.base_quantity, body.base_unit, body.note.trim(), body.enabled, owner, owner, at, at).lastInsertRowid);
    const insert = db.prepare('INSERT INTO bom_items(bom_id,product_id,quantity,unit,note,position) VALUES (?,?,?,?,?,?)');
    body.items.forEach((item, index) => insert.run(id, item.product_id, item.quantity, item.unit, item.note.trim(), index));
    return getBom(db, req.warehouse.id, id);
  };
  app.get('/api/boms', route(req => listBoms(db, req.warehouse.id, req.query)));
  app.get('/api/boms/:id', route(current));
  app.post('/api/boms', route(req => save(req), true));
  app.post('/api/boms/:id', route(req => save(req, current(req)), true));
  app.post('/api/boms/:id/status', route(req => {
    const bom = current(req); checkVersion(req, bom);
    if (![0, 1].includes(req.body.enabled)) fail('启用状态无效。');
    db.prepare('UPDATE boms SET enabled=?,updated_by_name=?,updated_at=? WHERE id=?')
      .run(req.body.enabled, req.user.name || req.user.username, new Date().toISOString(), bom.id);
    return current(req);
  }, true));
  app.post('/api/boms/:id/calculate', route(req => calculateBom(db, req.warehouse, Number(req.params.id), req.body.production_quantity, req.body.version)));
}
