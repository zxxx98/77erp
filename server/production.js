import { rebuildTable } from './table-migration.js';
import { BOM_NODE_COLUMNS, validateSnapshotNodes, validateExpansionScraps, calculateBomNodes } from '../shared/bom-expansion.js';
import { randomUUID } from 'node:crypto';
import { getBom, listBoms, calculateBom } from './bom.js';
import { operationRequest, saveOperationRequest } from './operations.js';
import { moveInventory } from './commerce.js';
import { notifyStockChanges } from './notifications.js';
import { hasPermission } from '../shared/permissions.js';
import { validateScrapRules, validateScrapActuals, scrapExpectedQuantity } from '../shared/scrap.js';
import { validQuantity } from '../shared/quantity.js';
import { validateBomLossRate, validateBomLossMethod } from '../shared/bom.js';
import { validateProductionPlan, validateProductionCompletion, productionPlannedQuantity, productionItemQuantity, productionMaterialAnalysis } from '../shared/production.js';
import { productionBatchSummary } from '../shared/production-batches.js';

export const productionBatchTables = ['production_batches', 'production_batch_items', 'production_batch_scraps'];
export const productionTables = ['production_orders', 'production_items', 'production_scraps', 'production_bom_nodes', ...productionBatchTables];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isId = id => Number.isSafeInteger(id) && id > 0;
const pattern = value => `%${value.replace(/[\\%_]/g, c => `\\${c}`)}%`;
const actor = req => req.user.name || req.user.username;
const publicProduct = p => ({ id: p.id, name: p.name, barcode: p.barcode, unit: p.unit, stock: p.stock, active: p.active });
function snapshot(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
export function productionWithoutCosts(value) {
  if (Array.isArray(value)) return value.map(productionWithoutCosts);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['total_cost_cents', 'cost_cents'].includes(key)).map(([key, child]) => [key, productionWithoutCosts(child)]));
  return value;
}

