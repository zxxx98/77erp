import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { getUnits } from '../server/units.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie;
  const request = async (path, method = 'GET', body, auth = true, warehouseId = 1) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-Id': String(warehouseId), ...(auth && cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  return { db, request, settings: (await request('/data')).data.settings };
}

test('unit settings are shared, normalized and used for products without changing existing stock or units', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.settings.units, ['个', '件', '台', '本', '条', '支', '箱', '包']);
  const original = f.db.prepare('SELECT id,unit,stock FROM products ORDER BY id').all();
  const warehouse = (await f.request('/warehouses', 'POST', { name: '分仓' })).data.id;
  assert.equal((await f.request('/settings', 'PUT', { ...f.settings, units: [' 套 ', '瓶'] })).status, 200);
  assert.deepEqual((await f.request('/data', 'GET', undefined, true, warehouse)).data.settings.units, ['套', '瓶']);
  assert.deepEqual(f.db.prepare('SELECT id,unit,stock FROM products ORDER BY id').all(), original);
  const created = await f.request('/products', 'POST', { name: '成套商品', category: '日用', unit: '套', cost: 1, price: 2, threshold: 0 });
  assert.equal(created.status, 201);
  assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.unit, '套');
  // A removed unit remains valid when editing an existing product or using an older client.
  const existing = (await f.request('/data')).data.products[0];
  assert.equal((await f.request(`/products/${existing.id}`, 'PUT', existing)).status, 200);
  const { units, ...legacy } = f.settings;
  assert.equal((await f.request('/settings', 'PUT', legacy)).status, 200);
  assert.deepEqual((await f.request('/data')).data.settings.units, ['套', '瓶']);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  assert.deepEqual((await f.request('/data')).data.settings.units, ['套', '瓶']);
});

test('invalid or unauthenticated updates cannot partially change settings', async t => {
  const f = await fixture(t);
  for (const units of [null, '件', [], [''], ['   '], [1], ['件', ' 件 '], ['x'.repeat(101)], Array.from({ length: 101 }, (_, i) => String(i))]) {
    assert.equal((await f.request('/settings', 'PUT', { ...f.settings, business_name: '不应保存', units })).status, 400);
    assert.deepEqual((await f.request('/data')).data.settings, f.settings);
  }
  assert.equal((await f.request('/settings', 'PUT', { ...f.settings, units: ['套'] }, false)).status, 401);
  await f.request('/warehouses', 'POST', { name: '名称冲突' });
  assert.equal((await f.request('/settings', 'PUT', { ...f.settings, warehouse_name: '名称冲突', units: ['套'] })).status, 400);
  assert.deepEqual((await f.request('/data')).data.settings, f.settings);
});

test('migration preserves custom product units and saved configuration survives restart without reintroducing removed units', t => {
  const folder = mkdtempSync(join(tmpdir(), '77erp-units-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'legacy.sqlite');
  let { db } = createApp(path);
  db.prepare('UPDATE products SET unit=? WHERE id=1').run('自定义旧单位');
  db.prepare("DELETE FROM app_metadata WHERE key='product_units'").run();
  db.close();
  ({ db } = createApp(path));
  assert.ok(getUnits(db).includes('自定义旧单位'));
  db.prepare("UPDATE app_metadata SET value=? WHERE key='product_units'").run(JSON.stringify(['套', '瓶']));
  db.close();
  ({ db } = createApp(path));
  assert.deepEqual(getUnits(db), ['套', '瓶']);
  assert.equal(db.prepare('SELECT unit FROM products WHERE id=1').get().unit, '自定义旧单位');
  db.close();
});
