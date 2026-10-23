import { randomUUID } from 'node:crypto';
import { getBom, listBoms, calculateBom } from './bom.js';
import { operationRequest, saveOperationRequest } from './operations.js';
import { moveInventory } from './commerce.js';
import { notifyStockChanges } from './notifications.js';
import { hasPermission } from '../shared/permissions.js';
import { validQuantity } from '../shared/quantity.js';
import { validateProductionPlan, validateProductionCompletion, productionPlannedQuantity } from '../shared/production.js';

export const productionTables = ['production_orders', 'production_items'];
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
    CREATE INDEX IF NOT EXISTS production_warehouse ON production_orders(warehouse_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS production_product ON production_orders(product_id);
    CREATE INDEX IF NOT EXISTS production_item_product ON production_items(product_id);
    INSERT OR IGNORE INTO app_metadata(key,value) VALUES ('production_version','0');
    UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM production_orders)) WHERE key='production_version';`);
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='production_version';
    UPDATE production_orders SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='production_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS production_version_insert AFTER INSERT ON production_orders BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS production_version_update AFTER UPDATE OF planned_quantity,note,status,updated_at ON production_orders BEGIN ${advance} END;`);
}

export function clearProduction(db) { db.exec('DELETE FROM production_items; DELETE FROM production_orders;'); }

