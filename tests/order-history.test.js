import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { warehouseOrders } from '../server/order-history.js';

test('large warehouse histories use a bounded number of queries, retain all lines and isolate finance and warehouses', t => {
  const { db } = createApp(':memory:');
  t.after(() => db.close());
  db.exec("INSERT INTO warehouses(id,name,created_at) VALUES (2,'other','2026-01-01')");
  const insertOrder = db.prepare(`INSERT INTO orders(number,type,partner,total,created_at,warehouse_id,settlement_tracked)
    VALUES (?,'out','customer',1,'2026-01-01',?,1)`);
  const insertItem = db.prepare(`INSERT INTO order_items(order_id,product_id,name,barcode,quantity,price,cost_cents,amount_cents)
    VALUES (?,1,'item','code',1,1,40,100)`);
  db.exec('BEGIN');
  for (let n = 0; n < 5000; n++) insertItem.run(insertOrder.run(`HISTORY-${n}`, 1).lastInsertRowid);
  const other = Number(insertOrder.run('OTHER-WAREHOUSE', 2).lastInsertRowid);
  db.exec('COMMIT');
  const original = db.prepare("SELECT id FROM orders WHERE number='HISTORY-0'").get().id;
  const returned = Number(insertOrder.run('RETURN', 1).lastInsertRowid);
  db.prepare("UPDATE orders SET kind='return',type='in',source_order_id=? WHERE id=?").run(original, returned);
  insertItem.run(returned);
  const voided = Number(insertOrder.run('VOID-RETURN', 1).lastInsertRowid);
  db.prepare("UPDATE orders SET kind='return',type='in',source_order_id=?,status='void' WHERE id=?").run(original, voided);
  insertItem.run(voided);
  db.prepare("INSERT INTO payments(order_id,amount_cents,method,note,created_at) VALUES (?,30,'cash','','2026-01-01')").run(original);
  db.prepare("INSERT INTO payments(order_id,amount_cents,method,note,created_at,reversed_at) VALUES (?,50,'cash','','2026-01-01','2026-01-02')").run(original);
  const expectedCount = db.prepare('SELECT count(*) n FROM orders WHERE warehouse_id=1').get().n;
  let queries = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = (...args) => { queries++; return prepare(...args); };
  const history = warehouseOrders(db, 1, { financial: true });
  assert.ok(queries <= 4, `${queries} queries for ${expectedCount} orders`);
  assert.equal(history.length, expectedCount);
  assert.ok(history.every(o => o.id !== other && o.items.length === 1));
  const source = history.find(o => o.id === original);
  assert.equal(source.items[0].returned_quantity, 1);
  assert.equal(source.paid_cents, 30);
  assert.equal(source.due_cents, 70);
  assert.equal(source.items[0].cost_cents, 40);
  queries = 0;
  const restricted = warehouseOrders(db, 1, { hideCosts: true });
  assert.ok(queries <= 3);
  assert.ok(restricted.every(o => !('paid_cents' in o) && !('due_cents' in o) && o.items.every(i => !('cost_cents' in i))));
  assert.equal(restricted.find(o => o.id === original).items[0].amount_cents, 100);
});
