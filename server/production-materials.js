import { randomUUID } from 'node:crypto';
import { allocate, moveInventory } from './commerce.js';
import { addQuantity, validQuantity, validStoredQuantity, materialQuantity } from '../shared/quantity.js';
import { hasPermission } from '../shared/permissions.js';
import { notifyStockChanges } from './notifications.js';

export const productionMaterialTables = ['production_material_documents', 'production_material_document_items'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const actor = req => req.user.name || req.user.username;
const isId = id => Number.isSafeInteger(id) && id > 0;
const direction = type => type === 'in' ? 'purchase' : 'sale';

export function migrateProductionMaterials(db) {
  const columns = db.prepare('PRAGMA table_info(production_orders)').all().map(c => c.name);
  if (!columns.includes('material_workflow')) db.exec('ALTER TABLE production_orders ADD COLUMN material_workflow INTEGER NOT NULL DEFAULT 0 CHECK(material_workflow IN (0,1))');
  if (!columns.includes('material_phase')) db.exec("ALTER TABLE production_orders ADD COLUMN material_phase TEXT NOT NULL DEFAULT 'draft' CHECK(material_phase IN ('draft','awaiting_materials','in_progress'))");
  db.exec(`CREATE TABLE IF NOT EXISTS production_material_documents (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    production_id INTEGER NOT NULL REFERENCES production_orders(id), production_number TEXT NOT NULL,
    product_name TEXT NOT NULL, unit TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('in','out')),
    kind TEXT NOT NULL CHECK(kind IN ('initial','supplement','return')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled')),
    note TEXT NOT NULL DEFAULT '', total_cost_cents INTEGER, version INTEGER NOT NULL DEFAULT 1,
    created_by_name TEXT NOT NULL, confirmed_by_name TEXT NOT NULL DEFAULT '', cancelled_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, confirmed_at TEXT, cancelled_at TEXT, cancel_reason TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS production_material_document_items (
    id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES production_material_documents(id),
    product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL, specification TEXT NOT NULL,
    unit TEXT NOT NULL, unit_round_up INTEGER NOT NULL CHECK(unit_round_up IN (0,1)), quantity REAL NOT NULL, cost_cents INTEGER,
    UNIQUE(document_id,product_id));
    CREATE INDEX IF NOT EXISTS production_material_warehouse ON production_material_documents(warehouse_id,type,status,id);
    CREATE UNIQUE INDEX IF NOT EXISTS production_material_pending ON production_material_documents(production_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS production_material_product ON production_material_document_items(product_id);`);
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='production_version';
    UPDATE production_material_documents SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='production_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS production_material_version_insert AFTER INSERT ON production_material_documents BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS production_material_version_update AFTER UPDATE OF status ON production_material_documents BEGIN ${advance} END;`);
}

export function materialDocument(db, id, warehouseId) {
  const doc = db.prepare('SELECT * FROM production_material_documents WHERE id=? AND warehouse_id=?').get(id, warehouseId);
  if (!doc) fail('生产材料单不存在或不属于当前仓库。', 404);
  return { ...doc, items: db.prepare('SELECT * FROM production_material_document_items WHERE document_id=? ORDER BY id').all(id) };
}

export function materialDocuments(db, productionId, warehouseId) {
  return db.prepare('SELECT id FROM production_material_documents WHERE production_id=? ORDER BY id').all(productionId)
    .map(row => materialDocument(db, row.id, warehouseId));
}

export function materialBalances(order) {
  return order.items.map(item => {
    let issued = 0, returned = 0, cost = 0n;
    for (const doc of order.material_documents) if (doc.status === 'confirmed') {
      const row = doc.items.find(row => row.product_id === item.product_id);
      if (!row) continue;
      if (doc.type === 'out') { issued = addQuantity(issued, row.quantity); cost += BigInt(row.cost_cents); }
      else { returned = addQuantity(returned, row.quantity); cost -= BigInt(row.cost_cents); }
    }
    let consumed = 0;
    for (const batch of order.batches) if (batch.status === 'active') {
      const row = batch.items.find(row => row.product_id === item.product_id);
      if (row) { consumed = addQuantity(consumed, row.actual_quantity); cost -= BigInt(row.cost_cents); }
    }
    // Lifetime turnover can exceed Number's exact range even when the remaining pool is small.
    if (cost < 0n || cost > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${item.name}材料余额成本不足或超出范围。`);
    return { ...item, issued_quantity: issued, returned_quantity: returned,
      available_quantity: addQuantity(addQuantity(issued, -returned), -consumed), available_cost_cents: Number(cost) };
  });
}

export function hasPendingMaterials(db, orderId) {
  return !!db.prepare("SELECT 1 FROM production_material_documents WHERE production_id=? AND status='pending'").get(orderId);
}

export function assertNoPendingMaterials(db, order) {
  if (order.material_workflow && hasPendingMaterials(db, order.id)) fail('请先确认或取消待批准的生产材料单。', 409);
}

export function installProductionMaterials(app, db, { route, current, version, units }) {
  const touch = (order, req, phase = order.material_phase) => db.prepare('UPDATE production_orders SET material_phase=?,updated_by_name=?,updated_at=? WHERE id=?')
    .run(phase, actor(req), new Date().toISOString(), order.id);
  const create = (req, order, type, kind, items, note) => {
    assertNoPendingMaterials(db, order);
    const at = new Date().toISOString(), number = `${type === 'out' ? 'SCLL' : 'SCTL'}${at.slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const id = Number(db.prepare(`INSERT INTO production_material_documents(number,warehouse_id,production_id,production_number,product_name,unit,type,kind,note,created_by_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, req.warehouse.id, order.id, order.number, order.product_name, order.unit, type, kind, note, actor(req), at, at).lastInsertRowid);
    for (const row of items) {
      const item = order.items.find(item => item.product_id === row.product_id);
      db.prepare(`INSERT INTO production_material_document_items(document_id,product_id,name,barcode,specification,unit,unit_round_up,quantity)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, item.product_id, item.name, item.barcode, item.specification, item.unit, item.unit_round_up, row.quantity);
    }
    touch(order, req, kind === 'initial' ? 'awaiting_materials' : order.material_phase);
  };
  app.post('/api/production-orders/:id/start', route(req => {
    const order = current(req); version(req, order);
    if (!order.material_workflow || order.status !== 'draft' || order.batches.length) fail('仅新流程待生产单可以开始生产。', 409);
    units(order);
    create(req, order, 'out', 'initial', order.items.map(item => ({ product_id: item.product_id, quantity: item.planned_quantity })), '');
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/material-requests', route(req => {
    const order = current(req); version(req, order);
    const { type, items, note = '' } = req.body;
    if (!order.material_workflow || !['in_progress', 'completed'].includes(order.status) || type === 'out' && order.status === 'completed')
      fail('仅生产中的单据可补料，生产中或已完成单据可退料。', 409);
    assertNoPendingMaterials(db, order);
    if (!['in','out'].includes(type) || !Array.isArray(items) || !items.length || items.length > order.items.length || new Set(items.map(row => row?.product_id)).size !== items.length)
      fail('请核对补料或退料方向及材料明细，材料不能重复。');
    if (typeof note !== 'string' || note.length > 500) fail('申请备注最多 500 字。');
    units(order);
    const normalized = items.map(row => {
      const item = order.items.find(item => item.product_id === row?.product_id);
      if (!item || !validQuantity(row.quantity, true)) fail('材料需属于本生产单，申请数量需为正数且最多 4 位小数。');
      const quantity = materialQuantity(row.quantity, item);
      if (type === 'in' && quantity > item.available_quantity) fail(`${item.name}退料超过已领未耗余额。`);
      return { product_id: item.product_id, quantity };
    });
    create(req, order, type, type === 'out' ? 'supplement' : 'return', normalized, note.trim());
    return current(req);
  }, true));
  app.get('/api/production-material-documents', route(req => {
    const { type, status = 'all', q = '', offset = '0', limit = '20' } = req.query;
    if (!['in','out'].includes(type) || !['all','pending','confirmed','cancelled'].includes(status) || typeof q !== 'string' || q.length > 100 ||
        typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
        typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail('生产材料单筛选或分页参数无效。');
    if (!hasPermission(req.user, direction(type))) fail('无此方向的仓库权限。', 403);
    const clauses = ['warehouse_id=?','type=?'], params = [req.warehouse.id, type];
    if (status !== 'all') { clauses.push('status=?'); params.push(status); }
    if (q.trim()) { clauses.push("(number LIKE ? ESCAPE '\\' OR production_number LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\')"); params.push(...Array(3).fill(`%${q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`)); }
    const where = clauses.join(' AND '), total = db.prepare(`SELECT COUNT(*) n FROM production_material_documents WHERE ${where}`).get(...params).n;
    const docs = db.prepare(`SELECT id FROM production_material_documents WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
    return { documents: docs.map(row => materialDocument(db, row.id, req.warehouse.id)), total, has_more: Number(offset) + docs.length < total };
  }));
  for (const action of ['confirm','cancel']) app.post(`/api/production-material-documents/:id/${action}`, route(req => {
    const id = Number(req.params.id);
    if (!isId(id)) fail('生产材料单编号无效。');
    const doc = materialDocument(db, id, req.warehouse.id);
    if (!hasPermission(req.user, direction(doc.type)) && !(action === 'cancel' && hasPermission(req.user, 'production'))) fail('无此方向的仓库权限。', 403);
    if (!isId(req.body.version) || req.body.version !== doc.version || doc.status !== 'pending') fail('材料单已变化，请刷新后核对。', 409);
    const order = current({ ...req, params: { id: String(doc.production_id) } });
    const at = new Date().toISOString();
    if (action === 'cancel') {
      if (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500) fail('请填写取消原因（最多 500 字）。');
      db.prepare("UPDATE production_material_documents SET status='cancelled',cancel_reason=?,cancelled_by_name=?,cancelled_at=?,updated_at=? WHERE id=?")
        .run(req.body.reason.trim(), actor(req), at, at, id);
      touch(order, req, doc.kind === 'initial' ? 'draft' : order.material_phase);
    } else {
      if (!order.material_workflow || order.status === 'void' || doc.type === 'out' && (doc.kind === 'initial' ? order.status !== 'awaiting_materials' : order.status !== 'in_progress')) fail('生产单状态不允许确认此材料单。', 409);
      const before = doc.items.map(row => db.prepare('SELECT * FROM products WHERE id=?').get(row.product_id));
      let total = 0;
      for (const row of doc.items) {
        const item = order.items.find(item => item.product_id === row.product_id), product = before.find(p => p.id === row.product_id);
        if (!item || product.warehouse_id !== req.warehouse.id || row.unit !== product.unit || row.unit_round_up !== product.unit_round_up) fail(`${row.name}单位或取整规则已变化，请取消后重新核对。`, 409);
        if (!product.active) fail(`${row.name}已停用，请先核对物料。`);
        if (doc.type === 'out' && row.quantity > product.stock) fail(`${row.name}库存不足，无法整单出库。`);
        if (doc.type === 'out' && (!validStoredQuantity(addQuantity(item.issued_quantity, row.quantity)) || !validStoredQuantity(addQuantity(item.available_quantity, row.quantity)))) fail(`${row.name}累计领料或材料余额超出数量上限。`);
        if (doc.type === 'in' && row.quantity > item.available_quantity) fail(`${row.name}退料超过当前已领未耗余额，请取消后重新申请。`);
        const cost = doc.type === 'out' ? moveInventory(db, row.product_id, -row.quantity)
          : allocate(item.available_cost_cents, row.quantity, item.available_quantity);
        if (doc.type === 'out' && !Number.isSafeInteger(item.available_cost_cents + cost)) fail(`${row.name}材料余额成本超出范围。`);
        if (doc.type === 'in') moveInventory(db, row.product_id, row.quantity, cost);
        db.prepare('UPDATE production_material_document_items SET cost_cents=? WHERE id=?').run(cost, row.id);
        total += cost; if (!Number.isSafeInteger(total)) fail('材料成本超出范围。');
      }
      db.prepare("UPDATE production_material_documents SET status='confirmed',total_cost_cents=?,confirmed_by_name=?,confirmed_at=?,updated_at=? WHERE id=?")
        .run(total, actor(req), at, at, id);
      touch(order, req, doc.kind === 'initial' ? 'in_progress' : order.material_phase);
      notifyStockChanges(db, req, before, { production_id: order.id, number: doc.number, material_document_id: id });
    }
    return materialDocument(db, id, req.warehouse.id);
  }, true, req => {
    // Cached idempotent responses still require the document's current direction permission.
    const doc = materialDocument(db, Number(req.params.id), req.warehouse.id);
    if (!hasPermission(req.user, direction(doc.type)) && !(action === 'cancel' && hasPermission(req.user, 'production'))) fail('无此方向的仓库权限。', 403);
  }));
}

export function validateProductionMaterialBackup(data) {
  const orders = new Map(data.production_orders.map(row => [row.id, row])), products = new Map(data.products.map(row => [row.id, row]));
  const docs = new Map(), pending = new Set(), numbers = new Set(), keys = new Set();
  const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
  const date = value => text(value, 100, true) && Number.isFinite(Date.parse(value));
  const money = value => Number.isSafeInteger(value) && value >= 0;
  for (const doc of data.production_material_documents) {
    const order = orders.get(doc.production_id);
    if (!order || !order.material_workflow || doc.warehouse_id !== order.warehouse_id || doc.production_number !== order.number || doc.product_name !== order.product_name || doc.unit !== order.unit ||
        !isId(doc.version) || !text(doc.number, 100, true) || !/^SC(LL|TL)\d{8}-[a-f0-9]{12}$/.test(doc.number) || numbers.has(doc.number) ||
        !['in','out'].includes(doc.type) || !['initial','supplement','return'].includes(doc.kind) || (doc.type === 'in') !== (doc.kind === 'return') ||
        !['pending','confirmed','cancelled'].includes(doc.status) || !text(doc.note, 500) || !text(doc.created_by_name, 60, true) || !date(doc.created_at) || !date(doc.updated_at) ||
        !text(doc.confirmed_by_name, 60) || !text(doc.cancelled_by_name, 60) || !text(doc.cancel_reason, 500) ||
        (doc.status === 'confirmed' ? !money(doc.total_cost_cents) || !date(doc.confirmed_at) || !doc.confirmed_by_name.trim() : doc.total_cost_cents !== null || doc.confirmed_at !== null || doc.confirmed_by_name !== '') ||
        (doc.status === 'cancelled' ? !date(doc.cancelled_at) || !doc.cancelled_by_name.trim() || !doc.cancel_reason.trim() : doc.cancelled_at !== null || doc.cancelled_by_name !== '' || doc.cancel_reason !== '') ||
        doc.status === 'pending' && (pending.has(order.id) || order.status === 'void' || doc.type === 'out' && order.status === 'completed')) fail('备份生产材料单状态或关联无效。');
    if (doc.status === 'pending') pending.add(order.id);
    numbers.add(doc.number); docs.set(doc.id, { ...doc, items: [] });
  }
  for (const row of data.production_material_document_items) {
    const doc = docs.get(row.document_id), order = doc && orders.get(doc.production_id);
    const item = order && data.production_items.find(item => item.production_id === order.id && item.product_id === row.product_id);
    if (!doc || !item || products.get(row.product_id)?.warehouse_id !== order.warehouse_id || !validQuantity(row.quantity, true) ||
        ['name','barcode','specification','unit','unit_round_up'].some(key => row[key] !== item[key]) ||
        ![0,1].includes(row.unit_round_up) || row.unit_round_up && !Number.isInteger(row.quantity) ||
        (doc.status === 'confirmed' ? !money(row.cost_cents) : row.cost_cents !== null) || keys.has(`${doc.id}:${row.product_id}`)) fail('备份生产材料单明细无效。');
    keys.add(`${doc.id}:${row.product_id}`); doc.items.push(row);
  }
  for (const doc of docs.values()) if (!doc.items.length || doc.status === 'confirmed' && doc.items.reduce((sum, row) => sum + row.cost_cents, 0) !== doc.total_cost_cents) fail('备份生产材料单成本合计无效。');
  for (const order of orders.values()) {
    if (![0,1].includes(order.material_workflow) || !['draft','awaiting_materials','in_progress'].includes(order.material_phase) || !order.material_workflow && order.material_phase !== 'draft') fail('备份生产领料阶段无效。');
    if (!order.material_workflow) continue;
    const documents = [...docs.values()].filter(doc => doc.production_id === order.id);
    const initial = documents.filter(doc => doc.kind === 'initial' && doc.status === 'confirmed');
    const awaiting = documents.filter(doc => doc.kind === 'initial' && doc.status === 'pending');
    if (initial.length > 1 || (order.material_phase === 'in_progress') !== (initial.length === 1) ||
        (order.material_phase === 'awaiting_materials') !== (awaiting.length === 1) ||
        documents.some(doc => doc.status === 'pending' && doc.kind !== 'initial' && order.material_phase !== 'in_progress') ||
        order.material_phase !== 'in_progress' && (order.completed_at || documents.some(doc => doc.status === 'confirmed')) ||
        order.status === 'void' && pending.has(order.id)) fail('备份生产领料阶段与材料单不一致。');
    for (const doc of documents.filter(doc => doc.kind === 'initial')) {
      const items = data.production_items.filter(row => row.production_id === order.id);
      // Cancelled initial requests can predate an editable plan change.
      if (doc.status !== 'cancelled' && (doc.items.length !== items.length || doc.items.some(row => row.quantity !== items.find(item => item.product_id === row.product_id)?.planned_quantity))) fail('备份首次领料数量与整单计划不一致。');
    }
    const balances = materialBalances({ ...order, items: data.production_items.filter(row => row.production_id === order.id), material_documents: documents,
      batches: data.production_batches.filter(row => row.production_id === order.id).map(batch => ({ ...batch, items: data.production_batch_items.filter(row => row.batch_id === batch.id) })) });
    if (balances.some(item => !validStoredQuantity(item.issued_quantity) || !validStoredQuantity(item.returned_quantity) || !validStoredQuantity(item.available_quantity) || !money(item.available_cost_cents) ||
        item.available_quantity === 0 && item.available_cost_cents !== 0 || order.status === 'void' && item.available_quantity !== 0)) fail('备份生产材料余额或成本无效。');
  }
}
