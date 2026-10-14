import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { permissionKeys } from '../shared/permissions.js';

const password = 'Strong-password-123';
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const request = async (cookie, path, body, method = body === undefined ? 'GET' : 'POST', warehouse = 1) => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: result.status, data: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = (await request(null, '/auth/setup', { username: 'owner', password })).cookie;
  const id = (await request(admin, '/users', { username: 'staff', password })).data.id;
  const cookie = (await request(null, '/auth/login', { username: 'staff', password })).cookie;
  const set = async permissions => {
    const user = (await request(admin, '/users')).data.find(user => user.id === id);
    const result = await request(admin, `/users/${id}/permissions`, { permissions, version: user.permissions_version }, 'PUT');
    assert.equal(result.status, 200, JSON.stringify(result.data));
  };
  const command = (session, path, body) => request(session, path, { ...body, request_id: randomUUID() });
  return { db, request, admin, cookie, id, set, command };
}

const probes = {
  products: [
    ['POST', '/products', {}], ['PUT', '/products/1', {}], ['POST', '/products/1/status', {}], ['DELETE', '/products/1', {}],
    ['POST', '/categories', {}], ['PUT', '/categories/1', {}], ['POST', '/categories/1/delete', {}],
  ],
  purchase: [['POST', '/orders', { type: 'in' }]],
  sale: [['POST', '/orders', { type: 'out' }]],
  corrections: [['POST', '/orders/1/void', {}], ['POST', '/orders/1/returns', {}]],
  stocktake: [['GET', '/stocktakes'], ['POST', '/stocktakes', {}],
    ['GET', '/stocktakes/multi/products?q=物料'], ['POST', '/stocktakes/multi/compare', {}]],
  business: [['POST', '/contacts', {}], ['POST', '/templates', {}], ['POST', '/templates/1/delete', {}],
    ['GET', '/stock-qrs'], ['POST', '/stock-qrs', {}], ['PUT', '/stock-qrs/a08f04e0-6420-4c84-9c07-189e70c95539', {}]],
  finance: [['GET', '/finance'], ['GET', '/reports/profit'], ['GET', '/orders/1/payments'],
    ['POST', '/orders/1/payments', {}], ['POST', '/orders/1/settlement', {}], ['POST', '/payments/1/reverse', {}]],
  data_io: [['GET', '/orders/export'], ['POST', '/products/import/preview', {}], ['POST', '/products/import', {}]],
};

test('new employees are read-only, keep password access, and only admins can configure employee permissions', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request(f.cookie, '/auth/status')).data.permissions, []);
  for (const path of ['/data', '/products/barcode/6901234560010', '/warehouses', '/categories', '/contacts', '/templates'])
    assert.notEqual((await f.request(f.cookie, path)).status, 403, path);
  const data = (await f.request(f.cookie, '/data')).data;
  assert.equal(data.products[0].inventory_value_cents, undefined);
  assert.equal(data.orders[0].items[0].cost_cents, undefined);
  assert.equal(data.orders[0].payment_status, undefined);
  assert.equal((await f.request(f.cookie, `/users/${f.id}/permissions`, { permissions: permissionKeys, version: 1 }, 'PUT')).status, 403);
  assert.equal((await f.request(f.admin, '/users/1/permissions', { permissions: [], version: 1 }, 'PUT')).status, 400);
  for (const permissions of [['unknown'], ['products', 'products'], {}, null])
    assert.equal((await f.request(f.admin, `/users/${f.id}/permissions`, { permissions, version: 1 }, 'PUT')).status, 400);
  await f.set(['sale']);
  assert.deepEqual((await f.request(f.cookie, '/data')).data.user.permissions, ['sale']);
  assert.equal((await f.request(f.admin, `/users/${f.id}/permissions`, { permissions: ['purchase'], version: 1 }, 'PUT')).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_permission_changes').get().n, 1);
  assert.equal((await f.request(f.cookie, '/auth/password', { current_password: password, password: 'Changed-password-456' })).status, 200);
  assert.equal((await f.request(f.cookie, '/data')).status, 401);
});

test('the eight modules are independent; full business access never grants system, user, backup or reset access', async t => {
  const f = await fixture(t);
  for (const key of permissionKeys) {
    await f.set([key]);
    for (const [module, routes] of Object.entries(probes)) for (const [method, path, body] of routes) {
      const result = await f.request(f.cookie, path, body, method);
      assert.equal(result.status === 403, module !== key, `${key}: ${method} ${path} returned ${result.status}`);
    }
  }
  await f.set(permissionKeys);
  for (const [method, path] of [['GET', '/users'], ['POST', '/users'], ['PUT', '/users/1'], ['POST', '/users/1/password'],
    ['GET', '/settings/imagebed'], ['PUT', '/settings/imagebed'], ['PUT', '/settings'], ['POST', '/settings/reset'],
    ['POST', '/warehouses'], ['PUT', '/warehouses/1'], ['GET', '/backup'], ['POST', '/backup/preview'], ['POST', '/backup/restore'],
    ['GET', '/unknown-route'], ['POST', '/SETTINGS/RESET/']])
    assert.equal((await f.request(f.cookie, path, method === 'GET' ? undefined : {}, method)).status, 403, path);
  const data = (await f.request(f.cookie, '/data')).data;
  assert.ok(Number.isInteger(data.products[0].inventory_value_cents));
  assert.ok(Object.hasOwn(data.orders[0].items[0], 'cost_cents'));
});

