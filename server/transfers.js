import { randomUUID } from 'node:crypto';
import { validQuantity } from '../shared/quantity.js';
import { hasPermission } from '../shared/permissions.js';
import { moveInventory } from './commerce.js';
import { notifyStockChanges, queueNotification } from './notifications.js';
import { syncProduct } from './warehouses.js';

const fail = (message) => {
  throw new Error(message);
};
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const reasonOf = (body) =>
  text(body?.reason, 500) ? body.reason.trim() : fail('请填写操作原因（最多 500 字）。');

// A transfer is stored as two linked orders: an outbound leg in the source
// warehouse and an inbound leg in the destination warehouse. Keeping both legs
// in `orders` reuses stock, moving average cost, history, CSV export and the
// per-warehouse guards for each side of the move.
export function migrateTransfers(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
  if (!columns.has('transfer_id')) db.exec("ALTER TABLE orders ADD COLUMN transfer_id TEXT NOT NULL DEFAULT ''");
  if (!columns.has('transfer_warehouse_id')) db.exec('ALTER TABLE orders ADD COLUMN transfer_warehouse_id INTEGER REFERENCES warehouses(id)');
  db.exec(`CREATE INDEX IF NOT EXISTS orders_transfer ON orders(transfer_id) WHERE transfer_id!='';
    CREATE INDEX IF NOT EXISTS orders_transfer_warehouse ON orders(transfer_warehouse_id);`);
}

