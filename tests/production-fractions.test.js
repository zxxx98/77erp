import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { exactQuantity, exactCompare } from '../shared/exact-quantity.js';

async function fixture(context, layered = false, { wholeUnits = false, rawValue = 1000 } = {}) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie = '';
  const request = async (path, body, expected = 200) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': '1', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify({ request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body }),
    });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  };
  await request('/auth/setup', { username: 'fractionadmin', password: 'Fraction-test-123' }, 201);
  await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = async name => (await request('/products', { name, barcode: name, category: '生产', unit: 'kg', cost: 1, price: 2, threshold: 0 }, 201)).id;
  const root = await product('fraction-root'), raw = await product('fraction-raw'), semi = layered ? await product('fraction-semi') : null;
  db.prepare('UPDATE products SET stock=10,inventory_value_cents=? WHERE id=?').run(rawValue, raw);
  if (wholeUnits) db.prepare('UPDATE products SET unit_round_up=1 WHERE id IN (?,?)').run(root, raw);
  const bom = async (productId, items) => request('/boms', { name: `BOM-${productId}`, product_id: productId, base_quantity: 1, base_unit: 'kg', note: '', enabled: 1, items });
  const item = { product_id: raw, quantity: 0.3334, quantity_fraction: '1/3', unit: 'kg', note: '' };
  const child = layered && await bom(semi, [item]);
  const recipe = await bom(root, layered ? [{ product_id: semi, quantity: 1, unit: 'kg', note: '', usage_mode: 'explode', child_bom_id: child.id }] : [item]);
  const plan = { bom_id: recipe.id, bom_version: recipe.version, planned_quantity: 3, note: '' };
  const prepared = await request('/production-orders/prepare', plan);
  let order = await request('/production-orders', { ...plan, structure_token: prepared.structure_token });
  order = await request(`/production-orders/${order.id}/start`, { version: order.version });
  await request(`/production-material-documents/${order.material_documents[0].id}/confirm`, { version: order.material_documents[0].version });
  const get = () => request(`/production-orders/${order.id}`);
  order = await get();
  const complete = (current, output, usage, extra = {}) => request(`/production-orders/${current.id}/complete`, { version: current.version, completed_quantity: output, items: [{ product_id: raw, quantity: usage }], scraps: [], finish_order: false, ...extra });
  const receive = doc => request(`/production-receipts/${doc.id}/confirm`, { version: doc.version });
  const stock = productId => db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  return { db, request, root, raw, semi, order, get, complete, receive, stock };
}

test('three one-third consumptions exhaust one issued unit exactly and survive backup restore', async context => {
  const fixtureData = await fixture(context);
  let order = fixtureData.order;
  for (let batch = 0; batch < 3; batch++) order = await fixtureData.complete(order, 1, '1/3');
  assert.equal(order.items[0].actual_quantity, 1);
  assert.equal(order.items[0].available_quantity, 0);
  assert.equal(order.items[0].available_cost_cents, 0);
  assert.equal(order.batches[0].items[0].actual_quantity_fraction, '1/3');
  order = await fixtureData.request(`/production-orders/${order.id}/finish`, { version: order.version });
  assert.equal(order.settled_completed_quantity, 3);
  assert.equal(order.quantity_rounding.length, 0);
  const backup = await fixtureData.request('/backup');
  const preview = await fixtureData.request('/backup/preview', { backup });
  await fixtureData.request('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' });
  order = await fixtureData.get();
  assert.equal(order.items[0].available_quantity, 0);
  const forged = structuredClone(backup);
  forged.data.production_batch_items[0].actual_quantity_fraction = '1/2';
  await fixtureData.request('/backup/preview', { backup: forged }, 400);
});

test('fraction receipts remain exact until finish; final rounding and reopening conserve inventory and costs', async context => {
  const fixtureData = await fixture(context);
  let order = await fixtureData.complete(fixtureData.order, '1/3', '1/3');
  await fixtureData.receive(order.receipt_documents[0]);
  assert.equal(exactQuantity(fixtureData.stock(fixtureData.root), 'stock'), '1/3');
  order = await fixtureData.get();
  order = await fixtureData.request(`/production-orders/${order.id}/finish`, { version: order.version });
  assert.equal(order.completed_quantity_fraction, '1/3');
  assert.equal(order.settled_completed_quantity, 0.3334);
  assert.equal(fixtureData.stock(fixtureData.root).stock, 0.3334);
  assert.equal(exactCompare(exactQuantity(order.items[0], 'available_quantity'), '3333/5000'), 0);
  assert.equal(order.quantity_rounding.filter(row => row.kind === 'material').length, 1);
  const batchId = order.batches[0].id;
  order = await fixtureData.request(`/production-orders/${order.id}/batches/${batchId}/void`, { version: order.version, reason: '纠正分数登记' });
  assert.equal(fixtureData.stock(fixtureData.root).stock, 0);
  assert.equal(fixtureData.stock(fixtureData.root).inventory_value_cents, 0);
  assert.equal(order.items[0].available_quantity, 1);
  assert.equal(order.quantity_rounding.length, 0);
});

