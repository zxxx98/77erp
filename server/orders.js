import { validQuantity, addQuantity, materialQuantity, validStoredQuantity } from '../shared/quantity.js';
import { validUnitPrice } from '../shared/money.js';
import { resolveContact, moveInventory } from './commerce.js';
import { notifyOrder, notificationMutation } from './notifications.js';
import { contactMatchesDirection } from '../shared/contacts.js';
import { hasPermission } from '../shared/permissions.js';
import { operationRequest, saveOperationRequest } from './operations.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const actor = req => req.user.name || req.user.username;
export const orderApprovalDefaults = {
  version: 1, submitted_at: null, approved_at: null, approved_by: null, approved_by_name: '',
  rejected_at: null, rejected_by: null, rejected_by_name: '', reject_reason: '',
  cancelled_at: null, cancelled_by: null, cancelled_by_name: '', cancel_reason: '',
  source_channel: 'legacy', approval_origin: 'legacy', resubmitted_from_id: null,
};
export function migrateOrderApproval(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(orders)').all().map(c => c.name));
  for (const [name, value] of Object.entries(orderApprovalDefaults)) if (!columns.has(name)) {
    const definition = value === null ? (name === 'resubmitted_from_id' ? 'INTEGER REFERENCES orders(id)' : name.endsWith('_by') ? 'INTEGER REFERENCES users(id)' : 'TEXT')
      : typeof value === 'number' ? `INTEGER NOT NULL DEFAULT ${value}` : `TEXT NOT NULL DEFAULT '${value}'`;
    db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
  }
  const lines = new Set(db.prepare('PRAGMA table_info(order_items)').all().map(c => c.name));
  if (!lines.has('unit')) db.exec("ALTER TABLE order_items ADD COLUMN unit TEXT NOT NULL DEFAULT ''");
  if (!lines.has('active_snapshot')) db.exec('ALTER TABLE order_items ADD COLUMN active_snapshot INTEGER NOT NULL DEFAULT 1');
  if (!lines.has('unit_round_up')) db.exec('ALTER TABLE order_items ADD COLUMN unit_round_up INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS orders_approval_queue ON orders(warehouse_id,status,type,created_at DESC,id DESC)');
  // A pre-upgrade AI card must never retain the old immediate-posting semantics.
  if (!db.prepare("SELECT 1 FROM app_metadata WHERE key='stock_approval_migrated'").get()) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_actions'").get())
      db.exec('UPDATE ai_actions SET expires_at=0 WHERE result IS NULL');
    db.prepare("INSERT INTO app_metadata(key,value) VALUES ('stock_approval_migrated','1')").run();
  }
}

// The caller owns the transaction, including QR quotas and request receipts.
// This function only submits a snapshot. Inventory is posted exclusively by approval.
export function createOrder(db, req, body) {
  const { type, partner, note = '', items } = body;
  if (!hasPermission(req.user, type === 'in' ? 'purchase' : 'sale')) fail('没有此业务操作的权限。',403);
  if (!['in','out'].includes(type) || typeof partner !== 'string' || !partner.trim() || partner.length > 100 ||
      typeof note !== 'string' || note.length > 500 || !Array.isArray(items) || !items.length || items.length > 100)
    fail('请填写往来单位并至少添加一件物料。');
  const seen = new Set(); let total = 0;
  const normalized = items.map(item => {
    if (!Number.isSafeInteger(item?.product_id) || item.product_id < 1 || !validQuantity(item.quantity,true) || !validUnitPrice(item.price))
      fail('物料数量必须为正数且最多 4 位小数，单价最多四位小数且不能为负数。');
    if (seen.has(item.product_id)) fail('同一物料不能重复添加，请合并数量。');
    seen.add(item.product_id);
    const product = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(item.product_id,req.warehouse.id);
    if (!product) fail('物料不存在或不属于当前仓库。');
    const quantity = materialQuantity(item.quantity,product), amount = Math.round(quantity * item.price * 100);
    total += amount;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total)) fail('单据金额过大，请减少数量或拆分单据。');
    return {product,quantity,price:item.price,amount};
  });
  const at = new Date().toISOString(), prefix = `${type === 'in' ? 'RK' : 'CK'}${at.slice(0,10).replaceAll('-','')}`;
  const last = db.prepare('SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS sequence FROM orders WHERE number LIKE ?').get(prefix.length+1,`${prefix}%`);
  const number = prefix + String((last.sequence || 0)+1).padStart(6,'0');
  const sourceId = body.resubmitted_from_id ?? null;
  if (sourceId !== null) {
    const source = Number.isSafeInteger(sourceId) && db.prepare('SELECT * FROM orders WHERE id=? AND warehouse_id=?').get(sourceId,req.warehouse.id);
    if (!source || source.type !== type || !['rejected','cancelled'].includes(source.status)) fail('重提来源单据无效。');
  }
  const contact = resolveContact(db,type,partner,body.partner_id);
  const id = Number(db.prepare(`INSERT INTO orders(number,type,partner,note,total,created_at,partner_id,kind,settlement_tracked,warehouse_id,created_by,created_by_name,status,stock_applied,submitted_at,source_channel,approval_origin,resubmitted_from_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending',0,?,?,'workflow',?)`).run(number,type,contact.name,note,total/100,at,contact.id,
    contact.role === 'internal' ? 'internal' : 'normal',contact.role === 'internal' ? 0 : 1,req.warehouse.id,req.user.id,actor(req),at,req.orderSource || 'manual',sourceId).lastInsertRowid);
  for (const i of normalized) db.prepare(`INSERT INTO order_items(order_id,product_id,name,barcode,quantity,price,cost_cents,amount_cents,unit,unit_round_up,active_snapshot)
    VALUES (?,?,?,?,?,?,NULL,?,?,?,?)`).run(id,i.product.id,i.product.name,i.product.barcode,i.quantity,i.price,i.amount,i.product.unit,i.product.unit_round_up,i.product.active);
  return {id,number,status:'pending',version:1};
}

