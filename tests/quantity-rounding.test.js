import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { calculateBomNodes } from '../shared/bom-expansion.js';
import { parseQuantity, validQuantity, addQuantity } from '../shared/quantity.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify({ request_id: randomUUID(), ...body }),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', { username: 'rounding', password: 'Strong-password-123' })).cookie;
  const ok = result => { assert.ok(result.status < 300, JSON.stringify(result.data)); return result.data; };
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const product = async (name, extra = {}) => ok(await request('/products', { name, category: '算料', unit: '个', cost: 2, price: 3, threshold: 0, ...extra })).id;
  return { db, request, ok, product };
}

test('new quantities have four decimals and legacy arithmetic retains exact millionths', () => {
  assert.equal(parseQuantity('0.0001', true), 0.0001);
  for (const value of ['0.00001', '1.12345', '0.000001']) assert.throws(() => parseQuantity(value), /4 位/);
  assert.equal(validQuantity(1.12345), false);
  assert.equal(addQuantity(0.123456, 0.0001), 0.123556);
});

test('whole-unit materials round orders, stock operations and imports before costing; flag survives edits, sync and backup', async t => {
  const f = await fixture(t), id = await f.product('纸箱', { unit_round_up: true });
  f.ok(await f.request('/orders', { type: 'in', partner: '供应商', items: [{ product_id: id, quantity: 4.1, price: 2 }] }));
  assert.deepEqual({ ...f.db.prepare('SELECT stock,inventory_value_cents,unit_round_up FROM products WHERE id=?').get(id) }, { stock: 5, inventory_value_cents: 1000, unit_round_up: 1 });
  f.ok(await f.request('/orders', { type: 'out', partner: '客户', items: [{ product_id: id, quantity: 1.1, price: 3 }] }));
  assert.equal(f.db.prepare('SELECT quantity FROM order_items ORDER BY id DESC').get().quantity, 2);
  f.ok(await f.request('/stock/increase', { product_id: id, quantity: 0.1, expected_stock: 3, reason: '退料' }));
  f.ok(await f.request('/stocktakes', { reason: '盘点', items: [{ product_id: id, expected_stock: 4, counted: 4.1 }] }));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock, 5);
  const current = f.db.prepare('SELECT * FROM products WHERE id=?').get(id);
  const { unit_round_up, ...olderClient } = current;
  f.ok(await f.request(`/products/${id}`, { ...olderClient, customer_part_numbers: [], name: '纸箱新版' }, 'PUT'));
  assert.equal(f.db.prepare('SELECT unit_round_up FROM products WHERE id=?').get(id).unit_round_up, 1);
  const warehouse = f.ok(await f.request('/warehouses', { name: '分仓', reuse_catalog: false })).id;
  const latest = f.db.prepare('SELECT * FROM products WHERE id=?').get(id);
  f.ok(await f.request(`/products/${id}`, { ...latest, customer_part_numbers: [], sync_warehouse_ids: [warehouse] }, 'PUT'));
  assert.equal(f.db.prepare('SELECT unit_round_up FROM products WHERE warehouse_id=?').get(warehouse).unit_round_up, 1);
  const rows = [{ name: '整件导入', unit: '个', category: '算料', cost: 2, price: 3, stock: 4.1, threshold: 0, unit_round_up: 1 }];
  const preview = f.ok(await f.request('/products/import/preview', { rows }));
  f.ok(await f.request('/products/import', { rows, token: preview.token }));
  assert.equal(f.db.prepare("SELECT stock FROM products WHERE name='整件导入'").get().stock, 5);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.request('/backup/preview', { backup }));
  assert.equal(backup.data.products.find(p => p.id === id).unit_round_up, 1);
});

test('BOM rounds to four decimals, sums repeated materials before integer rounding and snapshots the rule in production', async t => {
  const f = await fixture(t), parent = await f.product('成品'), box = await f.product('箱', { unit_round_up: 1 });
  const bom = f.ok(await f.request('/boms', { product_id: parent, name: '装箱', base_quantity: 1, base_unit: '个', note: '', enabled: 1,
    items: [{ product_id: box, quantity: 4.1, unit: '个', note: '' }] }));
  const plan = f.ok(await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 }));
  assert.equal(plan.rows[0].required, 5);
  const order = f.ok(await f.request('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 1, note: '' }));
  assert.equal(order.items[0].planned_quantity, 5);
  assert.equal(order.items[0].unit_round_up, 1);
  f.db.prepare('UPDATE products SET unit_round_up=0 WHERE id=?').run(box);
  const edited = f.ok(await f.request(`/production-orders/${order.id}`, { version: order.version, planned_quantity: 2, note: '' }));
  assert.equal(edited.items[0].planned_quantity, 9);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.request('/backup/preview', { backup }));
  const node = { path: '1', parent_path: '', product_id: box, name: '箱', unit: '个', quantity: 0.41, quantity_fraction: '', loss_rate: 0, loss_method: 'internal', bom_base_quantity: 1, usage_mode: 'stock', unit_round_up: 1 };
  assert.equal(calculateBomNodes([node, { ...node, path: '2' }], 1).rows[0].required, 1);
  assert.equal(calculateBomNodes([{ ...node, unit_round_up: 0, quantity: 1, bom_base_quantity: 3 }], 1).rows[0].required, 0.3334);
});

test('existing six-decimal inventory remains usable and backup format 32 restores it without rounding', async t => {
  const f = await fixture(t), id = await f.product('历史余量');
  f.db.prepare('UPDATE products SET stock=0.123456,threshold=0.123456,inventory_value_cents=25 WHERE id=?').run(id);
  f.ok(await f.request('/orders', { type: 'in', partner: '供应商', items: [{ product_id: id, quantity: 0.0001, price: 2 }] }));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock, 0.123556);
  const backup = f.ok(await f.request('/backup'));
  backup.version = 32;
  for (const p of backup.data.products) delete p.unit_round_up;
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.request('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock, 0.123556);
});

test('historic six-decimal production standards and backup validation keep their saved precision', async t => {
  const f = await fixture(t), parent = await f.product('历史成品'), raw = await f.product('历史原料');
  const bom = f.ok(await f.request('/boms', { product_id: parent, name: '历史分数配方', base_quantity: 1, base_unit: '个', note: '', enabled: 1,
    items: [{ product_id: raw, quantity: 0.3334, quantity_fraction: '1/3', unit: '个', note: '' }] }));
  const order = f.ok(await f.request('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 1, note: '' }));
  // Reproduce facts persisted by format 32, before the four-decimal rule existed.
  f.db.prepare('UPDATE production_orders SET quantity_decimals=6 WHERE id=?').run(order.id);
  f.db.prepare('UPDATE production_items SET base_quantity=0.333334,planned_quantity=0.333334 WHERE production_id=?').run(order.id);
  const backup = f.ok(await f.request('/backup'));
  backup.version = 32;
  for (const table of ['products', 'production_orders', 'production_items', 'production_scraps', 'production_bom_nodes'])
    for (const row of backup.data[table]) delete row.unit_round_up;
  for (const row of backup.data.production_orders) delete row.quantity_decimals;
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.request('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  const saved = f.ok(await f.request(`/production-orders/${order.id}`));
  const edited = f.ok(await f.request(`/production-orders/${order.id}`, { version: saved.version, planned_quantity: 2, note: '' }));
  assert.equal(edited.items[0].planned_quantity, 0.666667);
});
