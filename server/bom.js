import { validQuantity } from '../shared/quantity.js';
import { createHash } from 'node:crypto';
import { rebuildTable } from './table-migration.js';
import { buildBomNodes, calculateBomNodes } from '../shared/bom-expansion.js';
import { validateBom, validateBomLossMethod, bomShortage } from '../shared/bom.js';
import { validateScrapRules, scrapExpectedQuantity } from '../shared/scrap.js';
import { operationRequest, saveOperationRequest } from './operations.js';

export const bomTables = ['boms', 'bom_items', 'bom_scraps'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const pattern = value => `%${value.replace(/[\\%_]/g, c => `\\${c}`)}%`;
const publicProduct = product => Object.fromEntries(['id', 'name', 'barcode', 'specification', 'unit', 'active', 'stock', 'unit_round_up'].map(key => [key, product[key]]));

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
    CREATE TABLE IF NOT EXISTS bom_scraps (
    id INTEGER PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES boms(id),
    product_id INTEGER NOT NULL REFERENCES products(id), method TEXT NOT NULL,
    source_product_id INTEGER REFERENCES products(id), quantity REAL NOT NULL,
    quantity_fraction TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL, UNIQUE(bom_id,product_id));
    CREATE INDEX IF NOT EXISTS bom_scraps_product ON bom_scraps(product_id);
    CREATE INDEX IF NOT EXISTS boms_warehouse ON boms(warehouse_id,updated_at);
    CREATE INDEX IF NOT EXISTS bom_items_product ON bom_items(product_id);
    INSERT OR IGNORE INTO app_metadata(key,value) VALUES ('bom_version','0');
    UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM boms)) WHERE key='bom_version';`);
  if (!db.prepare('PRAGMA table_info(bom_items)').all().some(column => column.name === 'quantity_fraction'))
    db.exec("ALTER TABLE bom_items ADD COLUMN quantity_fraction TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(bom_items)').all().some(column => column.name === 'loss_rate'))
    db.exec('ALTER TABLE bom_items ADD COLUMN loss_rate REAL NOT NULL DEFAULT 0 CHECK(loss_rate>=0 AND loss_rate<100)');
  if (!db.prepare('PRAGMA table_info(boms)').all().some(column => column.name === 'loss_method')) {
    db.exec("ALTER TABLE boms ADD COLUMN loss_method TEXT NOT NULL DEFAULT 'internal' CHECK(loss_method IN ('internal','external'))");
    db.exec('DROP TRIGGER IF EXISTS bom_version_update');
  }
  if (db.prepare('PRAGMA index_list(boms)').all().some(index => index.unique &&
      db.prepare(`PRAGMA index_info("${index.name}")`).all().map(row => row.name).join(',') === 'warehouse_id,product_id'))
    rebuildTable(db, 'boms', sql => sql.replace(/,\s*UNIQUE\s*\(warehouse_id,\s*product_id\)/i, ''));
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS boms_product_name ON boms(warehouse_id,product_id,trim(name)); CREATE INDEX IF NOT EXISTS boms_product ON boms(warehouse_id,product_id);');
  if (!db.prepare('PRAGMA table_info(bom_items)').all().some(column => column.name === 'usage_mode'))
    db.exec("ALTER TABLE bom_items ADD COLUMN usage_mode TEXT NOT NULL DEFAULT 'stock' CHECK(usage_mode IN ('stock','explode')); ALTER TABLE bom_items ADD COLUMN child_bom_id INTEGER REFERENCES boms(id);");
  db.exec('CREATE INDEX IF NOT EXISTS bom_items_child ON bom_items(child_bom_id)');
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='bom_version';
    UPDATE boms SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='bom_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS bom_version_insert AFTER INSERT ON boms BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS bom_version_update AFTER UPDATE OF name,product_id,base_quantity,base_unit,loss_method,note,enabled,updated_at,updated_by_name ON boms BEGIN ${advance} END;`);
}

