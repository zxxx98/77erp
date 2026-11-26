import { addQuantity } from '../shared/quantity.js';
import { orderLineAmount } from '../shared/money.js';
import { settlementFromPaid } from './commerce.js';

// The caller aliases the outer orders table as o.
export const returnLinks = `(SELECT number FROM orders WHERE id=o.source_order_id) AS source_number,
  (SELECT number FROM orders WHERE source_order_id=o.id AND return_mode='replacement' AND status IN ('pending','active')) AS replacement_number,
  (SELECT id FROM orders WHERE source_order_id=o.id AND return_mode='replacement' AND status IN ('pending','active')) AS replacement_id,
  (SELECT status FROM orders WHERE source_order_id=o.id AND return_mode='replacement' AND status IN ('pending','active')) AS replacement_status`;

export function migrateOrderIndexes(db) {
  db.exec(`CREATE INDEX IF NOT EXISTS orders_warehouse_time ON orders(warehouse_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS orders_source_status ON orders(source_order_id,status);
    CREATE INDEX IF NOT EXISTS order_items_order_product ON order_items(order_id,product_id);
    CREATE INDEX IF NOT EXISTS payments_order_active ON payments(order_id) WHERE reversed_at IS NULL;`);
}

// Keep the existing workspace contract, but fetch each collection once instead of
// scanning the full item/payment tables for every historical order and item.
export function warehouseOrders(db, warehouseId, { financial = false, hideCosts = false } = {}) {
  const orders = db.prepare(`SELECT o.*, ${returnLinks} FROM orders o WHERE warehouse_id=? ORDER BY created_at DESC,id DESC`).all(warehouseId);
  const byId = new Map(orders.map(order => [order.id, { ...order, items: [] }]));
  const returns = new Map();
  for (const row of db.prepare(`SELECT o.source_order_id,i.source_item_id,i.product_id,SUM(i.quantity) AS quantity
    FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.warehouse_id=? AND o.kind='return' AND o.source_order_id IS NOT NULL AND o.status='active'
    GROUP BY o.source_order_id,i.source_item_id,i.product_id`).all(warehouseId)) {
    returns.set(row.source_item_id == null ? `${row.source_order_id}:${row.product_id}` : `line:${row.source_item_id}`, addQuantity(0, row.quantity));
  }
  for (const item of db.prepare(`SELECT i.* FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.warehouse_id=? ORDER BY i.id`).all(warehouseId)) {
    if (hideCosts) delete item.cost_cents;
    byId.get(item.order_id).items.push({ ...item, amount_cents: orderLineAmount(item),
      returned_quantity: addQuantity(returns.get(`line:${item.id}`) || 0, returns.get(`${item.order_id}:${item.product_id}`) || 0) });
  }
  if (financial) {
    const paid = new Map(db.prepare(`SELECT p.order_id,SUM(p.amount_cents) AS amount
      FROM orders o JOIN payments p ON p.order_id=o.id
      WHERE o.warehouse_id=? AND p.reversed_at IS NULL GROUP BY p.order_id`).all(warehouseId)
      .map(row => [row.order_id, row.amount]));
    for (const order of byId.values()) Object.assign(order, settlementFromPaid(order, paid.get(order.id) || 0));
  }
  return [...byId.values()];
}
