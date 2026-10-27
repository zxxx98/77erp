import { randomUUID } from 'node:crypto';
import { allocate, moveInventory } from './commerce.js';
import { addQuantity, validQuantity, validStoredQuantity, materialQuantity } from '../shared/quantity.js';
import { hasPermission } from '../shared/permissions.js';
import { notifyStockChanges } from './notifications.js';
import { stageDirectBatches } from './production-stages.js';

export const productionMaterialTables = ['production_material_documents', 'production_material_document_items', 'production_material_issues', 'production_material_issue_items'];
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
  db.exec('SAVEPOINT production_material_issues_migration');
  try {
    const hasIssues = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_material_issues'").get();
    db.exec(`CREATE TABLE IF NOT EXISTS production_material_issues (
      id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES production_material_documents(id),
      number TEXT NOT NULL UNIQUE, total_cost_cents INTEGER NOT NULL,
      confirmed_by_name TEXT NOT NULL, confirmed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS production_material_issue_items (
      id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES production_material_issues(id),
      product_id INTEGER NOT NULL REFERENCES products(id), quantity REAL NOT NULL, cost_cents INTEGER NOT NULL,
      UNIQUE(issue_id,product_id));
      CREATE INDEX IF NOT EXISTS production_material_issue_document ON production_material_issues(document_id,id);
      CREATE INDEX IF NOT EXISTS production_material_issue_product ON production_material_issue_items(product_id);`);
    // Existing posted documents become one immutable issue without moving inventory again.
    if (!hasIssues) db.exec(`INSERT INTO production_material_issues(id,document_id,number,total_cost_cents,confirmed_by_name,confirmed_at)
      SELECT id,id,'SCFL' || substr(number,5),total_cost_cents,confirmed_by_name,confirmed_at FROM production_material_documents WHERE type='out' AND status='confirmed';
      INSERT INTO production_material_issue_items(id,issue_id,product_id,quantity,cost_cents)
      SELECT i.id,i.document_id,i.product_id,i.quantity,i.cost_cents FROM production_material_document_items i
      JOIN production_material_documents d ON d.id=i.document_id WHERE d.type='out' AND d.status='confirmed';`);
    db.exec('RELEASE production_material_issues_migration');
  } catch (error) {
    db.exec('ROLLBACK TO production_material_issues_migration; RELEASE production_material_issues_migration');
    throw error;
  }
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='production_version';
    UPDATE production_material_documents SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='production_version') WHERE id=NEW.id;`;
  db.exec('DROP TRIGGER IF EXISTS production_material_version_update');
  db.exec(`CREATE TRIGGER IF NOT EXISTS production_material_version_insert AFTER INSERT ON production_material_documents BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS production_material_version_update AFTER UPDATE OF status,updated_at ON production_material_documents BEGIN ${advance} END;`);
}

export function materialDocument(db, id, warehouseId) {
  const doc = db.prepare('SELECT * FROM production_material_documents WHERE id=? AND warehouse_id=?').get(id, warehouseId);
  if (!doc) fail('生产材料单不存在或不属于当前仓库。', 404);
  const group = db.prepare('SELECT production_group_id,production_group_name FROM production_orders WHERE id=?').get(doc.production_id);
  const issues = db.prepare('SELECT * FROM production_material_issues WHERE document_id=? ORDER BY id').all(id).map(issue => ({
    ...issue, items: db.prepare('SELECT * FROM production_material_issue_items WHERE issue_id=? ORDER BY id').all(issue.id),
  }));
  return materialDocumentProgress({ ...doc, ...group,
    items: db.prepare('SELECT * FROM production_material_document_items WHERE document_id=? ORDER BY id').all(id), issues });
}

export function materialDocumentProgress(doc) {
  const issued = (doc.issues ?? []).length > 0;
  return { ...doc, fulfillment_status: doc.type === 'in' ? doc.status : doc.status === 'pending' ? issued ? 'partial' : 'pending' : doc.status === 'cancelled' ? 'closed' : 'confirmed',
    items: doc.items.map(row => {
      const quantity = doc.type === 'out' ? (doc.issues ?? []).reduce((sum, issue) => addQuantity(sum, issue.items.find(item => item.product_id === row.product_id)?.quantity ?? 0), 0) : doc.status === 'confirmed' ? row.quantity : 0;
      const remaining = Math.max(0, addQuantity(row.quantity, -quantity));
      return { ...row, issued_quantity: quantity, pending_quantity: doc.status === 'pending' ? remaining : 0,
        closed_quantity: doc.status === 'cancelled' ? remaining : 0,
        over_issued_quantity: doc.type === 'out' ? Math.max(0, addQuantity(quantity, -row.quantity)) : 0 };
    }) };
}

// Used for old backup formats as well as the on-disk migration above.
export function migrateMaterialIssueBackup(data) {
  data.production_material_issues = [];
  data.production_material_issue_items = [];
  for (const doc of data.production_material_documents ?? []) if (doc.type === 'out' && doc.status === 'confirmed') {
    data.production_material_issues.push({ id: doc.id, document_id: doc.id, number: `SCFL${doc.number.slice(4)}`,
      total_cost_cents: doc.total_cost_cents, confirmed_by_name: doc.confirmed_by_name, confirmed_at: doc.confirmed_at });
    for (const row of data.production_material_document_items.filter(row => row.document_id === doc.id))
      data.production_material_issue_items.push({ id: row.id, issue_id: doc.id, product_id: row.product_id, quantity: row.quantity, cost_cents: row.cost_cents });
  }
}

export function materialDocuments(db, productionId, warehouseId) {
  return db.prepare('SELECT id FROM production_material_documents WHERE production_id=? ORDER BY id').all(productionId)
    .map(row => materialDocument(db, row.id, warehouseId));
}

export function materialBalances(order) {
  const documents = order.material_documents.map(materialDocumentProgress);
  return order.items.map(item => {
    let issued = 0, returned = 0, cost = 0n;
    let requested = 0, pending = 0, closed = 0;
    for (const doc of documents) {
      const row = doc.items.find(row => row.product_id === item.product_id);
      if (!row) continue;
      if (doc.type === 'out') {
        requested = addQuantity(requested, row.quantity);
        pending = addQuantity(pending, row.pending_quantity);
        closed = addQuantity(closed, row.closed_quantity);
        for (const issue of doc.issues ?? []) {
          const line = issue.items.find(row => row.product_id === item.product_id);
          if (line) { issued = addQuantity(issued, line.quantity); cost += BigInt(line.cost_cents); }
        }
      } else if (doc.status === 'confirmed') { returned = addQuantity(returned, row.quantity); cost -= BigInt(row.cost_cents); }
    }
    let consumed = 0;
    for (const batch of order.stage_workflow ? order.stage_direct_batches ?? [] : order.batches) if (batch.status === 'active') {
      for (const row of batch.items.filter(row => row.product_id === item.product_id)) {
        consumed = addQuantity(consumed, row.actual_quantity); cost -= BigInt(row.cost_cents);
      }
    }
    // Lifetime turnover can exceed Number's exact range even when the remaining pool is small.
    if (cost < 0n || cost > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${item.name}材料余额成本不足或超出范围。`);
    return { ...item, requested_quantity: requested, pending_issue_quantity: pending, closed_request_quantity: closed, issued_quantity: issued, returned_quantity: returned,
      over_plan_quantity: Math.max(0, addQuantity(issued, -item.planned_quantity)),
      ...(order.stage_workflow ? { direct_consumed_quantity:consumed, direct_consumed_cost_cents: Number(order.stage_direct_batches.filter(b=>b.status==='active').reduce((n,b)=>n+b.items.filter(r=>r.product_id===item.product_id).reduce((n,r)=>n+r.cost_cents,0),0)) } : {}),
      available_quantity: addQuantity(addQuantity(issued, -returned), -consumed), available_cost_cents: Number(cost) };
  });
}