export function migrateProduction(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS production_orders (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    bom_id INTEGER NOT NULL REFERENCES boms(id), bom_version INTEGER NOT NULL, bom_name TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL, barcode TEXT NOT NULL,
    specification TEXT NOT NULL, unit TEXT NOT NULL, base_quantity REAL NOT NULL, planned_quantity REAL NOT NULL,
    completed_quantity REAL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed','void')),
    note TEXT NOT NULL DEFAULT '', total_cost_cents INTEGER, version INTEGER NOT NULL DEFAULT 1,
    created_by_name TEXT NOT NULL, updated_by_name TEXT NOT NULL, completed_by_name TEXT NOT NULL DEFAULT '',
    voided_by_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    completed_at TEXT, voided_at TEXT, void_reason TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS production_items (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL,
    specification TEXT NOT NULL, unit TEXT NOT NULL, base_quantity REAL NOT NULL, planned_quantity REAL NOT NULL,
    actual_quantity REAL, cost_cents INTEGER, note TEXT NOT NULL, position INTEGER NOT NULL,
    UNIQUE(production_id,product_id));
    CREATE TABLE IF NOT EXISTS production_scraps (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL,
    specification TEXT NOT NULL, unit TEXT NOT NULL, method TEXT NOT NULL,
    source_product_id INTEGER REFERENCES products(id), quantity REAL NOT NULL, quantity_fraction TEXT NOT NULL DEFAULT '',
    planned_quantity REAL NOT NULL, expected_quantity REAL, actual_quantity REAL, disposition TEXT,
    note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, UNIQUE(production_id,product_id));
    CREATE INDEX IF NOT EXISTS production_scraps_product ON production_scraps(product_id);
    CREATE INDEX IF NOT EXISTS production_warehouse ON production_orders(warehouse_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS production_product ON production_orders(product_id);
    CREATE INDEX IF NOT EXISTS production_item_product ON production_items(product_id);
    INSERT OR IGNORE INTO app_metadata(key,value) VALUES ('production_version','0');
    UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM production_orders)) WHERE key='production_version';`);
  if (!db.prepare('PRAGMA table_info(production_items)').all().some(column => column.name === 'base_quantity_fraction'))
    db.exec("ALTER TABLE production_items ADD COLUMN base_quantity_fraction TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(production_items)').all().some(column => column.name === 'variance_reason'))
    db.exec("ALTER TABLE production_items ADD COLUMN variance_reason TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(production_items)').all().some(column => column.name === 'loss_rate'))
    db.exec('ALTER TABLE production_items ADD COLUMN loss_rate REAL NOT NULL DEFAULT 0 CHECK(loss_rate>=0 AND loss_rate<100)');
  if (!db.prepare('PRAGMA table_info(production_orders)').all().some(column => column.name === 'loss_method'))
    db.exec("ALTER TABLE production_orders ADD COLUMN loss_method TEXT NOT NULL DEFAULT 'internal' CHECK(loss_method IN ('internal','external'))");
  db.exec(`CREATE TABLE IF NOT EXISTS production_batches (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id), batch_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')), completed_quantity REAL NOT NULL,
    total_cost_cents INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created_by_name TEXT NOT NULL, created_at TEXT NOT NULL,
    voided_by_name TEXT NOT NULL DEFAULT '', voided_at TEXT, void_reason TEXT NOT NULL DEFAULT '',
    voided_with_order INTEGER NOT NULL DEFAULT 0 CHECK(voided_with_order IN (0,1)), UNIQUE(production_id,batch_number));
    CREATE TABLE IF NOT EXISTS production_batch_items (
    id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES production_batches(id), product_id INTEGER NOT NULL REFERENCES products(id),
    actual_quantity REAL NOT NULL, cost_cents INTEGER NOT NULL, variance_reason TEXT NOT NULL DEFAULT '', UNIQUE(batch_id,product_id));
    CREATE TABLE IF NOT EXISTS production_batch_scraps (
    id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES production_batches(id), product_id INTEGER NOT NULL REFERENCES products(id),
    expected_quantity REAL NOT NULL, actual_quantity REAL NOT NULL, disposition TEXT NOT NULL CHECK(disposition IN ('stock','discard')),
    UNIQUE(batch_id,product_id));
    CREATE INDEX IF NOT EXISTS production_batch_order ON production_batches(production_id,id);
    CREATE INDEX IF NOT EXISTS production_batch_item_product ON production_batch_items(product_id);
    CREATE INDEX IF NOT EXISTS production_batch_scrap_product ON production_batch_scraps(product_id);`);
  if (!db.prepare('PRAGMA table_info(production_orders)').all().some(column => column.name === 'batch_tracking')) {
    db.exec('ALTER TABLE production_orders ADD COLUMN batch_tracking INTEGER NOT NULL DEFAULT 0 CHECK(batch_tracking IN (0,1))');
    db.exec('UPDATE production_orders SET batch_tracking=1 WHERE EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=production_orders.id)');
  }
  if (!db.prepare('PRAGMA table_info(production_orders)').all().some(column => column.name === 'snapshot_format'))
    db.exec('ALTER TABLE production_orders ADD COLUMN snapshot_format INTEGER NOT NULL DEFAULT 1 CHECK(snapshot_format IN (1,2))');
  if (db.prepare('PRAGMA table_info(production_items)').all().find(column => column.name === 'base_quantity').notnull)
    rebuildTable(db, 'production_items', sql => sql.replace(/\b(base_quantity|base_quantity_fraction|loss_rate) (REAL|TEXT) NOT NULL/g, '$1 $2'));
  const numeric = new Set(['bom_id','bom_version','bom_product_id','bom_base_quantity','product_id','quantity','loss_rate','child_bom_id','position']);
  const columns = BOM_NODE_COLUMNS.map(key => `${key} ${numeric.has(key) ? (['quantity','loss_rate','bom_base_quantity'].includes(key) ? 'REAL' : 'INTEGER') : 'TEXT'}${key === 'child_bom_id' ? '' : ' NOT NULL'}${['bom_id','child_bom_id'].includes(key) ? ' REFERENCES boms(id)' : ['product_id','bom_product_id'].includes(key) ? ' REFERENCES products(id)' : ''}`);
  db.exec(`CREATE TABLE IF NOT EXISTS production_bom_nodes (id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id), ${columns.join(',')}, UNIQUE(production_id,path));
    CREATE INDEX IF NOT EXISTS production_bom_node_product ON production_bom_nodes(product_id);
    CREATE INDEX IF NOT EXISTS production_bom_node_parent_product ON production_bom_nodes(bom_product_id);`);
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='production_version';
    UPDATE production_orders SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='production_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS production_version_insert AFTER INSERT ON production_orders BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS production_version_update AFTER UPDATE OF planned_quantity,note,status,updated_at ON production_orders BEGIN ${advance} END;`);
}

export function clearProduction(db) { db.exec('DELETE FROM production_batch_scraps; DELETE FROM production_batch_items; DELETE FROM production_batches; DELETE FROM production_bom_nodes; DELETE FROM production_scraps; DELETE FROM production_items; DELETE FROM production_orders;'); }

// Preserve the legacy SQLite status constraint. A posted, open order is exposed
// as in_progress; draft without any currently posted output remains draft.
const publicStatus = order => order.status === 'draft' && order.completed_at ? 'in_progress' : order.status;
const summaryBatches = order => order.batches.filter(batch => batch.status === 'active' || order.status === 'void' && batch.voided_with_order === 1);

function readBatches(db, productionId) {
  return db.prepare('SELECT * FROM production_batches WHERE production_id=? ORDER BY batch_number').all(productionId).map(batch => ({ ...batch,
    items: db.prepare('SELECT * FROM production_batch_items WHERE batch_id=? ORDER BY id').all(batch.id),
    scraps: db.prepare('SELECT * FROM production_batch_scraps WHERE batch_id=? ORDER BY id').all(batch.id),
  }));
}

