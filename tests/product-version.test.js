import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const product = { name: '协作物料', barcode: 'VERSION-001', category: '日用', unit: '件', cost: 10, price: 20, threshold: 5 };
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1, session = cookie) => {
    // API clients send arrays; raw SQLite fixtures store this field as JSON.
    if (method === 'PUT' && /^\/products\/\d+$/.test(path) && typeof body?.customer_part_numbers === 'string') body = { ...body, customer_part_numbers: JSON.parse(body.customer_part_numbers) };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'owner', password: 'Test-password-123' })).cookie;
  await request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const create = await request('/products', 'POST', product);
  assert.equal(create.status, 201);
  const current = () => db.prepare('SELECT * FROM products WHERE id=?').get(create.data.id);
  const command = (path, body) => request(path, 'POST', { request_id: randomUUID(), ...body });
  return { db, request, current, command, id: create.data.id };
}

test('two users saving the same version produce one success and one actionable conflict without partial writes', async t => {
  const f = await fixture(t);
  await f.request('/users', 'POST', { position_id: readonlyPositionId(f.db), username: 'staff', password: 'Test-password-123', role: 'employee' });
  await grantPosition(f.db, (path, body, method) => f.request(path, method, body), f.db.prepare('SELECT id FROM users WHERE username=?').get('staff').id, ['products']);
  const employee = (await f.request('/auth/login', 'POST', { username: 'staff', password: 'Test-password-123' }, 1, null)).cookie;
  const original = f.current();
  assert.equal((await f.request('/data')).data.products[0].version, original.version);
  assert.equal((await f.request(`/products/barcode/${original.barcode}`)).data.version, original.version);
  const payloads = [
    { ...original, name: '甲修改', price: 30 },
    { ...original, name: '乙修改', category_id: undefined, category: '不应被失败请求创建', price: 40 },
  ];
  const results = await Promise.all([
    f.request(`/products/${f.id}`, 'PUT', payloads[0]),
    f.request(`/products/${f.id}`, 'PUT', payloads[1], 1, employee),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.findIndex(r => r.status === 200);
  const rejected = results[1 - winner];
  assert.equal(rejected.data.code, 'PRODUCT_VERSION_CONFLICT');
  assert.match(rejected.data.error, /未保存.*最新信息/);
  const saved = f.current();
  assert.equal(saved.name, payloads[winner].name);
  assert.equal(saved.price, payloads[winner].price);
  assert.ok(saved.version > original.version);
  assert.equal(results[winner].data.version, saved.version);
  if (winner === 0) assert.equal(f.db.prepare("SELECT 1 FROM categories WHERE name='不应被失败请求创建'").get(), undefined);
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', { ...saved, note: '核对后重新编辑' })).status, 200);
});

test('missing, invalid and stale versions cannot bypass protection, including alternate route casing', async t => {
  const f = await fixture(t), original = f.current();
  for (const version of [undefined, null, 0, -1, 1.5, String(original.version), original.version + 1]) {
    const result = await f.request(`/PRODUCTS/${f.id}/`, 'PUT', { ...original, version, name: '不能覆盖' });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'PRODUCT_VERSION_CONFLICT');
    assert.deepEqual(f.current(), original);
  }
  assert.equal((await f.request('/products/99999', 'PUT', { ...original })).status, 404);
  const warehouse = (await f.request('/warehouses', 'POST', { name: '分仓' })).data.id;
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', original, warehouse)).status, 400);
});

test('inventory changes allow profile saves, while category changes and listing changes invalidate stale editors', async t => {
  const f = await fixture(t), original = f.current();
  await f.request('/orders', 'POST', { type: 'in', partner: '供应商', items: [{ product_id: f.id, quantity: 3, price: 10 }] });
  assert.equal(f.current().version, original.version);
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', { ...original, price: 25 })).status, 200);
  assert.equal(f.current().stock, 3);
  const beforeRename = f.current();
  await f.request('/categories', 'POST', { name: '无关分类' });
  assert.equal(f.current().version, beforeRename.version);
  await f.request(`/categories/${beforeRename.category_id}`, 'PUT', { name: '日用改名' });
  assert.ok(f.current().version > beforeRename.version);
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', beforeRename)).status, 409);
  const beforeStatus = f.current();
  await f.request(`/products/${f.id}/status`, 'POST', { active: 0 });
  assert.ok(f.current().version > beforeStatus.version);
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', beforeStatus)).status, 409);
});

test('synchronizing a product invalidates target editors and failed syncs roll back profile versions', async t => {
  const f = await fixture(t);
  const warehouse = (await f.request('/warehouses', 'POST', { name: '分仓' })).data.id;
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', { ...f.current(), sync_warehouse_ids: [warehouse] })).status, 200);
  const remote = (await f.request('/data', 'GET', undefined, warehouse)).data.products[0];
  const before = f.current();
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', { ...before, name: '同步改名', sync_warehouse_ids: [warehouse] })).status, 200);
  assert.equal((await f.request(`/products/${remote.id}`, 'PUT', { ...remote, name: '过期分仓编辑' }, warehouse)).status, 409);
  const snapshot = (await f.request('/backup')).data.data;
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', { ...f.current(), name: '不能部分保存', sync_warehouse_ids: [warehouse, 999999] })).status, 400);
  assert.deepEqual((await f.request('/backup')).data.data, snapshot);
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', { ...before, sync_warehouse_ids: [warehouse] })).status, 409);
  assert.deepEqual((await f.request('/backup')).data.data, snapshot);
});

test('restores and reused product IDs issue fresh versions; legacy backups remain readable', async t => {
  const f = await fixture(t), original = f.current();
  const backup = (await f.request('/backup')).data;
  for (const value of [backup, { ...backup, version: 7, data: { ...backup.data, categories: backup.data.categories.map(({ warehouse_id, ...c }) => c), products: backup.data.products.map(({ version, ...p }) => p) } }]) {
    const preview = await f.request('/backup/preview', 'POST', { backup: value });
    assert.equal(preview.status, 200);
    assert.equal((await f.command('/backup/restore', { backup: value, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
    assert.notEqual(f.current().version, original.version);
    assert.equal((await f.request(`/products/${f.id}`, 'PUT', original)).status, 409);
  }
  const oldVersion = f.current().version;
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const created = await f.request('/products', 'POST', product);
  assert.equal(created.data.id, f.id);
  assert.ok(created.data.version > oldVersion);
  assert.equal((await f.request(`/products/${f.id}`, 'PUT', original)).status, 409);
  for (const version of [0, -1, '1', 1.5]) {
    const invalid = structuredClone(backup);
    invalid.data.products[0].version = version;
    assert.equal((await f.request('/backup/preview', 'POST', { backup: invalid })).status, 400);
  }
});

test('existing databases gain versions without losing products and revisions survive restart', t => {
  const folder = mkdtempSync(join(tmpdir(), '77erp-product-version-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'legacy.sqlite');
  let { db } = createApp(path);
  const before = db.prepare('SELECT name,stock FROM products WHERE id=1').get();
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'data_revision_*'").all()) db.exec(`DROP TRIGGER ${name}`);
  db.exec("DROP TRIGGER product_version_insert; DROP TRIGGER product_version_update; ALTER TABLE products DROP COLUMN version; DELETE FROM app_metadata WHERE key='product_version'");
  db.close();
  ({ db } = createApp(path));
  assert.deepEqual(db.prepare('SELECT name,stock FROM products WHERE id=1').get(), before);
  assert.equal(db.prepare('SELECT version FROM products WHERE id=1').get().version, 1);
  db.prepare('UPDATE products SET name=? WHERE id=1').run('重启前修改');
  const version = db.prepare('SELECT version FROM products WHERE id=1').get().version;
  db.close();
  ({ db } = createApp(path));
  assert.equal(db.prepare('SELECT version FROM products WHERE id=1').get().version, version);
  db.prepare('UPDATE products SET name=? WHERE id=1').run('重启后修改');
  assert.ok(db.prepare('SELECT version FROM products WHERE id=1').get().version > version);
  db.close();
});