export function installTransfers(app, db, { route, mutation }) {
  const warehouseName = (id) => db.prepare('SELECT name FROM warehouses WHERE id=?').get(id)?.name || '';
  const itemsOf = (orderId) =>
    db.prepare('SELECT product_id,name,barcode,quantity,cost_cents FROM order_items WHERE order_id=? ORDER BY id').all(orderId);
  const nextNumber = (prefix) => {
    const last = db
      .prepare('SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS sequence FROM orders WHERE number LIKE ?')
      .get(prefix.length + 1, `${prefix}%`);
    return prefix + String((last.sequence || 0) + 1).padStart(6, '0');
  };
  // Prefer the explicit cross-warehouse link, then the same barcode within the
  // destination warehouse; otherwise create the档案 there so later transfers,
  // syncs and multi-warehouse stocktakes stay linked.
  const destinationOf = (source, warehouseId) => {
    if (source.sync_key) {
      const linked = db.prepare('SELECT * FROM products WHERE warehouse_id=? AND sync_key=?').get(warehouseId, source.sync_key);
      if (linked) return { product: linked, created: false };
    }
    const sameBarcode = db.prepare('SELECT * FROM products WHERE warehouse_id=? AND barcode=?').get(warehouseId, source.barcode);
    if (sameBarcode) {
      // Linking the archives keeps multi-warehouse stocktakes matched as well.
      if (!sameBarcode.sync_key && source.sync_key)
        db.prepare('UPDATE products SET sync_key=? WHERE id=?').run(source.sync_key, sameBarcode.id);
      return { product: db.prepare('SELECT * FROM products WHERE id=?').get(sameBarcode.id), created: false };
    }
    syncProduct(db, source.id, [warehouseId]);
    const created = source.sync_key
      ? db.prepare('SELECT * FROM products WHERE warehouse_id=? AND sync_key=?').get(warehouseId, source.sync_key)
      : db.prepare('SELECT * FROM products WHERE warehouse_id=? AND barcode=?').get(warehouseId, source.barcode);
    if (!created) fail(`无法在调入仓库建立物料「${source.name}」档案。`);
    return { product: created, created: true };
  };
  // Transfer legs carry no money: price and amount stay 0 and the line keeps the
  // exact moved cost so both warehouses' inventory value stays in balance.
  const insertLeg = (leg) =>
    Number(
      db
        .prepare(`INSERT INTO orders
      (number,type,partner,note,total,created_at,kind,source_order_id,partner_id,settlement_tracked,warehouse_id,created_by,created_by_name,transfer_id,transfer_warehouse_id)
      VALUES (?,?,?,?,0,?,'transfer',NULL,NULL,0,?,?,?,?,?)`)
        .run(leg.number, leg.type, leg.partner, leg.note, leg.at, leg.warehouseId, leg.user.id, leg.user.name, leg.transferId, leg.counterpartId)
        .lastInsertRowid,
    );

  app.get(
    '/api/transfers',
    route((req) => {
      const raw = req.query.offset ?? '0';
      if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
        fail('调拨记录分页参数无效。');
      const offset = Number(raw), limit = 30;
      const hideCosts = !hasPermission(req.user, 'finance') && !req.user.legacy_permissions;
      const total = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE warehouse_id=? AND kind='transfer'").get(req.warehouse.id).n;
      const rows = db
        .prepare("SELECT * FROM orders WHERE warehouse_id=? AND kind='transfer' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?")
        .all(req.warehouse.id, limit + 1, offset);
      const transfers = rows.slice(0, limit).map((leg) => {
        const items = itemsOf(leg.id);
        return {
          id: leg.id, transfer_id: leg.transfer_id, number: leg.number, direction: leg.type,
          warehouse_id: leg.warehouse_id, warehouse_name: warehouseName(leg.warehouse_id),
          counterpart_id: leg.transfer_warehouse_id, counterpart_name: warehouseName(leg.transfer_warehouse_id),
          note: leg.note, status: leg.status, void_reason: leg.void_reason, voided_at: leg.voided_at,
          created_at: leg.created_at, created_by_name: leg.created_by_name, item_count: items.length,
          cost_cents: hideCosts ? undefined : items.reduce((sum, i) => sum + (i.cost_cents || 0), 0),
          items: items.map((i) => ({
            product_id: i.product_id, name: i.name, quantity: i.quantity, cost_cents: hideCosts ? undefined : i.cost_cents,
          })),
        };
      });
      return { transfers, total, has_more: rows.length > limit };
    }),
  );

  app.post(
    '/api/transfers',
    route((req) =>
      mutation(req, () => {
        const body = req.body || {};
        if (!Number.isSafeInteger(body.to_warehouse_id)) fail('请选择调入仓库。');
        const target = db.prepare('SELECT * FROM warehouses WHERE id=?').get(body.to_warehouse_id);
        if (!target) fail('调入仓库不存在，请刷新后重试。');
        if (target.id === req.warehouse.id) fail('调入仓库不能与调出仓库相同。');
        const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : '仓库间调拨';
        if (note.length > 500) fail('调拨原因最多 500 字。');
        if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100)
          fail('每次调拨请选择 1–100 种物料。');
        const seen = new Set();
        // Destination products are resolved before any stock moves so a missing
        // archive fails the whole request instead of a half-applied transfer.
        const normalized = body.items.map((item) => {
          if (!integer(item?.product_id) || !validQuantity(item?.quantity, true))
            fail('调拨数量需为正数且最多 6 位小数。');
          if (seen.has(item.product_id)) fail('同一物料不能重复添加，请合并数量。');
          seen.add(item.product_id);
          const source = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(item.product_id, req.warehouse.id);
          if (!source) fail('物料不属于当前仓库。');
          if (source.stock < item.quantity)
            fail(`${source.name} 库存不足（当前 ${source.stock} ${source.unit}）。`);
          return { source, destination: destinationOf(source, target.id), quantity: item.quantity };
        });
        const at = new Date().toISOString(), transferId = randomUUID();
        const user = { id: req.user.id, name: req.user.username };
        const outNumber = nextNumber(`DC${at.slice(0, 10).replaceAll('-', '')}`);
        const inNumber = nextNumber(`DR${at.slice(0, 10).replaceAll('-', '')}`);
        const outLeg = insertLeg({ number: outNumber, type: 'out', partner: target.name, note, at, warehouseId: req.warehouse.id, counterpartId: target.id, transferId, user });
        const inLeg = insertLeg({ number: inNumber, type: 'in', partner: req.warehouse.name, note, at, warehouseId: target.id, counterpartId: req.warehouse.id, transferId, user });
        const insertItem = db.prepare('INSERT INTO order_items(order_id,product_id,name,barcode,quantity,price,cost_cents,amount_cents) VALUES (?,?,?,?,?,0,?,0)');
        const moved = normalized.map((item) => {
          const cost = moveInventory(db, item.source.id, -item.quantity);
          moveInventory(db, item.destination.product.id, item.quantity, cost);
          insertItem.run(outLeg, item.source.id, item.source.name, item.source.barcode, item.quantity, cost);
          insertItem.run(inLeg, item.destination.product.id, item.destination.product.name, item.destination.product.barcode, item.quantity, cost);
          return { name: item.source.name, unit: item.source.unit, quantity: item.quantity, cost_cents: cost, created: item.destination.created };
        });
        queueNotification(db, req, 'transfer', {
          number: outNumber, action: '仓库间调拨', from: req.warehouse.name, to: target.name, reason: note,
          items: moved.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
        });
        notifyStockChanges(db, req, normalized.map((i) => i.source), { number: outNumber });
        return {
          ok: true, transfer_id: transferId, number: outNumber, in_number: inNumber,
          created: moved.filter((i) => i.created).map((i) => i.name),
        };
      }),
    ),
  );

  app.post(
    '/api/transfers/:id/void',
    route((req) =>
      mutation(req, () => {
        const reason = reasonOf(req.body);
        const legs = db.prepare('SELECT * FROM orders WHERE transfer_id=?').all(req.params.id);
        const out = legs.find((leg) => leg.type === 'out'), incoming = legs.find((leg) => leg.type === 'in');
        if (!out || !incoming) fail('调拨记录不存在或已损坏。');
        if (out.warehouse_id !== req.warehouse.id) fail('请在调出仓库撤销该调拨。');
        if (out.status === 'void' || incoming.status === 'void') fail('该调拨已撤销。');
        for (const leg of [out, incoming]) {
          for (const item of itemsOf(leg.id)) {
            const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
            if (!product) fail('调拨物料档案缺失，无法撤销。');
            // Reverse exactly the cost this leg applied, mirroring order void rules.
            if (leg.type === 'in' && product.stock < item.quantity)
              fail(`${product.name} 在${warehouseName(leg.warehouse_id)}的库存不足，无法撤销调拨。`);
            moveInventory(db, item.product_id, leg.type === 'out' ? item.quantity : -item.quantity, item.cost_cents ?? undefined);
          }
        }
        const at = new Date().toISOString();
        db.prepare("UPDATE orders SET status='void',void_reason=?,voided_at=? WHERE transfer_id=?").run(reason, at, req.params.id);
        queueNotification(db, req, 'transfer', {
          number: out.number, action: '撤销仓库调拨', reason,
          from: warehouseName(out.warehouse_id), to: warehouseName(incoming.warehouse_id),
          items: itemsOf(out.id).map((i) => ({ name: i.name, quantity: i.quantity })),
        });
        return { ok: true };
      }),
    ),
  );
}