test('permissions affect existing sessions immediately and cannot be bypassed by templates, QR direction or retries', async t => {
  const f = await fixture(t);
  const source = f.db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  const qr = async type => (await f.command(f.admin, '/stock-qrs', { name: type, type, partner: type === 'in' ? '供应商' : '客户',
    require_confirmation: false, max_scans: null, items: [{ product_id: 1, quantity: 1, price_cents: 1000 }] })).data;
  const incoming = await qr('in'), outgoing = await qr('out');
  const label = q => ({ format: '77erp', version: 1, type: 'stock_operation', source_id: source, warehouse_id: 1, qr_id: q.qr_id });
  await f.set(['purchase', 'business']);
  const template = (await f.command(f.cookie, '/templates', { name: '出库模板', type: 'out', partner: '客户', note: '', items: [{ product_id: 1, quantity: 1, price: 10 }] })).data;
  assert.ok(template.id);
  assert.equal((await f.command(f.cookie, '/orders', { type: template.type, partner: template.partner, items: template.items })).status, 403);
  assert.equal((await f.request(f.cookie, '/stock-qrs/preview', { label: label(outgoing), mode: 'in' })).status, 403);
  assert.equal((await f.command(f.cookie, `/stock-qrs/${outgoing.qr_id}/execute`, { type: 'in', preview_token: 'fake', confirmed: false })).status, 403);
  const preview = await f.request(f.cookie, '/stock-qrs/preview', { label: label(incoming), mode: 'in' });
  assert.equal(preview.status, 200);
  const body = { preview_token: preview.data.preview_token, confirmed: false, request_id: randomUUID() };
  const first = await f.request(f.cookie, `/stock-qrs/${incoming.qr_id}/execute`, body);
  assert.equal(first.status, 201);
  const count = f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  await f.set([]);
  assert.equal((await f.request(f.cookie, `/stock-qrs/${incoming.qr_id}/execute`, body)).status, 403);
  assert.equal((await f.request(f.cookie, '/stock-qrs/preview', { label: label(incoming), mode: 'in' })).status, 403);
  assert.equal((await f.request(f.cookie, `/products/1`, {}, 'PUT')).status, 403);
  assert.equal((await f.command(f.cookie, '/templates', { ...template, note: '修改' })).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, count);
  assert.deepEqual((await f.request(f.cookie, '/auth/status')).data.permissions, []);
});

test('legacy employees keep their former capabilities until configuration is saved; business reset and backup restore preserve authorization', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE users SET permissions=NULL WHERE id=?').run(f.id);
  const legacy = (await f.request(f.cookie, '/data')).data;
  assert.equal(legacy.user.legacy_permissions, true);
  assert.notEqual((await f.request(f.cookie, '/products', {})).status, 403);
  assert.equal((await f.request(f.cookie, '/categories', {})).status, 403);
  assert.equal((await f.request(f.cookie, '/orders/export')).status, 200);
  assert.notEqual((await f.request(f.cookie, '/templates', {})).status, 403);
  await f.set(['products']);
  assert.equal((await f.request(f.cookie, '/data')).data.user.legacy_permissions, false);
  assert.equal((await f.request(f.cookie, '/templates', {})).status, 403);
  const category = await f.request(f.cookie, '/categories', { name: '员工维护分类' });
  assert.equal(category.status, 200);
  const backup = (await f.request(f.admin, '/backup')).data;
  assert.equal(backup.data.user_permission_changes, undefined);
  const before = f.db.prepare('SELECT permissions,permissions_version FROM users WHERE id=?').get(f.id);
  const preview = (await f.request(f.admin, '/backup/preview', { backup })).data;
  assert.equal((await f.command(f.admin, '/backup/restore', { backup, token: preview.token, current_token: preview.current_token, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.deepEqual(f.db.prepare('SELECT permissions,permissions_version FROM users WHERE id=?').get(f.id), before);
  assert.equal((await f.request(f.admin, '/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' })).status, 200);
  assert.deepEqual(f.db.prepare('SELECT permissions,permissions_version FROM users WHERE id=?').get(f.id), before);
});
