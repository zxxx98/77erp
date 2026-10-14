import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
const product = {name: '状态物料', barcode: 'LIFE-001', category: '日用', unit: '件', cost: 10, price: 20, threshold: 0};
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1, auth = true, selectedCookie = cookie) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(auth && selectedCookie ? { Cookie: selectedCookie } : {}) }, body: body === undefined ? (method === 'DELETE' ? '{}' : undefined) : JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouse = async name => { const r = await request('/warehouses', 'POST', { name }); assert.equal(r.status, 201); return r.data.id; };
  const command = (path, body, warehouse = 1) => request(path, 'POST', { request_id: randomUUID(), ...body }, warehouse);
  const order = (id, type, quantity, warehouse = 1, price = 10) => request('/orders', 'POST', { type, partner: '往来单位', items: [{ product_id: id, quantity, price }] }, warehouse);
  return { db, request, warehouse, command, order };
}


test('listing changes preserve stock and history, remain local to a warehouse, and allow clearance and returns', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  const created = await f.request('/products', 'POST', {...product, sync_warehouse_ids: [w]});
  const id = created.data.id;
  const incoming = await f.order(id, 'in', 2);
  assert.equal(incoming.status, 201);
  const before = (await f.request('/data')).data;
  assert.equal((await f.request(`/products/${id}/status`, 'POST', {active: 0})).status, 200);
  const after = (await f.request('/data')).data;
  assert.deepEqual(after.orders, before.orders);
  assert.deepEqual(after.products[0], {...before.products[0], active: 0, version: after.products[0].version});
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.products[0].active, 1);
  assert.equal((await f.request(`/products/${id}`, 'PUT', {...product, version: after.products[0].version, name: '编辑后'})).status, 200);
  assert.equal((await f.request('/data')).data.products[0].active, 0);
  const outgoing = await f.order(id, 'out', 2);
  assert.equal(outgoing.status, 201);
  assert.equal((await f.request(`/products/${id}`, 'DELETE')).status, 400);
  const returned = await f.command(`/orders/${outgoing.data.id}/returns`, {reason: '客户退货', items: [{product_id: id, quantity: 1}]});
  assert.equal(returned.status, 200);
  assert.equal((await f.request(`/products/${id}/status`, 'POST', {active: 1})).status, 200);
  assert.equal((await f.request('/data')).data.products[0].active, 1);
  for (const active of [null, '0', false, 2]) assert.equal((await f.request(`/products/${id}/status`, 'POST', {active})).status, 400);
  assert.equal((await f.request(`/products/${id}/status`, 'POST', {active: 0}, w)).status, 400);
  assert.equal((await f.request(`/products/${id}`, 'DELETE', undefined, w)).status, 400);
  assert.equal((await f.request('/products/999999/status', 'POST', {active: 0})).status, 404);
});

test('deletion rejects stock, valuation, stock adjustments and template references, and deletes only an unused local product', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  const id = (await f.request('/products', 'POST', {...product, sync_warehouse_ids: [w]})).data.id;
  f.db.prepare('UPDATE products SET stock=1 WHERE id=?').run(id);
  assert.equal((await f.request(`/products/${id}`, 'DELETE')).status, 400);
  f.db.prepare('UPDATE products SET stock=0,inventory_value_cents=1 WHERE id=?').run(id);
  assert.equal((await f.request(`/products/${id}`, 'DELETE')).status, 400);
  f.db.prepare('UPDATE products SET inventory_value_cents=0 WHERE id=?').run(id);
  const template = await f.command('/templates', { name: '常用模板',type: 'in', partner: '供应商', note: '', items: [{product_id: id, quantity: 1, price: 10}]});
  assert.equal(template.status, 200);
  assert.equal((await f.request(`/products/${id}`, 'DELETE')).status, 400);
  assert.equal((await f.command(`/templates/${template.data.id}/delete`, {version: template.data.version})).status, 200);
  assert.equal((await f.request(`/products/${id}`, 'DELETE')).status, 200);
  assert.equal((await f.request('/data')).data.products.length, 0);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.products.length, 1);
  assert.equal((await f.request(`/products/${id}`, 'DELETE')).status, 404);
  const adjusted = (await f.request('/products', 'POST', {...product, barcode: 'LIFE-002'})).data.id;
  const stocktake = await f.command('/stocktakes', {reason: '盘点', items: [{product_id: adjusted, expected_stock: 0, counted: 0}]});
  assert.equal(stocktake.status, 200);
  assert.equal((await f.request(`/products/${adjusted}`, 'DELETE')).status, 400);
});

test('employees cannot change listing state or delete products', async t => {
  const f = await fixture(t);
  const id = (await f.request('/products', 'POST', product)).data.id;
  assert.equal((await f.request('/users', 'POST', {username: 'staff', password: 'Test-staff-123'})).status, 201);
  const login = await f.request('/auth/login', 'POST', {username: 'staff', password: 'Test-staff-123'});
  assert.equal(login.status, 200);
  assert.equal((await f.request(`/products/${id}/status`, 'POST', {active: 0}, 1, true, login.cookie)).status, 403);
  assert.equal((await f.request(`/products/${id}`, 'DELETE', undefined, 1, true, login.cookie)).status, 403);
  assert.equal((await f.request('/data', 'GET', undefined, 1, true, login.cookie)).data.products[0].active, 1);
});

test('backups retain listing states and accept older backups without the field', async t => {
  const f = await fixture(t);
  const id = (await f.request('/products', 'POST', product)).data.id;
  await f.request(`/products/${id}/status`, 'POST', {active: 0});
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.data.products[0].active, 0);
  const preview = await f.request('/backup/preview', 'POST', {backup});
  assert.equal(preview.status, 200);
  assert.equal((await f.command('/backup/restore', {backup, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA'})).status, 200);
  assert.equal((await f.request('/data')).data.products[0].active, 0);
  const legacy = structuredClone(backup);
  delete legacy.data.products[0].active;
  const legacyPreview = await f.request('/backup/preview', 'POST', {backup: legacy});
  assert.equal(legacyPreview.status, 200);
  assert.equal((await f.command('/backup/restore', {backup: legacy, ...legacyPreview.data, confirmation: 'RESTORE_BUSINESS_DATA'})).status, 200);
  assert.equal((await f.request('/data')).data.products[0].active, 1);
  backup.data.products[0].active = 2;
  assert.equal((await f.request('/backup/preview', 'POST', {backup})).status, 400);
});