export function installOrderApproval(app, db) {
  for (const action of ['approve','reject','cancel']) app.post(`/api/orders/:id/${action}`, (req,res) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      const doc = db.prepare('SELECT * FROM orders WHERE id=? AND warehouse_id=?').get(Number(req.params.id),req.warehouse.id);
      if (!doc) fail('单据不存在。',404);
      if (action === 'cancel') {
        if (doc.created_by !== req.user.id || !hasPermission(req.user,doc.type === 'in' ? 'purchase' : 'sale')) fail('仅提交人可撤回自己的待审核单据。',403);
      } else if (!hasPermission(req.user,'stock_approve')) fail('需要出入库审核权限。',403);
      const request = operationRequest(db,req);
      if (request.previous) { db.exec('COMMIT'); return res.json(request.previous); }
      if (!Number.isSafeInteger(req.body.version) || req.body.version !== doc.version || doc.status !== 'pending' || doc.approval_origin !== 'workflow')
        fail('单据已变化，请刷新后核对。',409);
      const at = new Date().toISOString();
      const response = notificationMutation(db,req,() => {
        if (action === 'approve') {
          const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(doc.partner_id);
          if (!contact?.active || !contactMatchesDirection(contact,doc.type) || (doc.kind === 'internal') !== (contact.role === 'internal')) fail('往来单位已停用或不存在，请撤回后重新提交。',409);
          const lines = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(doc.id);
          if (!lines.length) fail('单据没有物料。',409);
          const products = [];
          for (const i of lines) {
            const p = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(i.product_id,req.warehouse.id);
            if (!p || p.active !== i.active_snapshot) fail(`${i.name}启停状态已变化或不存在，请重新核对。`,409);
            if (p.unit !== i.unit || p.unit_round_up !== i.unit_round_up) fail(`${i.name}单位或取整规则已变化，请撤回后重新提交。`,409);
            if (!validQuantity(i.quantity,true) || materialQuantity(i.quantity,p) !== i.quantity || !validUnitPrice(i.price) || i.amount_cents !== Math.round(i.quantity*i.price*100)) fail('单据明细无效。',409);
            if (doc.type === 'out' && p.stock < i.quantity) fail(`${p.name}库存不足（当前 ${p.stock} ${p.unit}）。`,409);
            if (doc.type === 'in' && !validStoredQuantity(addQuantity(p.stock,i.quantity))) fail(`${p.name}入库后库存超出上限。`,409);
            const cost = moveInventory(db,p.id,doc.type === 'in' ? i.quantity : -i.quantity,doc.type === 'in' ? i.amount_cents : undefined);
            db.prepare('UPDATE order_items SET cost_cents=? WHERE id=?').run(cost,i.id);
            products.push(p);
          }
          db.prepare("UPDATE orders SET status='active',stock_applied=1,approved_by=?,approved_by_name=?,approved_at=?,version=version+1 WHERE id=?").run(req.user.id,actor(req),at,doc.id);
          notifyOrder(db,req,doc.id,doc.type === 'in' ? 'purchase_in' : 'sale_out',products);
        } else {
          const reason = req.body.reason;
          if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) fail('请填写操作原因（最多 500 字）。');
          const prefix = action === 'reject' ? 'rejected' : 'cancelled';
          const reasonKey = action === 'reject' ? 'reject_reason' : 'cancel_reason';
          db.prepare(`UPDATE orders SET status=?,${prefix}_by=?,${prefix}_by_name=?,${prefix}_at=?,${reasonKey}=?,version=version+1 WHERE id=?`)
            .run(prefix,req.user.id,actor(req),at,reason.trim(),doc.id);
        }
        return {id:doc.id,number:doc.number,status:action === 'approve' ? 'active' : action === 'reject' ? 'rejected' : 'cancelled',version:doc.version+1};
      });
      saveOperationRequest(db,request,response); db.exec('COMMIT');res.json(response);
    } catch(e) {if(db.isTransaction) db.exec('ROLLBACK');res.status(e.status || 400).json({error:e.message});}
  });
}
