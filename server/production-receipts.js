import { randomUUID } from 'node:crypto';
import { moveInventory } from './commerce.js';
import { addQuantity, validStoredQuantity } from '../shared/quantity.js';
import { hasPermission } from '../shared/permissions.js';
import { notifyStockChanges } from './notifications.js';

export const productionReceiptTables = ['production_receipts', 'production_receipt_items'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const actor = req => req.user.name || req.user.username;
const isId = id => Number.isSafeInteger(id) && id > 0;

export function migrateProductionReceipts(db) {
  if (!db.prepare('PRAGMA table_info(production_batches)').all().some(c => c.name === 'receipt_required'))
    db.exec('ALTER TABLE production_batches ADD COLUMN receipt_required INTEGER NOT NULL DEFAULT 0 CHECK(receipt_required IN (0,1))');
  db.exec(`CREATE TABLE IF NOT EXISTS production_receipts (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    production_id INTEGER NOT NULL REFERENCES production_orders(id), production_number TEXT NOT NULL,
    batch_id INTEGER NOT NULL UNIQUE REFERENCES production_batches(id), batch_number INTEGER NOT NULL,
    product_name TEXT NOT NULL, unit TEXT NOT NULL, quantity REAL NOT NULL, total_cost_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','void')), version INTEGER NOT NULL DEFAULT 1,
    created_by_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    confirmed_by_name TEXT NOT NULL DEFAULT '', confirmed_at TEXT,
    voided_by_name TEXT NOT NULL DEFAULT '', voided_at TEXT, void_reason TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS production_receipt_items (
    id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES production_receipts(id),
    product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL,
    unit TEXT NOT NULL, unit_round_up INTEGER NOT NULL CHECK(unit_round_up IN (0,1)),
    quantity REAL NOT NULL, cost_cents INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('product','scrap')),
    UNIQUE(document_id,product_id));
    CREATE INDEX IF NOT EXISTS production_receipt_warehouse ON production_receipts(warehouse_id,status,id);
    CREATE INDEX IF NOT EXISTS production_receipt_order ON production_receipts(production_id);
    CREATE INDEX IF NOT EXISTS production_receipt_product ON production_receipt_items(product_id);`);
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='production_version';
    UPDATE production_receipts SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='production_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS production_receipt_version_insert AFTER INSERT ON production_receipts BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS production_receipt_version_update AFTER UPDATE OF status ON production_receipts BEGIN ${advance} END;`);
}
export function receiptDocument(db, id, warehouseId) {
  const doc = db.prepare('SELECT * FROM production_receipts WHERE id=? AND warehouse_id=?').get(id, warehouseId);
  if (!doc) fail('生产入库单不存在或不属于当前仓库。', 404);
  const group = db.prepare('SELECT production_group_id,production_group_name FROM production_orders WHERE id=?').get(doc.production_id);
  return {...doc, ...group, items: db.prepare('SELECT * FROM production_receipt_items WHERE document_id=? ORDER BY id').all(id)};
}
export function receiptDocuments(db, productionId, warehouseId) {
  return db.prepare('SELECT id FROM production_receipts WHERE production_id=? ORDER BY id').all(productionId).map(row => receiptDocument(db, row.id, warehouseId));
}
export function receiptQuantities(db, order) {
  const batches = db.prepare('SELECT * FROM production_batches WHERE production_id=?').all(order.id);
  if (!batches.length) return {received_quantity: order.status !== 'void' ? order.completed_quantity || 0 : 0, pending_receipt_quantity: 0};
  let received = 0, pending = 0;
  for (const batch of batches) if (batch.status === 'active') {
    const doc = batch.receipt_required && db.prepare('SELECT status FROM production_receipts WHERE batch_id=?').get(batch.id);
    if (!batch.receipt_required || doc?.status === 'confirmed') received = addQuantity(received, batch.completed_quantity);
    else if (doc?.status === 'pending') pending = addQuantity(pending, batch.completed_quantity);
  }
  return {received_quantity: received, pending_receipt_quantity: pending};
}
export function createProductionReceipt(db, req, order, batchId) {
  const batch = db.prepare('SELECT * FROM production_batches WHERE id=?').get(batchId), at = batch.created_at;
  const number = `SCRK${at.slice(0,10).replaceAll('-','')}-${randomUUID().replaceAll('-','').slice(0,12)}`;
  const id = Number(db.prepare(`INSERT INTO production_receipts(number,warehouse_id,production_id,production_number,batch_id,batch_number,product_name,unit,quantity,total_cost_cents,created_by_name,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, req.warehouse.id, order.id, order.number, batchId, batch.batch_number, order.product_name, order.unit, batch.completed_quantity, batch.total_cost_cents, actor(req), at, at).lastInsertRowid);
  const rows = [{product_id: order.product_id, name: order.product_name, barcode: order.barcode, unit: order.unit, unit_round_up: order.unit_round_up, quantity: batch.completed_quantity, cost_cents: batch.total_cost_cents, kind:'product'}];
  for (const row of db.prepare("SELECT * FROM production_batch_scraps WHERE batch_id=? AND actual_quantity>0 AND disposition='stock'").all(batchId)) {
    rows.push({...order.scraps.find(item => item.product_id === row.product_id), quantity: row.actual_quantity, cost_cents: 0, kind:'scrap'});
  }
  for (const row of rows) db.prepare(`INSERT INTO production_receipt_items(document_id,product_id,name,barcode,unit,unit_round_up,quantity,cost_cents,kind) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, row.product_id, row.name, row.barcode, row.unit, row.unit_round_up, row.quantity, row.cost_cents, row.kind);
}
export function assertReceiptReversalPermission(db, req, batch) {
  const posted = !batch.receipt_required || !!db.prepare('SELECT confirmed_at FROM production_receipts WHERE batch_id=?').get(batch.id)?.confirmed_at;
  if (posted && !hasPermission(req.user, 'purchase')) fail('已入库批次作废还需要仓库入库权限。', 403);
  return posted;
}
export function voidProductionReceipt(db, batchId, owner, at, reason) {
  db.prepare("UPDATE production_receipts SET status='void',voided_by_name=?,voided_at=?,void_reason=?,updated_at=? WHERE batch_id=?")
    .run(owner, at, reason, at, batchId);
}
export function installProductionReceipts(app, db, {route}) {
  const authorize = req => { if (!hasPermission(req.user, 'purchase')) fail('需要仓库入库权限。', 403); };
  app.get('/api/production-receipts', route(req => {
    const {status='all', q='', offset='0', limit='20'} = req.query;
    if (!['all','pending','confirmed','void'].includes(status) || typeof q !== 'string' || q.length>100 ||
      typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
      typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit)<1 || Number(limit)>100) fail('生产入库单筛选或分页参数无效。');
    const clauses = ['warehouse_id=?'], params = [req.warehouse.id];
    if (status !== 'all') {clauses.push('status=?'); params.push(status);}
    if (q.trim()) {clauses.push("(number LIKE ? ESCAPE '\\' OR production_number LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\')"); params.push(...Array(3).fill(`%${q.trim().replace(/[\\%_]/g,c=>`\\${c}`)}%`));}
    const where = clauses.join(' AND '), total = db.prepare(`SELECT COUNT(*) n FROM production_receipts WHERE ${where}`).get(...params).n;
    const docs = db.prepare(`SELECT id FROM production_receipts WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
    return {documents: docs.map(row => receiptDocument(db,row.id,req.warehouse.id)), total, has_more:Number(offset)+docs.length<total};
  }, false, authorize));
  app.post('/api/production-receipts/:id/confirm', route(req => {
    const id = Number(req.params.id); if (!isId(id)) fail('生产入库单编号无效。');
    const doc = receiptDocument(db,id,req.warehouse.id);
    if (!isId(req.body.version) || req.body.version !== doc.version || doc.status !== 'pending') fail('生产入库单已变化，请刷新后核对。',409);
    const batch = db.prepare('SELECT * FROM production_batches WHERE id=?').get(doc.batch_id);
    const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(doc.production_id);
    if (!batch || batch.status !== 'active' || !order || order.status === 'void') fail('生产批次状态不允许批准入库。',409);
    const before = doc.items.map(row => db.prepare('SELECT * FROM products WHERE id=?').get(row.product_id));
    for (const row of doc.items) {
      const product = before.find(p => p?.id === row.product_id);
      if (!product || product.warehouse_id !== req.warehouse.id) fail(`${row.name}物料不存在或仓库已变化。`,409);
      if (product.unit !== row.unit || product.unit_round_up !== row.unit_round_up) fail(`${row.name}单位或取整规则已变化，请先核对。`,409);
      if (!product.active) fail(`${row.name}已停用，请先核对物料。`);
      moveInventory(db,row.product_id,row.quantity,row.cost_cents);
    }
    const at = new Date().toISOString();
    db.prepare("UPDATE production_receipts SET status='confirmed',confirmed_by_name=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor(req),at,at,id);
    db.prepare('UPDATE production_orders SET updated_by_name=?,updated_at=? WHERE id=?').run(actor(req),at,order.id);
    notifyStockChanges(db,req,before,{production_id:order.id,number:doc.number,receipt_id:id,batch_id:batch.id});
    return receiptDocument(db,id,req.warehouse.id);
  },true,authorize));
}
export function validateProductionReceiptBackup(data) {
  const orders = new Map(data.production_orders.map(row=>[row.id,row]));
  const batches = new Map(data.production_batches.map(row=>[row.id,row]));
  const products = new Map(data.products.map(row=>[row.id,row]));
  const docs = new Map(), usedBatches = new Set(), numbers = new Set(), keys = new Set();
  const text=(v,max,required=false)=>typeof v==='string' && v.length<=max && (!required || !!v.trim());
  const date=v=>text(v,100,true) && Number.isFinite(Date.parse(v));
  const money=v=>Number.isSafeInteger(v) && v>=0;
  for (const doc of data.production_receipts) {
    const order=orders.get(doc.production_id), batch=batches.get(doc.batch_id);
    if (!order || !batch || batch.production_id!==order.id || batch.receipt_required!==1 || usedBatches.has(batch.id) ||
      doc.warehouse_id!==order.warehouse_id || doc.production_number!==order.number || doc.batch_number!==batch.batch_number ||
      doc.product_name!==order.product_name || doc.unit!==order.unit || doc.quantity!==batch.completed_quantity || doc.total_cost_cents!==batch.total_cost_cents ||
      !validStoredQuantity(doc.quantity,true) || !money(doc.total_cost_cents) || !isId(doc.version) ||
      !text(doc.number,100,true) || !/^SCRK\d{8}-[a-f0-9]{12}$/.test(doc.number) || numbers.has(doc.number) ||
      !['pending','confirmed','void'].includes(doc.status) || !text(doc.created_by_name,60,true) || !date(doc.created_at) || !date(doc.updated_at) ||
      doc.created_at!==batch.created_at || doc.created_by_name!==batch.created_by_name ||
      !text(doc.confirmed_by_name,60) || (doc.confirmed_at===null ? doc.confirmed_by_name!=='' : !date(doc.confirmed_at) || !doc.confirmed_by_name.trim()) ||
      (doc.status==='confirmed' && doc.confirmed_at===null) || (doc.status==='pending' && doc.confirmed_at!==null) ||
      (doc.status==='void')!==(batch.status==='void') ||
      (doc.status==='void' ? doc.voided_at!==batch.voided_at || doc.voided_by_name!==batch.voided_by_name || doc.void_reason!==batch.void_reason
        : doc.voided_at!==null || doc.voided_by_name!=='' || doc.void_reason!=='') ||
      doc.status!=='void' && order.status==='void') fail('备份生产入库单状态、快照或批次关联无效。');
    docs.set(doc.id,{...doc,items:[]}); usedBatches.add(batch.id); numbers.add(doc.number);
  }
  for (const row of data.production_receipt_items) {
    const doc=docs.get(row.document_id), order=doc && orders.get(doc.production_id), batch=doc && batches.get(doc.batch_id);
    const source=order && (row.kind==='product' ? {product_id:order.product_id,name:order.product_name,barcode:order.barcode,unit:order.unit,unit_round_up:order.unit_round_up}
      : data.production_scraps.find(item=>item.production_id===order.id && item.product_id===row.product_id));
    const scrap=batch && data.production_batch_scraps.find(item=>item.batch_id===batch.id && item.product_id===row.product_id && item.disposition==='stock' && item.actual_quantity>0);
    if (!doc || !source || !['product','scrap'].includes(row.kind) || products.get(row.product_id)?.warehouse_id!==order.warehouse_id ||
      ['product_id','name','barcode','unit','unit_round_up'].some(key=>row[key]!==source[key]) ||
      row.quantity!==(row.kind==='product' ? batch.completed_quantity : scrap?.actual_quantity) ||
      row.cost_cents!==(row.kind==='product' ? batch.total_cost_cents : 0) || !validStoredQuantity(row.quantity,true) || !money(row.cost_cents) ||
      keys.has(`${doc.id}:${row.product_id}`)) fail('备份生产入库单明细快照无效。');
    keys.add(`${doc.id}:${row.product_id}`); doc.items.push(row);
  }
  for (const batch of batches.values()) if (![0,1].includes(batch.receipt_required) || (batch.receipt_required===1)!==usedBatches.has(batch.id)) fail('备份生产批次入库标记或单据缺失。');
  for (const doc of docs.values()) {
    const scraps=data.production_batch_scraps.filter(row=>row.batch_id===doc.batch_id && row.disposition==='stock' && row.actual_quantity>0);
    if (doc.items.length!==scraps.length+1 || doc.items.filter(row=>row.kind==='product').length!==1) fail('备份生产入库单缺少成品或废料明细。');
  }
}