test('partial semi-finished allocations preserve exact raw provenance and reversible FIFO costs', async context => {
  const fixtureData = await fixture(context, true);
  let order = fixtureData.order;
  const complete = (path, output, inputPath, usage) => fixtureData.request(`/production-orders/${order.id}/stages/complete`, { version: order.version, path, completed_quantity: output, items: [{ path: inputPath, quantity: usage }], scraps: [], note: '', finish_order: false });
  order = await complete('1', 1, '1.1', '1/3');
  order = await complete('', '1/3', '1', '1/3');
  assert.equal(exactQuantity(order.stages.find(row => row.path === '1'), 'available_quantity'), '2/3');
  assert.equal(exactQuantity(order.items[0], 'actual_quantity'), '1/9');
  order = await complete('', '2/3', '1', '2/3');
  assert.equal(order.stages.find(row => row.path === '1').available_quantity, 0);
  assert.equal(exactQuantity(order.items[0], 'actual_quantity'), '1/3');
  assert.equal(order.completed_quantity, 1);
  for (const document of order.receipt_documents) await fixtureData.receive(document);
  assert.equal(fixtureData.stock(fixtureData.root).stock, 1);
  const backup = await fixtureData.request('/backup');
  await fixtureData.request('/backup/preview', { backup });
});

test('pending receipts carry final rounding cents without posting stock and zero-quantity cost adjustments reverse', async context => {
  const fixtureData = await fixture(context, false, { rawValue: 10000000 });
  let order = await fixtureData.complete(fixtureData.order, 1, '1/3');
  const originalCost = order.batches[0].total_cost_cents;
  const previousReceipt = order.receipt_documents[0];
  order = await fixtureData.request(`/production-orders/${order.id}/finish`, { version: order.version });
  const outputAdjustment = order.quantity_rounding.find(row => row.kind === 'product');
  assert.equal(outputAdjustment.quantity, 0);
  assert.ok(outputAdjustment.cost_cents > 0);
  assert.equal(fixtureData.stock(fixtureData.root).stock, 0);
  await fixtureData.request(`/production-receipts/${previousReceipt.id}/confirm`, { version: previousReceipt.version }, 409);
  await fixtureData.receive(order.receipt_documents[0]);
  assert.equal(fixtureData.stock(fixtureData.root).inventory_value_cents, originalCost + outputAdjustment.cost_cents);
  const backup = await fixtureData.request('/backup');
  const preview = await fixtureData.request('/backup/preview', { backup });
  await fixtureData.request('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' });
  order = await fixtureData.get();
  order = await fixtureData.request(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, { version: order.version, reason: '回退取整成本' });
  assert.equal(fixtureData.stock(fixtureData.root).inventory_value_cents, 0);
  assert.equal(order.items[0].available_cost_cents, 1000000);
});

test('whole-unit materials and output retain fractions until one final settlement', async context => {
  const fixtureData = await fixture(context, false, { wholeUnits: true });
  let order = await fixtureData.complete(fixtureData.order, '1/3', '1/3');
  await fixtureData.receive(order.receipt_documents[0]);
  assert.equal(fixtureData.stock(fixtureData.root).stock_fraction, '1/3');
  order = await fixtureData.get();
  order = await fixtureData.request(`/production-orders/${order.id}/finish`, { version: order.version });
  assert.equal(order.settled_completed_quantity, 1);
  assert.equal(order.items[0].consumed_quantity, 1);
  assert.equal(order.items[0].available_quantity, 0);
  assert.equal(fixtureData.stock(fixtureData.root).stock, 1);
  assert.equal(fixtureData.stock(fixtureData.root).inventory_value_cents, 100);
  await fixtureData.request('/backup/preview', { backup: await fixtureData.request('/backup') });
});

test('fractional material requests, issues and returns preserve warehouse balances and backup after settlement', async context => {
  const fixtureData = await fixture(context);
  let order = await fixtureData.complete(fixtureData.order, '1/3', '1/3');
  order = await fixtureData.request(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items: [{ product_id: fixtureData.raw, quantity: '1/3' }] });
  const supplement = order.material_documents.at(-1);
  await fixtureData.request(`/production-material-documents/${supplement.id}/confirm`, { version: supplement.version });
  assert.equal(exactCompare(exactQuantity(fixtureData.stock(fixtureData.raw), 'stock'), '26/3'), 0);
  order = await fixtureData.get();
  order = await fixtureData.request(`/production-orders/${order.id}/finish`, { version: order.version });
  const available = exactQuantity(order.items[0], 'available_quantity');
  order = await fixtureData.request(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: [{ product_id: fixtureData.raw, quantity: available }] });
  const returned = order.material_documents.at(-1);
  await fixtureData.request(`/production-material-documents/${returned.id}/confirm`, { version: returned.version });
  order = await fixtureData.get();
  assert.equal(order.items[0].available_quantity, 0);
  assert.equal(order.items[0].available_cost_cents, 0);
  await fixtureData.request('/backup/preview', { backup: await fixtureData.request('/backup') });
});

test('invalid fractions and insufficient final rounding fail atomically', async context => {
  const fixtureData = await fixture(context);
  let order = fixtureData.order;
  for (const quantity of ['1/0', '-1/3', '0/3', '100000000/1']) {
    await fixtureData.request(`/production-orders/${order.id}/complete`, { version: order.version, completed_quantity: quantity, items: [{product_id: fixtureData.raw, quantity: '1/3'}], scraps: [], finish_order: false }, 400);
    assert.equal((await fixtureData.get()).batches.length, 0);
  }
  order = await fixtureData.complete(order, '1/3', '1/3');
  order = await fixtureData.request(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: [{product_id:fixtureData.raw, quantity:'2/3'}] });
  const returned = order.material_documents.at(-1);
  await fixtureData.request(`/production-material-documents/${returned.id}/confirm`, {version:returned.version});
  order = await fixtureData.get();
  await fixtureData.request(`/production-orders/${order.id}/finish`, {version:order.version}, 400);
  const after = await fixtureData.get();
  assert.equal(after.status, 'in_progress');
  assert.equal(after.version, order.version);
  assert.equal(after.quantity_rounding.length, 0);
});