export function clearBom(db, warehouseId) {
  if (warehouseId === undefined) db.exec('DELETE FROM bom_scraps; DELETE FROM bom_items; DELETE FROM boms;');
  else {
    db.prepare('DELETE FROM bom_scraps WHERE bom_id IN (SELECT id FROM boms WHERE warehouse_id=?)').run(warehouseId);
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
    fail('BOM筛选或分页参数无效。');
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
  if (!Number.isSafeInteger(id) || id < 1) fail('BOM编号无效。');
  return readSnapshot(db, () => {
    const bom = db.prepare('SELECT * FROM boms WHERE id=? AND warehouse_id=?').get(id, warehouseId);
    if (!bom) fail('BOM不存在或不属于当前仓库。', 404);
    bom.product = publicProduct(db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(bom.product_id, warehouseId));
    bom.items = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY position,id').all(id).map(item => ({
      ...item, child_bom: item.child_bom_id ? db.prepare('SELECT id,name,version,product_id,base_quantity,enabled FROM boms WHERE id=? AND warehouse_id=?').get(item.child_bom_id, warehouseId) : null, product: publicProduct(db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(item.product_id, warehouseId)),
    }));
    bom.scraps = db.prepare('SELECT * FROM bom_scraps WHERE bom_id=? ORDER BY position,id').all(id).map(row => ({
      ...row, product: publicProduct(db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(row.product_id, warehouseId)),
    }));
    return bom;
  });
}

export function calculateBom(db, warehouse, id, productionQuantity, version, schemaVersion) {
  if (!validQuantity(productionQuantity, true)) fail('生产数量需为正数，最多 4 位小数。');
  return readSnapshot(db, () => {
    const bom = getBom(db, warehouse.id, id);
    productionQuantity = bom.product.unit_round_up ? Math.ceil(productionQuantity) : productionQuantity;
    if (version !== undefined && version !== bom.version) fail('BOM已变化，请重新打开后测算。', 409);
    const cache = new Map([[bom.id, bom]]);
    const load = childId => {
      if (!cache.has(childId)) cache.set(childId, getBom(db, warehouse.id, childId));
      return cache.get(childId);
    };
    const nodes = buildBomNodes(bom, load), result = calculateBomNodes(nodes, productionQuantity);
    if (result.multi_level && schemaVersion !== 2) fail('此BOM包含多层配方，请刷新页面后重新测算。', 409);
    const rows = result.rows.map(row => {
      const product = db.prepare('SELECT stock FROM products WHERE id=? AND warehouse_id=?').get(row.product_id, warehouse.id);
      return { ...row, stock: product.stock, shortage: bomShortage(row.required, product.stock) };
    });
    const instance = db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
    const fingerprints = [...cache.values()].sort((a, b) => a.id - b.id).map(b => [b.id, b.version, b.name, b.enabled, b.base_quantity, b.base_unit, b.loss_method,
      b.product.id, b.product.name, b.product.barcode, b.product.specification, b.product.active, b.product.unit, b.product.unit_round_up,
      [...b.items, ...b.scraps].map(row => [row.product_id, row.quantity, row.quantity_fraction, row.loss_rate, row.usage_mode, row.child_bom_id, row.note, row.method, row.source_product_id,
        row.product.name, row.product.barcode, row.product.specification, row.product.active, row.product.unit, row.product.unit_round_up])]);
    return { bom_id: bom.id, version: bom.version, name: bom.name, product: bom.product, base_quantity: bom.base_quantity, loss_method: bom.loss_method,
      schema_version: 2, multi_level: result.multi_level, nodes: result.nodes,
      structure_token: createHash('sha256').update(JSON.stringify([instance, warehouse.id, fingerprints])).digest('hex'),
      scraps: bom.scraps.map(row => ({ ...row, name: row.product.name, barcode: row.product.barcode, specification: row.product.specification,
        planned_quantity: scrapExpectedQuantity({ ...row, unit_round_up: row.product.unit_round_up }, productionQuantity, bom.base_quantity, rows.map(item => ({ product_id: item.product_id, quantity: item.required }))) })),
      quantity_decimals: 4, production_quantity: productionQuantity, warehouse: { id: warehouse.id, name: warehouse.name }, captured_at: new Date().toISOString(), rows };
  });
}

// Validate identities and structure without requiring currently enabled goods.
// Disabled / changed-unit recipes may legitimately remain in the catalogue.
export function validateBomGraph(boms, { scraps = false } = {}) {
  const map = new Map(boms.map(bom => [bom.id, bom]));
  for (const bom of boms) buildBomNodes(bom, id => map.get(id), { availability: false, scrapRules: scraps });
}

function validateWarehouseGraph(db, warehouseId, changedId) {
  const boms = db.prepare('SELECT id FROM boms WHERE warehouse_id=?').all(warehouseId).map(row => getBom(db, warehouseId, row.id));
  validateBomGraph(boms);
  const changed = boms.find(row => row.id === changedId);
  buildBomNodes(changed, id => boms.find(row => row.id === id), { availability: false });
}

