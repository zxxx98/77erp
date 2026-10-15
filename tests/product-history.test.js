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
  const staff = (await f.request('/users', { username: 'reader', password: 'Test-staff-123' })).data.id;
  const cookie = (await f.request('/auth/login', { username: 'reader', password: 'Test-staff-123' }, 'POST', 1, null)).cookie;
  const path = `/products/${f.product}/history`;
  assert.equal((await f.request(path, undefined, 'GET', 1, null)).status, 401);
  const history = (await f.request(path, undefined, 'GET', 1, cookie)).data.records;
  assert.equal(history.length, 1);
  for (const key of ['price', 'cost_cents', 'total', 'amount_cents', 'inventory_value_cents']) assert.equal(Object.hasOwn(history[0], key), false);
  assert.equal((await f.request(`/users/${staff}/permissions`, { permissions: ['stocktake'], version: 1 }, 'PUT')).status, 200);
  assert.equal((await f.request(path, undefined, 'GET', 1, cookie)).data.records.length, 2);
});
