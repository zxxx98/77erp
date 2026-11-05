import { randomUUID } from 'node:crypto';
import { allocate, moveInventory } from './commerce.js';
import { hasPermission } from '../shared/permissions.js';
import { stagePoolPaths } from '../shared/production-pools.js';
import { exactQuantity, exactSubtract, exactCompare, exactMin, exactNumber, quantityFields, parseProductionQuantity, validExactQuantity } from '../shared/exact-quantity.js';
import { saveExactQuantity } from './exact-quantity.js';
import { stageLedger, stageBatchRemaining, allocateStageComponents } from './production-stages.js';
import { reopenProductionQuantities } from './production-rounding.js';
import { notifyStockChanges } from './notifications.js';

export const stageReceiptTable = 'production_stage_receipts';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const actor = req => req.user.name || req.user.username;
export function migrateStageReceipts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS production_stage_receipts (
    id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    production_id INTEGER NOT NULL REFERENCES production_orders(id), source_batch_id INTEGER NOT NULL REFERENCES production_stage_batches(id),
    quantity REAL NOT NULL, total_cost_cents INTEGER NOT NULL, components TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','void')), version INTEGER NOT NULL DEFAULT 1,
    created_by_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    confirmed_by_name TEXT NOT NULL DEFAULT '', confirmed_at TEXT,
    voided_by_name TEXT NOT NULL DEFAULT '', voided_at TEXT, void_reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS production_stage_receipt_order ON production_stage_receipts(production_id);
    CREATE INDEX IF NOT EXISTS production_stage_receipt_source ON production_stage_receipts(source_batch_id);
    CREATE INDEX IF NOT EXISTS production_stage_receipt_queue ON production_stage_receipts(warehouse_id,status,id);`);
  const advance = `UPDATE app_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='production_version';
    UPDATE production_stage_receipts SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='production_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS stage_receipt_insert AFTER INSERT ON production_stage_receipts BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS stage_receipt_update AFTER UPDATE OF status ON production_stage_receipts BEGIN ${advance} END;`);
}
// Give transfers and later registrations distinct timestamps for deterministic ledger replay.
export function stageEventTime(db, orderId) {
  const times = db.prepare(`SELECT created_at,voided_at FROM production_stage_batches WHERE production_id=?
    UNION ALL SELECT created_at,voided_at FROM production_stage_receipts WHERE production_id=?`).all(orderId,orderId);
  return new Date(Math.max(Date.now(), ...times.flatMap(row => [row.created_at,row.voided_at].filter(Boolean).map(time => Date.parse(time)+1)))).toISOString();
}
export function stageReceiptDocument(db, id, warehouseId) {
  const row = db.prepare(`SELECT r.*,o.number production_number,o.production_group_id,o.production_group_name,
    b.path,b.batch_number,s.product_id,s.name product_name,s.unit,s.unit_round_up,p.barcode
    FROM production_stage_receipts r JOIN production_orders o ON o.id=r.production_id
    JOIN production_stage_batches b ON b.id=r.source_batch_id JOIN production_stages s ON s.id=b.stage_id
    JOIN products p ON p.id=s.product_id WHERE r.id=? AND r.warehouse_id=?`).get(id,warehouseId);
  if (!row) fail('半成品入库单不存在或不属于当前仓库。',404);
  const { components, ...doc } = row;
  return {...doc,id:`stage-${doc.id}`,stage_receipt_id:doc.id,kind:'stage',items:[{product_id:doc.product_id,name:doc.product_name,barcode:doc.barcode,unit:doc.unit,unit_round_up:doc.unit_round_up,...quantityFields(exactQuantity(doc)),cost_cents:doc.total_cost_cents,kind:'stage'}]};
}
// Negative, in-memory allocation IDs keep receipt reservations separate from saved parent inputs.
export function receiptTransfers(receipts) {
  return receipts.map(r=>({id:-r.id,source_batch_id:r.source_batch_id,...quantityFields(exactQuantity(r)),cost_cents:r.total_cost_cents,receipt:true}));
}
export function receiptTransferComponents(receipts) {
  return receipts.flatMap(r=>JSON.parse(r.components).map(c=>({...c,allocation_id:-r.id})));
}
export function installStageReceipts(app, db, {route,current,version}) {
  app.post('/api/production-orders/:id/stage-receipts',route(req=>{
    const order=current(req);version(req,order);
    if (!order.stage_workflow || order.status!=='in_progress') fail('仅生产中的分层生产单可申请半成品入库。',409);
    const stage=order.stages.find(s=>s.path!==''&&s.path===req.body.path);
    if (!stage) fail('请选择半成品层。');
    if(db.prepare('SELECT COUNT(*) n FROM production_stage_receipts WHERE production_id=?').get(order.id).n>=10000)fail('半成品入库单达到上限，请拆分生产单。');
    const quantity=parseProductionQuantity(req.body.quantity,true);
    if (!validExactQuantity(quantity,true)) fail('半成品入库数量必须大于零。');
    const product=db.prepare('SELECT * FROM products WHERE id=?').get(stage.product_id);
    if (!product?.active || product.unit!==stage.unit || product.unit_round_up!==stage.unit_round_up) fail('半成品已停用或单位、取整规则已变化。',409);
    const ledger=stageLedger(db,order.id), paths=stagePoolPaths(order,stage.path);
    let needed=quantity;
    for (const batch of ledger.batches.filter(b=>paths.includes(b.path)&&b.status==='active')) {
      if (exactCompare(needed,0)===0) break;
      const left=stageBatchRemaining(batch,ledger.allocations,ledger.allocationComponents);
      if (exactCompare(exactQuantity(left),0)<=0) continue;
      const q=exactMin(needed,exactQuantity(left)), cost=allocate(left.cost_cents,q,exactQuantity(left));
      const components=allocateStageComponents(left.components,q,exactQuantity(left),cost).map(c=>({product_id:c.product_id,...quantityFields(exactQuantity(c)),cost_cents:c.cost_cents}));
      const at=stageEventTime(db,order.id),number=`BCRK${at.slice(0,10).replaceAll('-','')}-${randomUUID().replaceAll('-','').slice(0,12)}`;
      const id=Number(db.prepare(`INSERT INTO production_stage_receipts(number,warehouse_id,production_id,source_batch_id,quantity,total_cost_cents,components,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(number,order.warehouse_id,order.id,batch.id,exactNumber(q),cost,JSON.stringify(components),actor(req),at,at).lastInsertRowid);
      saveExactQuantity(db,stageReceiptTable,id,'quantity',q);needed=exactSubtract(needed,q);
    }
    if (exactCompare(needed,0)>0) fail('半成品入库数量超过本单可用余额。',409);
    db.prepare('UPDATE production_orders SET updated_at=?,updated_by_name=? WHERE id=?').run(stageEventTime(db,order.id),actor(req),order.id);
    return current(req);
  },true));
  const load=req=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)fail('半成品入库单编号无效。');
    const doc=stageReceiptDocument(db,id,req.warehouse.id);
    if(req.body.version!==doc.version)fail('半成品入库单已变化，请刷新后核对。',409);
    return doc;
  };
  app.post('/api/production-stage-receipts/:id/confirm',route(req=>{
    const doc=load(req);
    if(doc.status!=='pending')fail('半成品入库单不是待入库状态。',409);
    const batch=db.prepare('SELECT status FROM production_stage_batches WHERE id=?').get(doc.source_batch_id);
    const order=db.prepare('SELECT status FROM production_orders WHERE id=?').get(doc.production_id);
    if(batch?.status!=='active'||order?.status==='void')fail('来源批次或生产单已作废。',409);
    const p=db.prepare('SELECT * FROM products WHERE id=?').get(doc.product_id);
    if(!p?.active||p.warehouse_id!==req.warehouse.id||p.unit!==doc.unit||p.unit_round_up!==doc.unit_round_up)fail('半成品已停用或单位、取整规则已变化。',409);
    moveInventory(db,p.id,exactQuantity(doc),doc.total_cost_cents);
    const at=stageEventTime(db,doc.production_id);
    db.prepare("UPDATE production_stage_receipts SET status='confirmed',confirmed_at=?,confirmed_by_name=?,updated_at=? WHERE id=?").run(at,actor(req),at,doc.stage_receipt_id);
    db.prepare('UPDATE production_orders SET updated_at=?,updated_by_name=? WHERE id=?').run(at,actor(req),doc.production_id);
    notifyStockChanges(db,req,[p],{production_id:doc.production_id,number:doc.number});
    return stageReceiptDocument(db,doc.stage_receipt_id,req.warehouse.id);
  },true,req=>{if(!hasPermission(req.user,'stock_approve'))fail('需要出入库审核权限。',403);}));
  app.post('/api/production-orders/:id/stage-receipts/:receiptId/void',route(req=>{
    const order=current(req);version(req,order);
    const doc=stageReceiptDocument(db,Number(req.params.receiptId),req.warehouse.id);
    if(doc.production_id!==order.id)fail('半成品入库单不属于此生产单。',404);
    if(doc.status==='void'||order.status==='void')fail('单据已经作废。',409);
    if(typeof req.body.reason!=='string'||!req.body.reason.trim()||req.body.reason.length>500)fail('请填写作废原因（最多 500 字）。');
    if(doc.status==='confirmed'&&(!hasPermission(req.user,'corrections')||!hasPermission(req.user,'purchase')))fail('已入库半成品作废需要单据纠正和仓库入库权限。',403);
    const p=db.prepare('SELECT * FROM products WHERE id=?').get(doc.product_id);
    if(p.unit!==doc.unit||p.unit_round_up!==doc.unit_round_up)fail('半成品单位或取整规则已变化。',409);
    reopenProductionQuantities(db,req,order);
    if(doc.status==='confirmed')moveInventory(db,p.id,exactSubtract(0,exactQuantity(doc)),doc.total_cost_cents);
    const at=stageEventTime(db,order.id);
    db.prepare("UPDATE production_stage_receipts SET status='void',voided_at=?,voided_by_name=?,void_reason=?,updated_at=? WHERE id=?").run(at,actor(req),req.body.reason.trim(),at,doc.stage_receipt_id);
    db.prepare("UPDATE production_orders SET status='draft',material_phase='in_progress',updated_at=?,updated_by_name=? WHERE id=?").run(at,actor(req),order.id);
    if(doc.status==='confirmed')notifyStockChanges(db,req,[p],{production_id:order.id,number:doc.number});
    return current(req);
  },true));
}

export function validateStageReceipts(data) {
  const ids=new Set(),numbers=new Set(),money=n=>Number.isSafeInteger(n)&&n>=0;
  const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
  const date=v=>text(v,100,true)&&Number.isFinite(Date.parse(v));
  for(const r of data.production_stage_receipts||[]) {
    const batch=data.production_stage_batches.find(b=>b.id===r.source_batch_id),order=data.production_orders.find(o=>o.id===r.production_id);
    if(!Number.isSafeInteger(r.id)||r.id<1||ids.has(r.id)||!order||!batch||batch.production_id!==order.id||batch.path===''||r.warehouse_id!==order.warehouse_id||
      !text(r.number,100,true)||!/^BCRK\d{8}-[a-f0-9]{12}$/.test(r.number)||numbers.has(r.number)||!Number.isSafeInteger(r.version)||r.version<1||
      !validExactQuantity(exactQuantity(r),true)||!money(r.total_cost_cents)||!['pending','confirmed','void'].includes(r.status)||
      !text(r.created_by_name,60,true)||!date(r.created_at)||!date(r.updated_at)||r.created_at<batch.created_at||r.updated_at<r.created_at||
      !text(r.confirmed_by_name,60)||!text(r.voided_by_name,60)||!text(r.void_reason,500)||
      (r.confirmed_at===null?r.confirmed_by_name!=='':!date(r.confirmed_at)||!r.confirmed_by_name.trim()||r.confirmed_at<r.created_at||r.confirmed_at>r.updated_at)||
      r.status==='pending'&&r.confirmed_at!==null||r.status==='confirmed'&&r.confirmed_at===null||
      (r.status==='void'?!date(r.voided_at)||r.voided_at<r.created_at||r.voided_at>r.updated_at||r.confirmed_at&&r.voided_at<r.confirmed_at||!r.voided_by_name.trim()||!r.void_reason.trim():r.voided_at!==null||r.voided_by_name!==''||r.void_reason!=='')||
      r.status!=='void'&&(batch.status!=='active'||order.status==='void')||r.status==='pending'&&order.status==='completed')fail('备份半成品入库单状态或来源无效。');
    ids.add(r.id);numbers.add(r.number);
    let parts;try{parts=JSON.parse(r.components);}catch{fail('备份半成品入库成本组成无效。');}
    const source=data.production_stage_components.filter(c=>c.batch_id===batch.id);
    if(!Array.isArray(parts)||parts.length!==source.length||new Set(parts.map(c=>c.product_id)).size!==parts.length||
      parts.some(c=>!source.some(s=>s.product_id===c.product_id)||!validExactQuantity(exactQuantity(c))||!money(c.cost_cents)||
        Object.keys(c).some(k=>!['product_id','quantity','quantity_fraction','cost_cents'].includes(k))||
        typeof c.quantity_fraction!=='string'||c.quantity_fraction.length>4096||c.quantity_fraction!==''&&(!/^\d+\/\d+$/.test(c.quantity_fraction)||exactNumber(c.quantity_fraction)!==c.quantity))||
      parts.reduce((n,c)=>n+c.cost_cents,0)!==r.total_cost_cents)fail('备份半成品入库成本组成无效。');
  }
}