export function listProductionOrders(db, warehouseId, query = {}, costs = false) {
  const { q = '', status = 'all', offset = '0', limit = '30' } = query;
  if (typeof q !== 'string' || q.length > 100 || !['all', 'draft', 'completed', 'void'].includes(status) ||
      typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
      typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)
    fail('生产单筛选或分页参数无效。');
  return snapshot(db, () => {
    const clauses = ['warehouse_id=?'], params = [warehouseId];
    if (status !== 'all') { clauses.push('status=?'); params.push(status); }
    if (q.trim()) { clauses.push("(number LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\' OR bom_name LIKE ? ESCAPE '\\')"); params.push(...Array(4).fill(pattern(q.trim()))); }
    const where = clauses.join(' AND '), total = db.prepare(`SELECT COUNT(*) AS n FROM production_orders WHERE ${where}`).get(...params).n;
    const orders = db.prepare(`SELECT * FROM production_orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
    const result = { orders, total, has_more: Number(offset) + orders.length < total, next_offset: Number(offset) + orders.length };
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
    order.captured_at = new Date().toISOString();
    return costs ? order : productionWithoutCosts(order);
  });
}

function prepareProduction(db, req) {
  if (!isId(req.body.bom_id) || !isId(req.body.bom_version)) fail('请选择用料清单并核对版本。');
  return snapshot(db, () => calculateBom(db, req.warehouse, req.body.bom_id, req.body.planned_quantity, req.body.bom_version));
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
    if (!isId(req.body.version) || req.body.version !== order.version) fail('生产单已变化，请重新读取后核对。当前填写内容已保留。', 409);
  };
  const draft = (req, order) => { version(req, order); if (order.status !== 'draft') fail('仅待生产的单据可以编辑或完工。', 409); };
  const stockBefore = order => [order.product_id, ...order.items.map(item => item.product_id)]
    .map(id => db.prepare('SELECT * FROM products WHERE id=?').get(id));
  const units = (order, active = true) => {
    for (const row of [{ ...order, name: order.product_name }, ...order.items]) {
      if (row.unit !== row.product.unit) fail(active
        ? `${row.name}单位已变化，请作废此草稿并按核对后的用料清单重新建单。`
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
    const at = new Date().toISOString(), owner = actor(req), number = `SC${at.slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const id = Number(db.prepare(`INSERT INTO production_orders(number,warehouse_id,bom_id,bom_version,bom_name,
      product_id,product_name,barcode,specification,unit,base_quantity,planned_quantity,note,
      created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(number, req.warehouse.id, bom.id, bom.version, bom.name, bom.product_id, bom.product.name, bom.product.barcode,
        bom.product.specification, bom.base_unit, bom.base_quantity, req.body.planned_quantity, req.body.note.trim(), owner, owner, at, at).lastInsertRowid);
    const insert = db.prepare(`INSERT INTO production_items(production_id,product_id,name,barcode,specification,unit,base_quantity,planned_quantity,note,position) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    plan.rows.forEach((row, index) => insert.run(id, row.product_id, row.name, row.barcode, row.specification, row.unit, row.quantity, row.required, row.note, index));
    return getProductionOrder(db, req.warehouse.id, id, true);
  }, true));
  app.post('/api/production-orders/:id', route(req => {
    const order = current(req); draft(req, order); validateProductionPlan(req.body);
    for (const item of order.items) db.prepare('UPDATE production_items SET planned_quantity=? WHERE id=?')
      .run(productionPlannedQuantity(item.base_quantity, req.body.planned_quantity, order.base_quantity), item.id);
    db.prepare('UPDATE production_orders SET planned_quantity=?,note=?,updated_by_name=?,updated_at=? WHERE id=?')
      .run(req.body.planned_quantity, req.body.note.trim(), actor(req), new Date().toISOString(), order.id);
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/complete', route(req => {
    const order = current(req); draft(req, order); units(order);
    validateProductionCompletion(req.body, order.items);
    const before = stockBefore(order);
    const actuals = new Map(req.body.items.map(item => [item.product_id, item.quantity]));
    let total = 0;
    for (const item of order.items) {
      const quantity = actuals.get(item.product_id);
      if (quantity > item.product.stock) fail(`${item.name}库存不足（当前 ${item.product.stock} ${item.unit}）。请补料或核对实际耗料。`);
      const cost = quantity ? moveInventory(db, item.product_id, -quantity) : 0;
      total += cost;
      if (!Number.isSafeInteger(total)) fail('本次材料成本超出范围，请拆分生产单。');
      db.prepare('UPDATE production_items SET actual_quantity=?,cost_cents=? WHERE id=?').run(quantity, cost, item.id);
    }
    moveInventory(db, order.product_id, req.body.completed_quantity, total);
    const at = new Date().toISOString(), owner = actor(req);
    db.prepare("UPDATE production_orders SET status='completed',completed_quantity=?,total_cost_cents=?,completed_by_name=?,completed_at=?,updated_by_name=?,updated_at=? WHERE id=?")
      .run(req.body.completed_quantity, total, owner, at, owner, at, order.id);
    notifyStockChanges(db, req, before, { production_id: order.id, number: order.number });
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/void', route(req => {
    const order = current(req); version(req, order);
    if (order.status === 'void') fail('生产单已经作废。', 409);
    if (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500) fail('请填写作废原因（最多 500 字）。');
    const before = order.completed_at ? stockBefore(order) : [];
    if (order.status === 'completed') {
      units(order, false);
      try {
        moveInventory(db, order.product_id, -order.completed_quantity, order.total_cost_cents);
        for (const item of order.items) if (item.actual_quantity) moveInventory(db, item.product_id, item.actual_quantity, item.cost_cents);
      } catch (error) { fail(`无法回退库存和原成本：${error.message} 请先核对后续业务。`); }
    }
    const at = new Date().toISOString(), owner = actor(req);
    db.prepare("UPDATE production_orders SET status='void',void_reason=?,voided_by_name=?,voided_at=?,updated_by_name=?,updated_at=? WHERE id=?")
      .run(req.body.reason.trim(), owner, at, owner, at, order.id);
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
  for (const order of orders.values()) {
    const rows = grouped.get(order.id) || [], completed = order.completed_at !== null;
    validateProductionPlan(order);
    if (!['draft', 'completed', 'void'].includes(order.status) || !isId(order.version) || !isId(order.bom_version) ||
        !text(order.number, 100, true) || !/^SC\d{8}-[a-f0-9]{12}$/.test(order.number) || numbers.has(order.number) || !text(order.bom_name, 100, true) ||
        boms.get(order.bom_id)?.warehouse_id !== order.warehouse_id || products.get(order.product_id)?.warehouse_id !== order.warehouse_id ||
        !text(order.product_name, 100, true) || !text(order.barcode, 100, true) || !text(order.specification, 500) || !text(order.unit, 100, true) ||
        !validQuantity(order.base_quantity, true) || !rows.length || rows.length > 100 ||
        new Set(rows.map(row => row.product_id)).size !== rows.length || new Set(rows.map(row => row.position)).size !== rows.length ||
        !text(order.created_by_name, 60, true) || !text(order.updated_by_name, 60, true) || !date(order.created_at) || !date(order.updated_at) ||
        !text(order.completed_by_name, 60) || !text(order.voided_by_name, 60) || !text(order.void_reason, 500) ||
        (order.status === 'void' ? !date(order.voided_at) || !order.void_reason.trim() || !order.voided_by_name.trim() : order.voided_at !== null || order.void_reason !== '' || order.voided_by_name !== '') ||
        (order.status === 'draft' && completed) || (order.status === 'completed' && !completed) ||
        (completed ? !date(order.completed_at) || !order.completed_by_name.trim() || !validQuantity(order.completed_quantity, true) || !money(order.total_cost_cents)
          : order.completed_quantity !== null || order.total_cost_cents !== null || order.completed_by_name !== ''))
      fail('备份生产单字段、状态或关联无效。');
    numbers.add(order.number);
    for (const row of rows) {
      if (products.get(row.product_id)?.warehouse_id !== order.warehouse_id || row.product_id === order.product_id ||
          !text(row.name, 100, true) || !text(row.barcode, 100, true) || !text(row.specification, 500) || !text(row.unit, 100, true) || !text(row.note, 200) ||
          !Number.isSafeInteger(row.position) || row.position < 0 || row.position >= 100 || !validQuantity(row.base_quantity, true) ||
          row.planned_quantity !== productionPlannedQuantity(row.base_quantity, order.planned_quantity, order.base_quantity) ||
          (completed ? !validQuantity(row.actual_quantity) || !money(row.cost_cents) || row.actual_quantity === 0 && row.cost_cents !== 0 : row.actual_quantity !== null || row.cost_cents !== null))
        fail('备份生产材料数量、成本或快照无效。');
    }
    if (completed && (!rows.some(row => row.actual_quantity > 0) || rows.reduce((sum, row) => sum + row.cost_cents, 0) !== order.total_cost_cents))
      fail('备份生产材料与成品成本不一致。');
  }
}