export function validateBomBackup(data) {
  const products = new Map(data.products.map(p => [p.id, p]));
  const warehouses = new Set(data.warehouses.map(w => w.id));
  const boms = new Map(data.boms.map(b => [b.id, b]));
  const grouped = new Map();
  for (const item of data.bom_items) {
    if (item.loss_rate === undefined || !boms.has(item.bom_id) || !Number.isSafeInteger(item.position) || item.position < 0 || item.position >= 100)
      fail('备份BOM明细关联或排序无效。');
    const items = grouped.get(item.bom_id) || [];
    items.push(item); grouped.set(item.bom_id, items);
  }
  const scrapGroups = new Map();
  for (const row of data.bom_scraps) {
    if (!boms.has(row.bom_id)) fail('备份 BOM 废料关联无效。');
    const group = scrapGroups.get(row.bom_id) || []; group.push(row); scrapGroups.set(row.bom_id, group);
  }
  const parents = new Set();
  for (const bom of data.boms) {
    validateBomLossMethod(bom.loss_method);
    const items = grouped.get(bom.id) || [];
    validateBom({ ...bom, items });
    const scraps = scrapGroups.get(bom.id) || [];
    validateScrapRules(scraps, bom.product_id, items);
    if (new Set(scraps.map(row => row.position)).size !== scraps.length || scraps.some(row =>
        typeof row.quantity_fraction !== 'string' || !Number.isSafeInteger(row.position) || row.position < 0 || row.position >= 100 || products.get(row.product_id)?.warehouse_id !== bom.warehouse_id))
      fail('备份 BOM 废料排序或仓库关联无效。');
    const key = JSON.stringify([bom.warehouse_id, bom.product_id, bom.name.trim()]);
    if (!warehouses.has(bom.warehouse_id) || products.get(bom.product_id)?.warehouse_id !== bom.warehouse_id || parents.has(key) ||
        items.some(item => products.get(item.product_id)?.warehouse_id !== bom.warehouse_id) ||
        new Set(items.map(item => item.position)).size !== items.length ||
        !Number.isSafeInteger(bom.version) || bom.version < 1 ||
        ['created_by_name', 'updated_by_name'].some(k => typeof bom[k] !== 'string' || !bom[k].trim() || bom[k].length > 60) ||
        ['created_at', 'updated_at'].some(k => typeof bom[k] !== 'string' || bom[k].length > 100 || !Number.isFinite(Date.parse(bom[k]))))
      fail('备份BOM字段或仓库关联无效。');
    parents.add(key);
  }
  validateBomGraph(data.boms.map(bom => ({ ...bom, product: products.get(bom.product_id),
    items: (grouped.get(bom.id) || []).sort((a,b) => a.position-b.position).map(row => ({ ...row, product: products.get(row.product_id) })),
    scraps: scrapGroups.get(bom.id) || [] })));
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
      res.status(error.status || 400).json({ error: error.message.includes('UNIQUE') ? '该物料已有同名BOM，请使用不同的配方名称。' : error.message });
    }
  };
  const current = req => getBom(db, req.warehouse.id, Number(req.params.id));
  const checkVersion = (req, bom) => {
    if (!Number.isSafeInteger(req.body.version) || req.body.version !== bom.version) fail('BOM已被修改，请重新打开后再保存。当前填写内容已保留。', 409);
  };
  const save = (req, existing) => {
    // Older clients preserve the saved method and rates instead of resetting them.
    const body = validateBom({ ...req.body, loss_method: req.body.loss_method === undefined ? (existing?.loss_method ?? 'internal') : req.body.loss_method,
      items: Array.isArray(req.body.items) ? req.body.items.map(item => item && ({ ...item,
      usage_mode: item.usage_mode === undefined ? (existing?.items.find(row => row.product_id === item.product_id)?.usage_mode ?? 'stock') : item.usage_mode,
      child_bom_id: item.usage_mode === 'stock' ? null : item.child_bom_id === undefined ? (existing?.items.find(row => row.product_id === item.product_id)?.child_bom_id ?? null) : item.child_bom_id,
      loss_rate: item.loss_rate === undefined ? (existing?.items.find(row => row.product_id === item.product_id)?.loss_rate ?? 0) : item.loss_rate })) : req.body.items });
    if (!validQuantity(body.base_quantity, true) || body.items.some(row => !row.quantity_fraction && !validQuantity(row.quantity, true)))
      fail('基准产量及材料用量最多 4 位小数。');
    // An older client editing a BOM must not silently delete its output rules.
    const scraps = body.scraps === undefined ? (existing?.scraps || []) : body.scraps;
    validateScrapRules(scraps, body.product_id, body.items);
    const product = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(body.product_id, req.warehouse.id);
    if (!product || !product.active) fail('请选择当前仓库已启用的成品物料。');
    if (product.unit !== body.base_unit) fail('成品单位已变化，请重新选择成品并核对基准产量。', 409);
    for (const item of body.items.filter(row => row.usage_mode === 'explode')) {
      const old = existing?.items.find(row => row.product_id === item.product_id);
      const child = db.prepare('SELECT enabled FROM boms WHERE id=? AND product_id=? AND warehouse_id=?').get(item.child_bom_id, item.product_id, req.warehouse.id);
      if (!child) fail('请选择当前物料在当前仓库的下级配方。');
      if (!child.enabled && (old?.usage_mode !== 'explode' || old.child_bom_id !== item.child_bom_id)) fail('所选下级配方已停用，请选择已启用的配方。');
    }
    for (const item of [...body.items, ...scraps]) {
      const material = db.prepare('SELECT unit,active FROM products WHERE id=? AND warehouse_id=?').get(item.product_id, req.warehouse.id);
      if (!material || !material.active) fail('材料不存在、已停用或不属于当前仓库，请重新选择。');
      if (item.unit !== material.unit) fail('材料单位已变化，请重新选择材料并核对用量。', 409);
    }
    const at = new Date().toISOString(), owner = req.user.name || req.user.username;
    let id = existing?.id;
    if (existing) {
      checkVersion(req, existing);
      if (existing.product_id !== body.product_id && db.prepare('SELECT 1 FROM bom_items WHERE child_bom_id=? LIMIT 1').get(existing.id)) fail('此配方已被上级BOM引用，请先处理上级关联后再更换成品。');
      db.prepare('UPDATE boms SET product_id=?,name=?,base_quantity=?,base_unit=?,loss_method=?,note=?,enabled=?,updated_by_name=?,updated_at=? WHERE id=?')
        .run(body.product_id, body.name.trim(), body.base_quantity, body.base_unit, body.loss_method, body.note.trim(), body.enabled, owner, at, id);
      db.prepare('DELETE FROM bom_scraps WHERE bom_id=?').run(id);
      db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(id);
    } else id = Number(db.prepare('INSERT INTO boms(warehouse_id,product_id,name,base_quantity,base_unit,loss_method,note,enabled,created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.warehouse.id, body.product_id, body.name.trim(), body.base_quantity, body.base_unit, body.loss_method, body.note.trim(), body.enabled, owner, owner, at, at).lastInsertRowid);
    const insert = db.prepare('INSERT INTO bom_items(bom_id,product_id,quantity,quantity_fraction,loss_rate,unit,note,position,usage_mode,child_bom_id) VALUES (?,?,?,?,?,?,?,?,?,?)');
    body.items.forEach((item, index) => insert.run(id, item.product_id, item.quantity, item.quantity_fraction ?? '', item.loss_rate, item.unit, item.note.trim(), index, item.usage_mode, item.child_bom_id));
    const insertScrap = db.prepare('INSERT INTO bom_scraps(bom_id,product_id,method,source_product_id,quantity,quantity_fraction,unit,note,position) VALUES (?,?,?,?,?,?,?,?,?)');
    scraps.forEach((row, index) => insertScrap.run(id, row.product_id, row.method, row.source_product_id, row.quantity, row.quantity_fraction ?? '', row.unit, row.note.trim(), index));
    validateWarehouseGraph(db, req.warehouse.id, id);
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
  app.post('/api/boms/:id/delete', route(req => {
    const bom = current(req);
    if (!Number.isSafeInteger(req.body.version) || req.body.version !== bom.version)
      fail('BOM已被修改，请刷新列表后再删除。', 409);
    if (db.prepare('SELECT 1 FROM bom_items WHERE child_bom_id=? LIMIT 1').get(bom.id))
      fail('此配方已被上级BOM引用，请先解除关联，或改为停用。', 409);
    if (db.prepare('SELECT 1 FROM production_orders WHERE bom_id=? LIMIT 1').get(bom.id) ||
        db.prepare('SELECT 1 FROM production_bom_nodes WHERE bom_id=? OR child_bom_id=? LIMIT 1').get(bom.id, bom.id))
      fail('此配方已被生产单引用，不能删除，可改为停用。', 409);
    db.prepare('DELETE FROM bom_scraps WHERE bom_id=?').run(bom.id);
    db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(bom.id);
    db.prepare('DELETE FROM boms WHERE id=?').run(bom.id);
    return { ok: true };
  }, true));
  app.post('/api/boms/:id/calculate', route(req => calculateBom(db, req.warehouse, Number(req.params.id), req.body.production_quantity, req.body.version, req.body.schema_version)));
}