function updateBatchTotals(db, order, status, owner, at) {
  const batches = readBatches(db, order.id).filter(batch => batch.status === 'active');
  const totals = productionBatchSummary(order.items, order.scraps, batches), latest = batches.at(-1);
  for (const item of totals.items) db.prepare('UPDATE production_items SET actual_quantity=?,cost_cents=?,variance_reason=? WHERE production_id=? AND product_id=?')
    .run(latest ? item.actual_quantity : null, latest ? item.cost_cents : null, item.variance_reason, order.id, item.product_id);
  for (const row of totals.scraps) db.prepare('UPDATE production_scraps SET expected_quantity=?,actual_quantity=?,disposition=? WHERE production_id=? AND product_id=?')
    .run(latest ? row.expected_quantity : null, latest ? row.actual_quantity : null, row.disposition, order.id, row.product_id);
  db.prepare('UPDATE production_orders SET batch_tracking=1,status=?,completed_quantity=?,total_cost_cents=?,completed_by_name=?,completed_at=?,updated_by_name=?,updated_at=? WHERE id=?')
    .run(status, latest ? totals.completed_quantity : null, latest ? totals.total_cost_cents : null, latest?.created_by_name ?? '', latest?.created_at ?? null, owner, at, order.id);
}

export function listProductionOrders(db, warehouseId, query = {}, costs = false) {
  const { q = '', status = 'all', offset = '0', limit = '30' } = query;
  if (typeof q !== 'string' || q.length > 100 || !['all', 'draft', 'in_progress', 'completed', 'void'].includes(status) ||
      typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
      typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)
    fail('生产单筛选或分页参数无效。');
  return snapshot(db, () => {
    const clauses = ['warehouse_id=?'], params = [warehouseId];
    if (status === 'in_progress') clauses.push("status='draft' AND completed_at IS NOT NULL");
    else if (status === 'draft') clauses.push("status='draft' AND completed_at IS NULL");
    else if (status !== 'all') { clauses.push('status=?'); params.push(status); }
    if (q.trim()) { clauses.push("(number LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\' OR bom_name LIKE ? ESCAPE '\\')"); params.push(...Array(4).fill(pattern(q.trim()))); }
    const where = clauses.join(' AND '), total = db.prepare(`SELECT COUNT(*) AS n FROM production_orders WHERE ${where}`).get(...params).n;
    const orders = db.prepare(`SELECT * FROM production_orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
    const result = { orders: orders.map(order => ({ ...order, status: publicStatus(order) })), total, has_more: Number(offset) + orders.length < total, next_offset: Number(offset) + orders.length };
    return costs ? result : productionWithoutCosts(result);
  });
}

export function getProductionOrder(db, warehouseId, id, costs = false) {
  if (!isId(id)) fail('生产单编号无效。');
  return snapshot(db, () => {
    const order = db.prepare('SELECT * FROM production_orders WHERE id=? AND warehouse_id=?').get(id, warehouseId);
    if (!order) fail('生产单不存在或不属于当前仓库。', 404);
    order.product = publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(order.product_id));
    order.items = db.prepare('SELECT * FROM production_items WHERE production_id=? ORDER BY position,id').all(id).map(item => ({
      ...item, product: publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id)),
    }));
    order.scraps = db.prepare('SELECT * FROM production_scraps WHERE production_id=? ORDER BY position,id').all(id).map(row => ({
      ...row, product: publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(row.product_id)),
    }));
    order.nodes = db.prepare('SELECT * FROM production_bom_nodes WHERE production_id=? ORDER BY position').all(id);
    const standardCache = new Map();
    const standardsFor = quantity => {
      if (order.snapshot_format !== 2) return undefined;
      if (!standardCache.has(quantity)) {
        try { standardCache.set(quantity, new Map(calculateBomNodes(order.nodes, quantity).rows.map(row => [row.product_id, row.required]))); }
        catch { standardCache.set(quantity, new Map()); }
      }
      return standardCache.get(quantity);
    };
    order.batches = readBatches(db, id);
    const counted = summaryBatches(order);
    if (order.batches.length) {
      const totals = productionBatchSummary(order.items, order.scraps, counted);
      order.scraps = order.scraps.map(row => ({ ...row, stock_quantity: totals.scraps.find(item => item.product_id === row.product_id).stock_quantity,
        discard_quantity: totals.scraps.find(item => item.product_id === row.product_id).discard_quantity }));
      order.items = order.items.map(item => ({ ...item, variance_reasons: counted.map(batch => ({ batch_number: batch.batch_number,
        reason: batch.items.find(row => row.product_id === item.product_id).variance_reason })).filter(row => row.reason) }));
    }
    order.batches = order.batches.map(batch => ({ ...batch,
      items: batch.items.map(row => { const item = order.items.find(item => item.product_id === row.product_id); return { ...item, ...row,
        ...productionMaterialAnalysis(item, batch.completed_quantity, order.base_quantity, row.actual_quantity, order.loss_method, standardsFor(batch.completed_quantity)), variance_reasons: undefined }; }),
      scraps: batch.scraps.map(row => ({ ...order.scraps.find(item => item.product_id === row.product_id), ...row, stock_quantity: undefined, discard_quantity: undefined })),
    }));
    order.status = publicStatus(order);
    order.batch_count = order.batches.filter(batch => batch.status === 'active').length;
    order.items = order.items.map(item => ({ ...item, ...(order.completed_at
      ? productionMaterialAnalysis(item, order.completed_quantity, order.base_quantity, item.actual_quantity, order.loss_method, standardsFor(order.completed_quantity))
      : { standard_quantity: null, variance_quantity: null, variance_rate: null, analysis_error: '' }) }));
    order.captured_at = new Date().toISOString();
    return costs ? order : productionWithoutCosts(order);
  });
}

function prepareProduction(db, req) {
  if (!isId(req.body.bom_id) || !isId(req.body.bom_version)) fail('请选择BOM并核对版本。');
  return snapshot(db, () => calculateBom(db, req.warehouse, req.body.bom_id, req.body.planned_quantity, req.body.bom_version, req.body.schema_version));
}

export function installProduction(app, db) {
  const route = (fn, write = false) => (req, res) => {
    try {
      if (write) db.exec('BEGIN IMMEDIATE');
      const request = write ? operationRequest(db, req) : null;
      const result = request?.previous || fn(req);
      if (write) { if (!request.previous) saveOperationRequest(db, request, result); db.exec('COMMIT'); }
      res.json(hasPermission(req.user, 'finance') ? result : productionWithoutCosts(result));
    } catch (error) {
      if (write && db.isTransaction) db.exec('ROLLBACK');
      res.status(error.status || 400).json({ error: error.message });
    }
  };
  const current = req => getProductionOrder(db, req.warehouse.id, Number(req.params.id), true);
  const version = (req, order) => {
    if (order.snapshot_format === 2 && req.body.schema_version !== 2) fail('此生产单使用多层配方，请刷新页面后操作。', 409);
    if (!isId(req.body.version) || req.body.version !== order.version) fail('生产单已变化，请重新读取后核对。当前填写内容已保留。', 409);
  };
  const draft = (req, order) => { version(req, order); if (order.status !== 'draft' || order.batches.length) fail('仅尚未登记批次的待生产单据可以编辑。', 409); };
  const stockBefore = order => [order.product_id, ...order.items.map(item => item.product_id), ...order.scraps.map(row => row.product_id)]
    .map(id => db.prepare('SELECT * FROM products WHERE id=?').get(id));
  const units = (order, active = true) => {
    for (const row of [{ ...order, name: order.product_name }, ...order.items, ...order.scraps]) {
      if (row.unit !== row.product.unit) fail(active
        ? `${row.name}单位已变化，请作废此草稿并按核对后的BOM重新建单。`
        : `${row.name}单位已变化，无法按原单位作废。请先核对物料单位和后续业务。`, 409);
      if (active && !row.product.active) fail(`${row.name}已停用，请先核对物料。`);
    }
  };
  app.get('/api/production-orders', route(req => listProductionOrders(db, req.warehouse.id, req.query, true)));
  app.get('/api/production-orders/boms', route(req => listBoms(db, req.warehouse.id, { ...req.query, status: 'enabled' })));
  app.post('/api/production-orders/prepare', route(req => prepareProduction(db, req)));
  app.get('/api/production-orders/:id', route(current));
  app.post('/api/production-orders', route(req => {
    validateProductionPlan(req.body);
    const plan = prepareProduction(db, req), bom = getBom(db, req.warehouse.id, plan.bom_id);
    if (plan.multi_level && req.body.structure_token !== plan.structure_token) fail('下级配方已变化或尚未预览，请重新测算后保存。当前填写内容已保留。', 409);
    const at = new Date().toISOString(), owner = actor(req), number = `SC${at.slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const id = Number(db.prepare(`INSERT INTO production_orders(number,warehouse_id,bom_id,bom_version,bom_name,
      product_id,product_name,barcode,specification,unit,base_quantity,planned_quantity,loss_method,note,
      created_by_name,updated_by_name,created_at,updated_at,batch_tracking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run(number, req.warehouse.id, bom.id, bom.version, bom.name, bom.product_id, bom.product.name, bom.product.barcode,
        bom.product.specification, bom.base_unit, bom.base_quantity, req.body.planned_quantity, bom.loss_method, req.body.note.trim(), owner, owner, at, at).lastInsertRowid);
    db.prepare('UPDATE production_orders SET snapshot_format=? WHERE id=?').run(plan.multi_level ? 2 : 1, id);
    if (plan.multi_level) {
      const insertNode = db.prepare(`INSERT INTO production_bom_nodes(production_id,${BOM_NODE_COLUMNS.join(',')}) VALUES (${Array(BOM_NODE_COLUMNS.length + 1).fill('?').join(',')})`);
      for (const node of plan.nodes) insertNode.run(id, ...BOM_NODE_COLUMNS.map(key => node[key]));
    }
    const insert = db.prepare(`INSERT INTO production_items(production_id,product_id,name,barcode,specification,unit,base_quantity,base_quantity_fraction,loss_rate,planned_quantity,note,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    plan.rows.forEach((row, index) => insert.run(id, row.product_id, row.name, row.barcode, row.specification, row.unit, row.quantity, row.quantity_fraction, row.loss_rate, row.required, row.note, index));
    const insertScrap = db.prepare(`INSERT INTO production_scraps(production_id,product_id,name,barcode,specification,unit,method,source_product_id,quantity,quantity_fraction,planned_quantity,note,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    plan.scraps.forEach((row, index) => insertScrap.run(id, row.product_id, row.name, row.barcode, row.specification, row.unit, row.method, row.source_product_id, row.quantity, row.quantity_fraction, row.planned_quantity, row.note, index));
    return getProductionOrder(db, req.warehouse.id, id, true);
  }, true));
  app.post('/api/production-orders/:id', route(req => {
    const order = current(req); draft(req, order); validateProductionPlan(req.body);
    const standards = order.snapshot_format === 2 ? new Map(calculateBomNodes(order.nodes, req.body.planned_quantity).rows.map(row => [row.product_id, row.required])) : null;
    for (const item of order.items) db.prepare('UPDATE production_items SET planned_quantity=? WHERE id=?')
      .run(productionItemQuantity(item, req.body.planned_quantity, order, standards), item.id);
    const plannedMaterials = order.items.map(item => ({ product_id: item.product_id,
      quantity: productionItemQuantity(item, req.body.planned_quantity, order, standards) }));
    for (const row of order.scraps) db.prepare('UPDATE production_scraps SET planned_quantity=? WHERE id=?')
      .run(scrapExpectedQuantity(row, req.body.planned_quantity, order.base_quantity, plannedMaterials), row.id);
    db.prepare('UPDATE production_orders SET planned_quantity=?,note=?,updated_by_name=?,updated_at=? WHERE id=?')
      .run(req.body.planned_quantity, req.body.note.trim(), actor(req), new Date().toISOString(), order.id);
    return current(req);
  }, true));
  const checkOpen = (req, order) => {
    version(req, order);
    if (!['draft', 'in_progress'].includes(order.status)) fail('仅待生产或生产中的单据可以登记完工。', 409);
  };
  const reason = req => {
    if (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500) fail('请填写作废原因（最多 500 字）。');
    return req.body.reason.trim();
  };
  const reverseBatch = (order, batch) => {
    try {
      for (const row of batch.scraps) if (row.actual_quantity && row.disposition === 'stock') {
        const product = db.prepare('SELECT stock FROM products WHERE id=?').get(row.product_id);
        const material = order.scraps.find(item => item.product_id === row.product_id);
        if (row.actual_quantity > product.stock) fail(`废料 ${material.name}库存不足（当前 ${product.stock} ${material.unit}，需扣回 ${row.actual_quantity} ${material.unit}）。`);
        moveInventory(db, row.product_id, -row.actual_quantity, 0);
      }
      moveInventory(db, order.product_id, -batch.completed_quantity, batch.total_cost_cents);
      for (const item of batch.items) if (item.actual_quantity) moveInventory(db, item.product_id, item.actual_quantity, item.cost_cents);
    } catch (error) { fail(`无法回退库存和原成本：${error.message} 请先核对后续业务。`); }
  };
  app.post('/api/production-orders/:id/complete', route(req => {
    const order = current(req); checkOpen(req, order); units(order);
    validateProductionCompletion(req.body, order.items);
    validateScrapActuals(req.body.scraps ?? [], order.scraps);
    if ((order.batches.at(-1)?.batch_number ?? 0) >= 1000) fail('每张生产单最多登记 1000 个批次，请拆分生产单。');
    const before = stockBefore(order), at = new Date().toISOString(), owner = actor(req);
    const batchNumber = (order.batches.at(-1)?.batch_number ?? 0) + 1;
    const batchId = Number(db.prepare(`INSERT INTO production_batches(production_id,batch_number,completed_quantity,total_cost_cents,note,created_by_name,created_at)
      VALUES (?,?,?,0,?,?,?)`).run(order.id, batchNumber, req.body.completed_quantity, (req.body.note ?? '').trim(), owner, at).lastInsertRowid);
    const actuals = new Map(req.body.items.map(item => [item.product_id, item]));
    let total = 0;
    for (const item of order.items) {
      const actual = actuals.get(item.product_id), quantity = actual.quantity;
      if (quantity > item.product.stock) fail(`${item.name}库存不足（当前 ${item.product.stock} ${item.unit}）。请补料或核对实际耗料。`);
      const cost = quantity ? moveInventory(db, item.product_id, -quantity) : 0;
      total += cost;
      if (!Number.isSafeInteger(total)) fail('本次材料成本超出范围，请拆分生产单。');
      db.prepare('INSERT INTO production_batch_items(batch_id,product_id,actual_quantity,cost_cents,variance_reason) VALUES (?,?,?,?,?)')
        .run(batchId, item.product_id, quantity, cost, (actual.variance_reason ?? '').trim());
    }
    moveInventory(db, order.product_id, req.body.completed_quantity, total);
    const actualScraps = new Map((req.body.scraps || []).map(row => [row.product_id, row]));
    for (const row of order.scraps) {
      const actual = actualScraps.get(row.product_id);
      const expected = scrapExpectedQuantity(row, req.body.completed_quantity, order.base_quantity, req.body.items);
      if (actual.quantity && actual.disposition === 'stock') {
        try { moveInventory(db, row.product_id, actual.quantity, 0); }
        catch (error) { fail(`废料 ${row.name}无法入库：${error.message}`); }
      }
      db.prepare('INSERT INTO production_batch_scraps(batch_id,product_id,expected_quantity,actual_quantity,disposition) VALUES (?,?,?,?,?)')
        .run(batchId, row.product_id, expected, actual.quantity, actual.disposition);
    }
    db.prepare('UPDATE production_batches SET total_cost_cents=? WHERE id=?').run(total, batchId);
    updateBatchTotals(db, order, req.body.finish_order === false ? 'draft' : 'completed', owner, at);
    notifyStockChanges(db, req, before, { production_id: order.id, number: order.number, batch_id: batchId });
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/finish', route(req => {
    const order = current(req); checkOpen(req, order);
    if (!order.batch_count) fail('请先登记至少一个有效完工批次。');
    db.prepare("UPDATE production_orders SET status='completed',updated_by_name=?,updated_at=? WHERE id=?")
      .run(actor(req), new Date().toISOString(), order.id);
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/batches/:batchId/void', route(req => {
    const order = current(req); version(req, order);
    if (order.status === 'void') fail('生产单已经作废。', 409);
    const batchId = Number(req.params.batchId);
    const batch = order.batches.find(batch => batch.id === batchId);
    if (!isId(batchId) || !batch) fail('完工批次不存在或不属于此生产单。', 404);
    if (batch.status !== 'active') fail('此完工批次已经作废。', 409);
    const why = reason(req); units(order, false);
    const before = stockBefore(order), at = new Date().toISOString(), owner = actor(req);
    reverseBatch(order, batch);
    db.prepare("UPDATE production_batches SET status='void',voided_by_name=?,voided_at=?,void_reason=? WHERE id=?").run(owner, at, why, batch.id);
    // Any correction reopens the order so a replacement batch can be recorded.
    updateBatchTotals(db, order, 'draft', owner, at);
    notifyStockChanges(db, req, before, { production_id: order.id, number: order.number, batch_id: batch.id });
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/void', route(req => {
    const order = current(req); version(req, order);
    if (order.status === 'void') fail('生产单已经作废。', 409);
    const why = reason(req), before = order.completed_at ? stockBefore(order) : [];
    const at = new Date().toISOString(), owner = actor(req);
    if (order.completed_at) {
      units(order, false);
      if (order.batches.length) {
        for (const batch of [...order.batches].reverse().filter(batch => batch.status === 'active')) {
          reverseBatch(order, batch);
          db.prepare("UPDATE production_batches SET status='void',voided_by_name=?,voided_at=?,void_reason=?,voided_with_order=1 WHERE id=?")
            .run(owner, at, why, batch.id);
        }
      } else reverseBatch(order, order); // Historical one-shot orders retain their original ledger.
    }
    db.prepare("UPDATE production_orders SET status='void',void_reason=?,voided_by_name=?,voided_at=?,updated_by_name=?,updated_at=? WHERE id=?")
      .run(why, owner, at, owner, at, order.id);
    notifyStockChanges(db, req, before, { production_id: order.id, number: order.number });
    return current(req);
  }, true));
}

export function validateProductionBackup(data) {
  const products = new Map(data.products.map(p => [p.id, p])), boms = new Map(data.boms.map(b => [b.id, b]));
  const orders = new Map(data.production_orders.map(o => [o.id, o])), grouped = new Map(), numbers = new Set();
  const text = (v, max, required = false) => typeof v === 'string' && v.length <= max && (!required || !!v.trim());
  const date = v => text(v, 100, true) && Number.isFinite(Date.parse(v));
  const money = v => Number.isSafeInteger(v) && v >= 0;
  for (const item of data.production_items) {
    if (!orders.has(item.production_id)) fail('备份生产材料关联无效。');
    const rows = grouped.get(item.production_id) || []; rows.push(item); grouped.set(item.production_id, rows);
  }
  const scrapGroups = new Map();
  for (const row of data.production_scraps) {
    if (!orders.has(row.production_id)) fail('备份生产废料关联无效。');
    const group = scrapGroups.get(row.production_id) || []; group.push(row); scrapGroups.set(row.production_id, group);
  }
  const nodeGroups = new Map();
  for (const node of data.production_bom_nodes) {
    if (!orders.has(node.production_id)) fail('备份生产配方节点关联无效。');
    const order = orders.get(node.production_id);
    if (boms.get(node.bom_id)?.warehouse_id !== order.warehouse_id ||
        (node.child_bom_id !== null && boms.get(node.child_bom_id)?.warehouse_id !== order.warehouse_id) ||
        products.get(node.product_id)?.warehouse_id !== order.warehouse_id || products.get(node.bom_product_id)?.warehouse_id !== order.warehouse_id)
      fail('备份生产配方节点跨仓库或关联无效。');
    const rows = nodeGroups.get(node.production_id) || []; rows.push(node); nodeGroups.set(node.production_id, rows);
  }
  const batchGroups = validateBatchBackup(data, orders, grouped, scrapGroups);
  for (const order of orders.values()) {
    const rows = grouped.get(order.id) || [], completed = order.completed_at !== null, batches = batchGroups.get(order.id) || [];
    const nodes = (nodeGroups.get(order.id) || []).sort((a,b) => a.position-b.position);
    if (![1, 2].includes(order.snapshot_format) || (order.snapshot_format === 1 && nodes.length)) fail('备份生产配方快照格式无效。');
    const expanded = order.snapshot_format === 2 ? validateSnapshotNodes(order, nodes) : null;
    if (expanded && (!expanded.multi_level || expanded.rows.length !== rows.length)) fail('备份多层生产材料汇总无效。');
    validateProductionPlan(order);
    validateBomLossMethod(order.loss_method);
    if (![0, 1].includes(order.batch_tracking) || (batches.length && order.batch_tracking !== 1) || (order.batch_tracking === 1 && completed && !batches.length) ||
        !['draft', 'completed', 'void'].includes(order.status) || !isId(order.version) || !isId(order.bom_version) ||
        !text(order.number, 100, true) || !/^SC\d{8}-[a-f0-9]{12}$/.test(order.number) || numbers.has(order.number) || !text(order.bom_name, 100, true) ||
        boms.get(order.bom_id)?.warehouse_id !== order.warehouse_id || products.get(order.product_id)?.warehouse_id !== order.warehouse_id ||
        !text(order.product_name, 100, true) || !text(order.barcode, 100, true) || !text(order.specification, 500) || !text(order.unit, 100, true) ||
        !validQuantity(order.base_quantity, true) || !rows.length || rows.length > (expanded ? 500 : 100) ||
        new Set(rows.map(row => row.product_id)).size !== rows.length || new Set(rows.map(row => row.position)).size !== rows.length ||
        !text(order.created_by_name, 60, true) || !text(order.updated_by_name, 60, true) || !date(order.created_at) || !date(order.updated_at) ||
        !text(order.completed_by_name, 60) || !text(order.voided_by_name, 60) || !text(order.void_reason, 500) ||
        (order.status === 'void' ? !date(order.voided_at) || !order.void_reason.trim() || !order.voided_by_name.trim() : order.voided_at !== null || order.void_reason !== '' || order.voided_by_name !== '') ||
        (order.status === 'draft' && completed && !batches.length) || (order.status === 'completed' && !completed) ||
        (completed ? !date(order.completed_at) || !order.completed_by_name.trim() || !validQuantity(order.completed_quantity, true) || !money(order.total_cost_cents)
          : order.completed_quantity !== null || order.total_cost_cents !== null || order.completed_by_name !== ''))
      fail('备份生产单字段、状态或关联无效。');
    numbers.add(order.number);
    const scraps = scrapGroups.get(order.id) || [];
    validateScrapRules(scraps, order.product_id, rows);
    if (expanded) validateExpansionScraps(scraps, nodes);
    if (new Set(scraps.map(row => row.position)).size !== scraps.length) fail('备份生产废料排序重复。');
    for (const row of scraps) {
      if (products.get(row.product_id)?.warehouse_id !== order.warehouse_id || typeof row.quantity_fraction !== 'string' ||
          !text(row.name, 100, true) || !text(row.barcode, 100, true) || !text(row.specification, 500) ||
          !Number.isSafeInteger(row.position) || row.position < 0 || row.position >= 100 ||
          row.planned_quantity !== scrapExpectedQuantity(row, order.planned_quantity, order.base_quantity, rows.map(item => ({ product_id: item.product_id, quantity: item.planned_quantity }))) ||
          (completed ? !validQuantity(row.actual_quantity) || !(batches.length ? ['stock', 'discard', 'mixed'] : ['stock', 'discard']).includes(row.disposition) ||
            (!batches.length && row.expected_quantity !== scrapExpectedQuantity(row, order.completed_quantity, order.base_quantity, rows.map(item => ({ product_id: item.product_id, quantity: item.actual_quantity }))))
            : row.actual_quantity !== null || row.expected_quantity !== null || row.disposition !== null))
        fail('备份生产废料数量、处理方式或快照无效。');
    }
    for (const row of rows) {
      if (!expanded) validateBomLossRate(row.loss_rate);
      else {
        if (row.base_quantity !== null || row.base_quantity_fraction !== null || row.loss_rate !== null) fail('多层生产材料不能伪造单层基准用量。');
        const expected = expanded.rows[row.position];
        if (!expected || ['product_id','name','barcode','specification','unit','note'].some(key => row[key] !== expected[key])) fail('备份生产材料与节点来源快照不一致。');
      }
      if (products.get(row.product_id)?.warehouse_id !== order.warehouse_id || row.product_id === order.product_id ||
          !text(row.name, 100, true) || !text(row.barcode, 100, true) || !text(row.specification, 500) || !text(row.unit, 100, true) || !text(row.note, 200) || !text(row.variance_reason, 500) || (!completed && row.variance_reason !== '') ||
          !Number.isSafeInteger(row.position) || row.position < 0 || row.position >= (expanded ? 500 : 100) || (!expanded && !validQuantity(row.base_quantity, true)) ||
          row.planned_quantity !== (expanded ? expanded.rows.find(item => item.product_id === row.product_id)?.required : productionPlannedQuantity(row.base_quantity, order.planned_quantity, order.base_quantity, row.base_quantity_fraction, row.loss_rate, order.loss_method)) ||
          (completed ? !validQuantity(row.actual_quantity) || !money(row.cost_cents) || row.actual_quantity === 0 && row.cost_cents !== 0 : row.actual_quantity !== null || row.cost_cents !== null))
        fail('备份生产材料数量、成本或快照无效。');
    }
    if (completed && (!rows.some(row => row.actual_quantity > 0) || rows.reduce((sum, row) => sum + row.cost_cents, 0) !== order.total_cost_cents))
      fail('备份生产材料与成品成本不一致。');
    if (batches.length) {
      const counted = summaryBatches({ ...order, batches }), latest = counted.at(-1);
      const totals = productionBatchSummary(rows, scraps, counted);
      if ((order.status === 'void' && batches.some(batch => batch.status === 'active')) ||
          order.completed_quantity !== (latest ? totals.completed_quantity : null) || order.total_cost_cents !== (latest ? totals.total_cost_cents : null) ||
          order.completed_at !== (latest?.created_at ?? null) || order.completed_by_name !== (latest?.created_by_name ?? '') ||
          totals.items.some(item => { const row = rows.find(row => row.product_id === item.product_id); return row.actual_quantity !== (latest ? item.actual_quantity : null) || row.cost_cents !== (latest ? item.cost_cents : null) || row.variance_reason !== item.variance_reason; }) ||
          totals.scraps.some(item => { const row = scraps.find(row => row.product_id === item.product_id); return row.actual_quantity !== (latest ? item.actual_quantity : null) || row.expected_quantity !== (latest ? item.expected_quantity : null) || row.disposition !== item.disposition; }))
        fail('备份生产单累计记录与有效批次不一致。');
    }
  }
}

function validateBatchBackup(data, orders, itemGroups, scrapGroups) {
  const batches = new Map(data.production_batches.map(batch => [batch.id, batch])), grouped = new Map();
  const children = table => {
    const groups = new Map();
    for (const row of data[table]) {
      if (!batches.has(row.batch_id)) fail('备份完工批次明细关联无效。');
      const rows = groups.get(row.batch_id) || []; rows.push(row); groups.set(row.batch_id, rows);
    }
    return groups;
  };
  const items = children('production_batch_items'), scraps = children('production_batch_scraps');
  const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
  const date = value => text(value, 100, true) && Number.isFinite(Date.parse(value));
  const money = value => Number.isSafeInteger(value) && value >= 0;
  for (const batch of batches.values()) {
    const order = orders.get(batch.production_id), materials = itemGroups.get(batch.production_id) || [], rules = scrapGroups.get(batch.production_id) || [];
    const rows = items.get(batch.id) || [], outputs = scraps.get(batch.id) || [];
    if (!order || !isId(batch.batch_number) || batch.batch_number > 1000 || !['active', 'void'].includes(batch.status) ||
        !validQuantity(batch.completed_quantity, true) || !money(batch.total_cost_cents) || !text(batch.note, 500) || !text(batch.created_by_name, 60, true) || !date(batch.created_at) ||
        !text(batch.voided_by_name, 60) || !text(batch.void_reason, 500) || ![0, 1].includes(batch.voided_with_order) ||
        (batch.status === 'void' ? !date(batch.voided_at) || !batch.void_reason.trim() || !batch.voided_by_name.trim() : batch.voided_at !== null || batch.void_reason !== '' || batch.voided_by_name !== '' || batch.voided_with_order !== 0) ||
        (batch.voided_with_order === 1 && (order.status !== 'void' || batch.voided_at !== order.voided_at || batch.void_reason !== order.void_reason || batch.voided_by_name !== order.voided_by_name)))
      fail('备份完工批次字段或状态无效。');
    validateProductionCompletion({ completed_quantity: batch.completed_quantity, items: rows.map(row => ({ ...row, quantity: row.actual_quantity })) }, materials);
    if (rows.some(row => !money(row.cost_cents) || row.actual_quantity === 0 && row.cost_cents !== 0 || !text(row.variance_reason, 500)) ||
        rows.reduce((sum, row) => sum + row.cost_cents, 0) !== batch.total_cost_cents)
      fail('备份完工批次材料成本或差异原因无效。');
    validateScrapActuals(outputs.map(row => ({ ...row, quantity: row.actual_quantity })), rules);
    for (const row of outputs) {
      const rule = rules.find(rule => rule.product_id === row.product_id);
      if (row.expected_quantity !== scrapExpectedQuantity(rule, batch.completed_quantity, order.base_quantity, rows.map(item => ({ product_id: item.product_id, quantity: item.actual_quantity }))))
        fail('备份完工批次预计废料与规则不一致。');
    }
    const list = grouped.get(order.id) || [];
    if (list.some(row => row.batch_number === batch.batch_number)) fail('备份完工批次序号重复。');
    list.push({ ...batch, items: rows, scraps: outputs }); grouped.set(order.id, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.batch_number - b.batch_number);
  return grouped;
}