export function hasPendingMaterials(db, orderId) {
  return !!db.prepare("SELECT 1 FROM production_material_documents WHERE production_id=? AND status='pending'").get(orderId);
}

export function assertNoPendingMaterials(db, order) {
  if (order.material_workflow && hasPendingMaterials(db, order.id)) fail('请先确认或取消待批准的生产材料单。', 409);
}

function normalizeItems(order, items, actual = false) {
  if (!Array.isArray(items) || !items.length || items.length > order.items.length || new Set(items.map(row => row?.product_id)).size !== items.length)
    fail('请核对材料明细，材料不能重复。');
  return items.map(row => {
    const item = order.items.find(item => item.product_id === row?.product_id);
    if (!item || !validQuantity(row.quantity, true)) fail('材料需属于本生产单，申请数量需为正数且最多 4 位小数。');
    if (actual && item.unit_round_up && !Number.isInteger(row.quantity)) fail('本次实发数量须符合材料整单位规则。');
    const quantity = materialQuantity(row.quantity, item);
    if (!validQuantity(quantity, true)) fail('材料数量超出范围。');
    return { product_id: item.product_id, quantity };
  });
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
    const { items = order.items.map(item => ({ product_id: item.product_id, quantity: item.planned_quantity })), note = '' } = req.body;
    const normalized = normalizeItems(order, items);
    if (typeof note !== 'string' || note.length > 500) fail('申请备注最多 500 字。');
    create(req, order, 'out', 'initial', normalized, note.trim());
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
    if (!['in','out'].includes(type) || !['all','pending','partial','confirmed','cancelled','closed'].includes(status) || typeof q !== 'string' || q.length > 100 ||
        typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
        typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail('生产材料单筛选或分页参数无效。');
    if (!hasPermission(req.user, direction(type))) fail('无此方向的仓库权限。', 403);
    const clauses = ['warehouse_id=?','type=?'], params = [req.warehouse.id, type];
    if (status === 'partial') clauses.push("status='pending' AND EXISTS (SELECT 1 FROM production_material_issues i WHERE i.document_id=production_material_documents.id)");
    else if (status !== 'all') { clauses.push('status=?'); params.push(status === 'closed' ? 'cancelled' : status); }
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
      touch(order, req, doc.kind === 'initial' && !doc.issues.length ? 'draft' : order.material_phase);
    } else {
      if (!order.material_workflow || order.status === 'void' || doc.type === 'out' && (doc.kind === 'initial' ? !['awaiting_materials', 'in_progress'].includes(order.status) : order.status !== 'in_progress')) fail('生产单状态不允许确认此材料单。', 409);
      const requested = doc.type === 'out'
        ? normalizeItems(order, req.body.items === undefined ? doc.items.filter(row => row.pending_quantity > 0).map(row => ({ product_id: row.product_id, quantity: row.pending_quantity })) : req.body.items, true)
        : doc.items;
      if (doc.type === 'in' && req.body.items !== undefined) fail('退料单需整单确认。');
      const rows = requested.map(row => {
        const source = doc.items.find(item => item.product_id === row.product_id);
        if (!source) fail('本次发料的材料需属于当前申请。');
        return { ...source, quantity: row.quantity };
      });
      const before = rows.map(row => db.prepare('SELECT * FROM products WHERE id=?').get(row.product_id));
      const issueNumber = `SCFL${at.slice(0, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const issueId = doc.type === 'out' ? Number(db.prepare(`INSERT INTO production_material_issues(document_id,number,total_cost_cents,confirmed_by_name,confirmed_at)
        VALUES (?,?,0,?,?)`).run(doc.id, issueNumber, actor(req), at).lastInsertRowid) : null;
      let total = 0;
      for (const row of rows) {
        const item = order.items.find(item => item.product_id === row.product_id), product = before.find(p => p.id === row.product_id);
        if (!item || product.warehouse_id !== req.warehouse.id || row.unit !== product.unit || row.unit_round_up !== product.unit_round_up) fail(`${row.name}单位或取整规则已变化，请取消后重新核对。`, 409);
        if (!product.active) fail(`${row.name}已停用，请先核对物料。`);
        if (doc.type === 'out' && row.quantity > product.stock) fail(`${row.name}库存不足，请核对本次实发数量。`);
        if (doc.type === 'out' && (!validStoredQuantity(addQuantity(item.issued_quantity, row.quantity)) || !validStoredQuantity(addQuantity(item.available_quantity, row.quantity)))) fail(`${row.name}累计领料或材料余额超出数量上限。`);
        if (doc.type === 'in' && row.quantity > item.available_quantity) fail(`${row.name}退料超过当前已领未耗余额，请取消后重新申请。`);
        const cost = doc.type === 'out' ? moveInventory(db, row.product_id, -row.quantity)
          : allocate(item.available_cost_cents, row.quantity, item.available_quantity);
        if (doc.type === 'out' && !Number.isSafeInteger(item.available_cost_cents + cost)) fail(`${row.name}材料余额成本超出范围。`);
        if (doc.type === 'in') {
          moveInventory(db, row.product_id, row.quantity, cost);
          db.prepare('UPDATE production_material_document_items SET cost_cents=? WHERE id=?').run(cost, row.id);
        } else db.prepare('INSERT INTO production_material_issue_items(issue_id,product_id,quantity,cost_cents) VALUES (?,?,?,?)').run(issueId, row.product_id, row.quantity, cost);
        total += cost; if (!Number.isSafeInteger(total)) fail('材料成本超出范围。');
      }
      if (issueId) db.prepare('UPDATE production_material_issues SET total_cost_cents=? WHERE id=?').run(total, issueId);
      const fresh = materialDocument(db, doc.id, req.warehouse.id);
      const allIssued = doc.type === 'in' || fresh.items.every(row => row.pending_quantity === 0);
      if (allIssued) {
        if (doc.type === 'out') {
          total = 0;
          for (const row of fresh.items) {
            const cost = fresh.issues.reduce((sum, issue) => sum + BigInt(issue.items.find(item => item.product_id === row.product_id)?.cost_cents ?? 0), 0n);
            if (cost > BigInt(Number.MAX_SAFE_INTEGER)) fail('材料成本超出范围。');
            db.prepare('UPDATE production_material_document_items SET cost_cents=? WHERE id=?').run(Number(cost), row.id);
            total += Number(cost);
          }
          if (!Number.isSafeInteger(total)) fail('材料成本超出范围。');
        }
        db.prepare("UPDATE production_material_documents SET status='confirmed',total_cost_cents=?,confirmed_by_name=?,confirmed_at=?,updated_at=? WHERE id=?")
          .run(total, actor(req), at, at, id);
      } else db.prepare('UPDATE production_material_documents SET updated_at=? WHERE id=?').run(at, id);
      touch(order, req, doc.kind === 'initial' ? 'in_progress' : order.material_phase);
      notifyStockChanges(db, req, before, { production_id: order.id, number: issueId ? issueNumber : doc.number, material_document_id: id, ...(issueId ? { material_issue_id: issueId } : {}) });
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
    numbers.add(doc.number); docs.set(doc.id, { ...doc, items: [], issues: [] });
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
  const issues = new Map(), issueNumbers = new Set(), issueKeys = new Set();
  for (const issue of data.production_material_issues) {
    const doc = docs.get(issue.document_id);
    if (!doc || doc.type !== 'out' || !money(issue.total_cost_cents) || !text(issue.confirmed_by_name,60,true) || !date(issue.confirmed_at) ||
        !/^SCFL\d{8}-[a-f0-9]{12}$/.test(issue.number) || issueNumbers.has(issue.number)) fail('备份生产发料记录无效。');
    issueNumbers.add(issue.number);
    const value = { ...issue, items: [] }; issues.set(issue.id, value); doc.issues.push(value);
  }
  for (const row of data.production_material_issue_items) {
    const issue = issues.get(row.issue_id), doc = issue && docs.get(issue.document_id), item = doc?.items.find(item => item.product_id === row.product_id);
    const key = `${row.issue_id}:${row.product_id}`;
    if (!item || !validQuantity(row.quantity,true) || item.unit_round_up && !Number.isInteger(row.quantity) || !money(row.cost_cents) || issueKeys.has(key)) fail('备份生产发料明细无效。');
    issueKeys.add(key); issue.items.push(row);
  }
  for (const issue of issues.values()) if (!issue.items.length || issue.items.reduce((sum,row) => sum + BigInt(row.cost_cents),0n) !== BigInt(issue.total_cost_cents)) fail('备份生产发料成本合计无效。');
  for (const doc of docs.values()) if (doc.type === 'out') {
    const progress = materialDocumentProgress(doc);
    if (doc.status === 'confirmed' && progress.items.some(row => row.issued_quantity < row.quantity) ||
        doc.status === 'pending' && progress.items.every(row => row.pending_quantity === 0)) fail('备份生产发料数量与申请不一致。');
    if (doc.status === 'confirmed' && doc.items.some(row =>
      doc.issues.reduce((sum,issue) => sum + BigInt(issue.items.find(item => item.product_id === row.product_id)?.cost_cents ?? 0),0n) !== BigInt(row.cost_cents))) fail('备份生产发料成本与申请不一致。');
  }
  for (const order of orders.values()) {
    if (![0,1].includes(order.material_workflow) || !['draft','awaiting_materials','in_progress'].includes(order.material_phase) || !order.material_workflow && order.material_phase !== 'draft') fail('备份生产领料阶段无效。');
    if (!order.material_workflow) continue;
    const documents = [...docs.values()].filter(doc => doc.production_id === order.id);
    const initial = documents.filter(doc => doc.kind === 'initial' && doc.issues.length > 0);
    const awaiting = documents.filter(doc => doc.kind === 'initial' && doc.status === 'pending' && !doc.issues.length);
    if (initial.length > 1 || (order.material_phase === 'in_progress') !== (initial.length === 1) ||
        (order.material_phase === 'awaiting_materials') !== (awaiting.length === 1) ||
        documents.some(doc => doc.status === 'pending' && doc.kind !== 'initial' && order.material_phase !== 'in_progress') ||
        order.material_phase !== 'in_progress' && (order.completed_at || documents.some(doc => doc.status === 'confirmed')) ||
        order.status === 'void' && pending.has(order.id)) fail('备份生产领料阶段与材料单不一致。');
    const balances = materialBalances({ ...order, items: data.production_items.filter(row => row.production_id === order.id), material_documents: documents,
      stage_direct_batches:stageDirectBatches(data,order.id),
      batches: data.production_batches.filter(row => row.production_id === order.id).map(batch => ({ ...batch, items: data.production_batch_items.filter(row => row.batch_id === batch.id) })) });
    if (balances.some(item => !validStoredQuantity(item.issued_quantity) || !validStoredQuantity(item.returned_quantity) || !validStoredQuantity(item.available_quantity) || !money(item.available_cost_cents) ||
        item.available_quantity === 0 && item.available_cost_cents !== 0 || order.status === 'void' && item.available_quantity !== 0)) fail('备份生产材料余额或成本无效。');
  }
}
