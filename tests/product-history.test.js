import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST', warehouse = 1, auth = cookie) => {
    // API clients send arrays; raw SQLite fixtures store this field as JSON.
    if (method === 'PUT' && /^\/products\/\d+$/.test(path) && typeof body?.customer_part_numbers === 'string') body = { ...body, customer_part_numbers: JSON.parse(body.customer_part_numbers) };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(auth ? { Cookie: auth } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouse = (await request('/warehouses', { name: '记录分仓' })).data.id;
  const product = (await request('/products', { name: '记录测试物料', barcode: 'HISTORY-1', category: '记录分类', unit: '件', cost: 10, price: 20, threshold: 1, sync_warehouse_ids: [warehouse] })).data.id;
  const command = (path, body) => request(path, { request_id: randomUUID(), ...body });
  const order = async (type, quantity) => {
    const result = await request('/orders', { type, partner: '记录往来单位', items: [{ product_id: product, quantity, price: 10 }] });
    assert.equal(result.status, 201);
    return result.data;
  };
  return { request, db, product, warehouse, command, order };
}

test('price audit captures actual before/after values and actor atomically, including synchronized warehouses', async t => {
  const f = await fixture(t);
  const current = () => f.db.prepare('SELECT * FROM products WHERE id=?').get(f.product);
  const changes = () => f.db.prepare('SELECT * FROM product_changes ORDER BY id').all();
  const original = current();
  assert.equal((await f.request(`/products/${f.product}`, { ...original, cost: 12.34, price: 25.67, sync_warehouse_ids: [f.warehouse] }, 'PUT')).status, 200);
  assert.equal(changes().length, 2);
  for (const change of changes()) {
    assert.equal(change.before_cost, 10);
    assert.equal(change.after_cost, 12.34);
    assert.equal(change.before_price, 20);
    assert.equal(change.after_price, 25.67);
    assert.equal(change.created_by_name, 'admin');
    assert.equal(change.created_by, f.db.prepare("SELECT id FROM users WHERE username='admin'").get().id);
    assert.ok(Number.isFinite(Date.parse(change.created_at)));
  }
  const snapshot = changes();
  assert.equal((await f.request(`/products/${f.product}`, { ...current(), note: '仅改备注', sync_warehouse_ids: [f.warehouse] }, 'PUT')).status, 200);
  assert.deepEqual(changes(), snapshot);
  assert.equal((await f.request(`/products/${f.product}`, { ...original, price: 99 }, 'PUT')).status, 409);
  const saved = current();
  assert.equal((await f.request(`/products/${f.product}`, { ...saved, price: 99, sync_warehouse_ids: [f.warehouse, 999999] }, 'PUT')).status, 400);
  assert.deepEqual(current(), saved);
  assert.deepEqual(changes(), snapshot);
  const records = (await f.request(`/products/${f.product}/history`)).data.records;
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'price_change');
  assert.equal(records[0].after_cost, 12.34);
  assert.equal(records[0].operator, 'admin');
  const remote = changes()[1].product_id;
  assert.equal((await f.request(`/products/${remote}/history`, undefined, 'GET', f.warehouse)).data.records.length, 1);
  assert.equal((await f.request(`/products/${remote}/history`)).status, 400);
  assert.match((await f.request(`/products/${f.product}`, {}, 'DELETE')).data.error, /改价记录/);
});

test('price history is restricted to finance permission and records the authenticated employee', async t => {
  const f = await fixture(t);
  const staff = (await f.request('/users', { position_id: readonlyPositionId(f.db), username: 'editor', password: 'Test-staff-123' })).data.id;
  assert.equal((await grantPosition(f.db, (path, body, method) => f.request(path, body, method), staff, ['basic_view', 'products'])).status, 200);
  const auth = (await f.request('/auth/login', { username: 'editor', password: 'Test-staff-123' }, 'POST', 1, null)).cookie;
  const product = f.db.prepare('SELECT * FROM products WHERE id=?').get(f.product);
  assert.equal((await f.request(`/products/${f.product}`, { ...product, price: 0, created_by_name: 'forged' }, 'PUT', 1, auth)).status, 200);
  const path = `/products/${f.product}/history`;
  assert.deepEqual((await f.request(path, undefined, 'GET', 1, auth)).data.records, []);
  assert.equal((await grantPosition(f.db, (path, body, method) => f.request(path, body, method), staff, ['basic_view', 'products', 'finance'])).status, 200);
  const record = (await f.request(path, undefined, 'GET', 1, auth)).data.records[0];
  assert.equal(record.operator, 'editor');
  assert.equal(record.before_price, 20);
  assert.equal(record.after_price, 0);
});

