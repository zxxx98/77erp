import { exactQuantity, exactAdd, exactSubtract, exactSum, exactCeil, exactCompare, exactNumber, quantityFields } from '../shared/exact-quantity.js';
import { saveExactQuantity } from './exact-quantity.js';
import { allocate, moveInventory } from './commerce.js';
import { hasPermission } from '../shared/permissions.js';
import { materialBalances } from './production-materials.js';
import { stageDirectBatches } from './production-stages.js';
import { notifyStockChanges } from './notifications.js';
import { postMaterialUsage } from './post-processing-materials.js';

export function migrateProductionRounding(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS production_quantity_rounding (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id), kind TEXT NOT NULL CHECK(kind IN ('material','product','scrap','discard')),
    quantity REAL NOT NULL, cost_cents INTEGER NOT NULL, receipt_id INTEGER REFERENCES production_receipts(id),
    basis_quantity REAL NOT NULL, basis_quantity_fraction TEXT NOT NULL DEFAULT '', basis_cost_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')), created_at TEXT NOT NULL,
    created_by_name TEXT NOT NULL, voided_at TEXT, voided_by_name TEXT NOT NULL DEFAULT ''
  ); CREATE INDEX IF NOT EXISTS production_rounding_order ON production_quantity_rounding(production_id,status);`);
}

export function productionRounding(db, orderId) {
  return db.prepare("SELECT * FROM production_quantity_rounding WHERE production_id=? AND status='active' ORDER BY id").all(orderId);
}

export function receiptWithRounding(db, document) {
  const adjustments = db.prepare("SELECT * FROM production_quantity_rounding WHERE receipt_id=? AND status='active'").all(document.id);
  const product = adjustments.filter(row => row.kind === 'product');
  return { ...document, ...quantityFields(exactAdd(exactQuantity(document), exactSum(product))),
    total_cost_cents: document.total_cost_cents + product.reduce((total, row) => total + row.cost_cents, 0),
    rounding: adjustments,
    items: document.items.map(item => {
      const rows = adjustments.filter(row => row.product_id === item.product_id && row.kind === item.kind);
      return { ...item, ...quantityFields(exactAdd(exactQuantity(item), exactSum(rows))),
        cost_cents: item.cost_cents + rows.reduce((total, row) => total + row.cost_cents, 0) };
    }) };
}

export function finalizeProductionQuantities(db, req, order) {
  if (productionRounding(db, order.id).length) return;
  const at = new Date().toISOString(), owner = req.user.name || req.user.username;
  const before = [order.product_id, ...order.scraps.map(row => row.product_id)].map(id => db.prepare('SELECT * FROM products WHERE id=?').get(id));
  const save = (productId, kind, quantity, cost, receiptId = null, basis = 0, basisCost = 0) => {
    if (exactCompare(quantity, 0) === 0 && !cost) return;
    const fields = quantityFields(basis, 'basis_quantity');
    const id = Number(db.prepare('INSERT INTO production_quantity_rounding(production_id,product_id,kind,quantity,cost_cents,receipt_id,created_at,created_by_name,basis_quantity,basis_quantity_fraction,basis_cost_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(order.id, productId, kind, exactNumber(quantity), cost, receiptId, at, owner, fields.basis_quantity, fields.basis_quantity_fraction, basisCost).lastInsertRowid);
    saveExactQuantity(db, 'production_quantity_rounding', id, 'quantity', quantity);
  };
  let extraCost = 0;
  for (const item of order.items) {
    const consumed = exactQuantity(item, 'consumed_quantity');
    const delta = exactSubtract(exactCeil(consumed, item.unit_round_up ? 0 : 4), consumed);
    if (exactCompare(delta, 0) === 0) continue;
    const available = exactQuantity(item, 'available_quantity');
    if (exactCompare(delta, available) > 0) throw new Error(`${item.name}完结取整还需 ${delta} ${item.unit}，请先补料。`);
    const cost = allocate(item.available_cost_cents, delta, available);
    extraCost += cost;
    if (!Number.isSafeInteger(extraCost)) throw new Error('完结取整成本超出范围。');
    save(item.product_id, 'material', delta, cost, null, available, item.available_cost_cents);
  }
  const documents = order.receipt_documents.filter(row => row.kind !== 'stage' && row.status !== 'void');
  const last = documents.at(-1);
  if (!last) throw new Error('请先登记有效成品批次再结束生产。');
  const output = exactQuantity(order, 'completed_quantity');
  save(order.product_id, 'product', exactSubtract(exactCeil(output, order.unit_round_up ? 0 : 4), output), extraCost, last.id);
  for (const scrap of order.scraps) for (const disposition of ['stock', 'discard']) {
    const quantity = exactQuantity(scrap, disposition === 'stock' ? 'stock_quantity' : 'discard_quantity');
    const delta = exactSubtract(exactCeil(quantity, scrap.unit_round_up ? 0 : 4), quantity);
    const receipt = disposition === 'stock' ? [...documents].reverse().find(doc => doc.items.some(item => item.product_id === scrap.product_id)) : null;
    save(scrap.product_id, disposition === 'stock' ? 'scrap' : 'discard', delta, 0, receipt?.id ?? null);
  }
  for (const row of productionRounding(db, order.id)) if (row.receipt_id && documents.find(doc => doc.id === row.receipt_id)?.status === 'confirmed')
    moveInventory(db, row.product_id, exactQuantity(row), row.cost_cents);
  db.prepare("UPDATE production_receipts SET status=status WHERE id IN (SELECT receipt_id FROM production_quantity_rounding WHERE production_id=? AND status='active')").run(order.id);
  notifyStockChanges(db, req, before, {production_id:order.id,number:order.number});
}

export function reopenProductionQuantities(db, req, order) {
  const rows = productionRounding(db, order.id);
  for (const row of rows) if (row.receipt_id && db.prepare('SELECT status FROM production_receipts WHERE id=?').get(row.receipt_id)?.status === 'confirmed') {
    if (!hasPermission(req.user, 'purchase')) throw Object.assign(new Error('回退已入库取整差额需要仓库入库权限。'), {status:403});
    moveInventory(db, row.product_id, exactSubtract(0, exactQuantity(row)), row.cost_cents, true);
  }
  db.prepare("UPDATE production_receipts SET status=status WHERE id IN (SELECT receipt_id FROM production_quantity_rounding WHERE production_id=? AND status='active')").run(order.id);
  db.prepare("UPDATE production_quantity_rounding SET status='void',voided_at=?,voided_by_name=? WHERE production_id=? AND status='active'")
    .run(new Date().toISOString(), req.user.name || req.user.username, order.id);
}

export function validateProductionRoundingBackup(data) {
  const fail = () => { throw new Error('备份完结取整差额、成本或关联无效。'); };
  const keys = new Set();
  for (const row of data.production_quantity_rounding) {
    const order = data.production_orders.find(order => order.id === row.production_id);
    const product = data.products.find(product => product.id === row.product_id);
    const receipt = data.production_receipts.find(receipt => receipt.id === row.receipt_id);
    if (!order || !product || product.warehouse_id !== order.warehouse_id || !['material','product','scrap','discard'].includes(row.kind) ||
        !['active','void'].includes(row.status) || !Number.isSafeInteger(row.cost_cents) || row.cost_cents < 0 || !Number.isSafeInteger(row.basis_cost_cents) || row.basis_cost_cents < 0 ||
        !Number.isFinite(Date.parse(row.created_at)) || typeof row.created_by_name !== 'string' || !row.created_by_name.trim() ||
        typeof row.voided_by_name !== 'string' || exactCompare(exactQuantity(row), 1) >= 0 ||
        (row.status === 'void' ? !Number.isFinite(Date.parse(row.voided_at)) || !row.voided_by_name.trim() : row.voided_at !== null || row.voided_by_name !== '') ||
        (['product','scrap'].includes(row.kind) ? !receipt || receipt.production_id !== order.id : row.receipt_id !== null) ||
        row.status === 'active' && (order.status !== 'completed' || receipt?.status === 'void')) fail();
    if (row.status === 'active') {
      const key = `${row.production_id}:${row.kind}:${row.product_id}`;
      if (keys.has(key)) fail();
      keys.add(key);
    }
  }
  for (const order of data.production_orders.filter(order => order.status === 'completed' && order.material_workflow)) {
    const rows = data.production_quantity_rounding.filter(row => row.production_id === order.id && row.status === 'active');
    const items = data.production_items.filter(item => item.production_id === order.id);
    const documents = data.production_material_documents.filter(doc => doc.production_id === order.id).map(doc => ({...doc,
      items: data.production_material_document_items.filter(item => item.document_id === doc.id),
      issues: data.production_material_issues.filter(issue => issue.document_id === doc.id).map(issue => ({...issue, items: data.production_material_issue_items.filter(item => item.issue_id === issue.id)})) }));
    const balances = materialBalances({...order, items, material_documents: documents, stage_direct_batches: stageDirectBatches(data, order.id),
      batches: data.production_batches.filter(batch => batch.production_id === order.id).map(batch => ({...batch, items: data.production_batch_items.filter(item => item.batch_id === batch.id)})) },
      postMaterialUsage(data.production_operation_reports.filter(row => row.production_id === order.id)));
    let cost = 0;
    const checked = new Set();
    const check = (kind, productId, delta, expectedCost) => {
      const row = rows.find(row => row.kind === kind && row.product_id === productId);
      if (!row) { if (exactCompare(delta, 0) !== 0 || expectedCost) fail(); return; }
      if (exactCompare(exactQuantity(row), delta) !== 0 || row.cost_cents !== expectedCost) fail();
      checked.add(row.id);
    };
    for (const item of balances) {
      const consumed = exactQuantity(item, 'consumed_quantity');
      const delta = exactSubtract(exactCeil(consumed, item.unit_round_up ? 0 : 4), consumed);
      const adjustment = rows.find(row => row.kind === 'material' && row.product_id === item.product_id);
      if (adjustment && exactCompare(exactQuantity(adjustment, 'basis_quantity'), delta) < 0) fail();
      const amount = exactCompare(delta, 0) > 0 && adjustment ? allocate(adjustment.basis_cost_cents, delta, exactQuantity(adjustment, 'basis_quantity')) : 0;
      check('material', item.product_id, delta, amount); cost += amount;
    }
    const output = exactQuantity(order, 'completed_quantity');
    check('product', order.product_id, exactSubtract(exactCeil(output, order.unit_round_up ? 0 : 4), output), cost);
    const batchIds = new Set(data.production_batches.filter(batch => batch.production_id === order.id && batch.status === 'active').map(batch => batch.id));
    for (const scrap of data.production_scraps.filter(scrap => scrap.production_id === order.id)) for (const disposition of ['stock','discard']) {
      const quantity = exactSum(data.production_batch_scraps.filter(row => batchIds.has(row.batch_id) && row.product_id === scrap.product_id && row.disposition === disposition), 'actual_quantity');
      check(disposition === 'stock' ? 'scrap' : 'discard', scrap.product_id, exactSubtract(exactCeil(quantity, scrap.unit_round_up ? 0 : 4), quantity), 0);
    }
    if (checked.size !== rows.length) fail();
  }
}