test('price audit survives backup restore, validates records, supports legacy backups and clears on business reset', async t => {
  const f = await fixture(t);
  const product = f.db.prepare('SELECT * FROM products WHERE id=?').get(f.product);
  await f.request(`/products/${f.product}`, { ...product, price: 21 }, 'PUT');
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 41);
  assert.equal(backup.data.product_changes.length, 1);
  for (const patch of [{ after_cost: -1 }, { product_id: 999999 }, { created_by: -1 }, { created_by_name: '' }]) {
    const invalid = structuredClone(backup);
    Object.assign(invalid.data.product_changes[0], patch);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const restore = async value => {
    const preview = await f.request('/backup/preview', { backup: value });
    assert.equal(preview.status, 200);
    assert.equal((await f.command('/backup/restore', { backup: value, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  };
  await restore(backup);
  assert.deepEqual((await f.request('/backup')).data.data.product_changes, backup.data.product_changes);
  const foreign = { ...backup, source_instance_id: 'another-server' };
  await restore(foreign);
  assert.equal(f.db.prepare('SELECT created_by,created_by_name FROM product_changes').get().created_by, null);
  assert.equal(f.db.prepare('SELECT created_by_name FROM product_changes').get().created_by_name, 'admin');
  const legacy = structuredClone(backup);
  legacy.version = 12;
  delete legacy.data.product_changes;
  await restore(legacy);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM product_changes').get().n, 0);
  await restore(backup);
  assert.equal((await f.request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM product_changes').get().n, 0);
});

test('product history merges orders, returns, void reversals and stock adjustments, isolated to the current product and warehouse', async t => {
  const f = await fixture(t);
  await f.order('in', 10);
  const sale = await f.order('out', 3);
  const returned = await f.command(`/orders/${sale.id}/returns`, { reason: '记录退货', items: [{ product_id: f.product, quantity: 1 }] });
  assert.equal(returned.status, 200);
  assert.equal((await f.command(`/orders/${returned.data.id}/void`, { reason: '记录作废退货' })).status, 200);
  assert.equal((await f.command('/stocktakes', { reason: '记录盘点', items: [{ product_id: f.product, expected_stock: 7, counted: 6.5 }] })).status, 200);
  assert.equal((await f.command('/stock/reduce', { product_id: f.product, quantity: 0.5, reason: '记录报损' })).status, 200);
  const response = await f.request(`/products/${f.product}/history`);
  assert.equal(response.status, 200);
  const { records, has_more } = response.data;
  assert.equal(records.length, 6);
  assert.equal(has_more, false);
  assert.deepEqual(records.map(r => r.created_at), records.map(r => r.created_at).sort().reverse());
  assert.deepEqual(records.filter(r => r.event === 'order').map(r => r.delta).sort((a,b) => a-b), [-3, 1, 10]);
  assert.equal(records.find(r => r.event === 'void').delta, -1);
  assert.equal(records.find(r => r.event === 'void').note, '记录作废退货');
  assert.equal(records.find(r => r.event === 'stocktake').after_stock, 6.5);
  assert.equal(records.find(r => r.event === 'reduce').delta, -0.5);
  assert.equal(records.find(r => r.event === 'order' && r.order_id === sale.id).operator, 'admin');
  assert.equal((await f.request(`/products/${f.product}/history`, undefined, 'GET', f.warehouse)).status, 400);
  assert.equal((await f.request('/products/999999/history')).status, 404);
  const remote = (await f.request('/data', undefined, 'GET', f.warehouse)).data.products[0];
  assert.deepEqual((await f.request(`/products/${remote.id}/history`, undefined, 'GET', f.warehouse)).data.records, []);
});

test('history pagination has no duplicates and rejects invalid offsets', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 25; i++) await f.order('in', 1);
  const first = (await f.request(`/products/${f.product}/history`)).data;
  const second = (await f.request(`/products/${f.product}/history?offset=20`)).data;
  assert.equal(first.records.length, 20);
  assert.equal(first.has_more, true);
  assert.equal(second.records.length, 5);
  assert.equal(second.has_more, false);
  assert.equal(new Set([...first.records, ...second.records].map(r => r.order_id)).size, 25);
  for (const offset of ['-1', 'abc', '1.5', '9007199254740992', '0&offset=1'])
    assert.equal((await f.request(`/products/${f.product}/history?offset=${offset}`)).status, 400);
});

test('history requires login, keeps stocktake permissions and omits financial fields for employees', async t => {
  const f = await fixture(t);
  await f.order('in', 1);
  await f.command('/stocktakes', { reason: '盘点权限', items: [{ product_id: f.product, expected_stock: 1, counted: 1 }] });
  const staff = (await f.request('/users', { position_id: readonlyPositionId(f.db), username: 'reader', password: 'Test-staff-123' })).data.id;
  const cookie = (await f.request('/auth/login', { username: 'reader', password: 'Test-staff-123' }, 'POST', 1, null)).cookie;
  const path = `/products/${f.product}/history`;
  assert.equal((await f.request(path, undefined, 'GET', 1, null)).status, 401);
  const history = (await f.request(path, undefined, 'GET', 1, cookie)).data.records;
  assert.equal(history.length, 1);
  for (const key of ['price', 'cost_cents', 'total', 'amount_cents', 'inventory_value_cents']) assert.equal(Object.hasOwn(history[0], key), false);
  assert.equal((await grantPosition(f.db, (path, body, method) => f.request(path, body, method), staff, ['basic_view', 'stocktake'])).status, 200);
  assert.equal((await f.request(path, undefined, 'GET', 1, cookie)).data.records.length, 2);
});
