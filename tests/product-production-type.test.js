import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { rowsToProducts, importHeaders } from '../src/data-files.js';
import { warehouseSheet } from '../src/product-export.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateCatalog } from '../server/catalog.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  return { db, request };
}
const product = { name: '生产类型物料', category: '其他', unit: '个', cost: 1, price: 2, threshold: 0 };

test('legacy database migration leaves existing products unset and is safe to repeat', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE products(id INTEGER PRIMARY KEY, category TEXT NOT NULL); INSERT INTO products VALUES(1,'其他')");
    migrateCatalog(db);
    assert.equal(db.prepare('SELECT production_type FROM products WHERE id=1').get().production_type, '');
    db.prepare('UPDATE products SET production_type=? WHERE id=1').run('成品');
    migrateCatalog(db);
    assert.equal(db.prepare('SELECT production_type FROM products WHERE id=1').get().production_type, '成品');
    assert.throws(() => db.prepare('UPDATE products SET production_type=? WHERE id=1').run('其他'), /CHECK/);
  } finally { db.close(); }
});

test('production type persists all choices, defaults to unset and preserves omitted edits with version conflicts', async t => {
  const f = await fixture(t);
  assert.equal(f.db.prepare('SELECT * FROM products WHERE id=1').get().production_type, '');
  for (const production_type of ['', '成品', '半成品', '原料']) {
    const created = await f.request('/products', 'POST', { ...product, production_type });
    assert.equal(created.status, 201);
    const lookup = await f.request(`/products/barcode/${created.data.barcode}`);
    assert.equal(lookup.data.production_type, production_type);
    const saved = await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: created.data.version });
    assert.equal(saved.status, 200);
    assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.production_type, production_type);
    const edited = await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: saved.data.version, production_type: production_type === '原料' ? '成品' : '原料' });
    assert.equal(edited.status, 200);
    assert.ok(edited.data.version > saved.data.version);
    assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: saved.data.version, production_type: '' })).status, 409);
    assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: edited.data.version, production_type: '' })).status, 200);
    assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.production_type, '');
  }
  for (const production_type of ['其他', 'finished', 1, null, [], {}]) {
    const result = await f.request('/products', 'POST', { ...product, production_type });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /生产类型/);
  }
});

test('production type survives sync, import, export and backup restore including legacy backups', async t => {
  const f = await fixture(t);
  const warehouse = (await f.request('/warehouses', 'POST', { name: '类型同步仓' })).data.id;
  const created = await f.request('/products', 'POST', { ...product, production_type: '半成品', sync_warehouse_ids: [warehouse] });
  assert.equal(created.status, 201);
  assert.equal((await f.request(`/products/barcode/${created.data.barcode}`, 'GET', undefined, warehouse)).data.production_type, '半成品');
  const rows = [{ ...product, name: '导入原料', production_type: '原料', stock: 0 }];
  const preview = await f.request('/products/import/preview', 'POST', { rows });
  assert.deepEqual(preview.data.errors, []);
  assert.equal((await f.request('/products/import', 'POST', { rows, token: preview.data.token, request_id: randomUUID() })).status, 200);
  assert.equal(f.db.prepare("SELECT * FROM products WHERE name='导入原料'").get().production_type, '原料');
  const bad = await f.request('/products/import/preview', 'POST', { rows: [{ ...rows[0], production_type: '未知' }] });
  assert.match(bad.data.errors[0].error, /生产类型/);
  const exported = (await f.request('/products/export')).data;
  assert.ok(JSON.stringify(exported).includes('半成品'));
  const backup = (await f.request('/backup')).data;
  for (const type of [null, '其他', undefined]) {
    const invalid = structuredClone(backup);
    invalid.data.products[0].production_type = type;
    assert.equal((await f.request('/backup/preview', 'POST', { backup: invalid })).status, 400);
  }
  for (const legacy of [false, true]) {
    const value = structuredClone(backup);
    if (legacy) { value.version = 35; value.data.products.forEach(p => delete p.production_type); }
    const check = await f.request('/backup/preview', 'POST', { backup: value });
    assert.equal(check.status, 200, JSON.stringify(check.data));
    const restored = await f.request('/backup/restore', 'POST', { backup: value, ...check.data, request_id: randomUUID(), confirmation: 'RESTORE_BUSINESS_DATA' });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal(f.db.prepare("SELECT * FROM products WHERE name='导入原料'").get().production_type, legacy ? '' : '原料');
  }
});

test('spreadsheet production type supports new and both legacy templates and rejects unknown choices', () => {
  const row = ['物料', '', '其他', '个', 1, 2, 0, 0, '否', '半成品'];
  assert.equal(importHeaders.at(-1), '生产类型');
  assert.equal(rowsToProducts([importHeaders, row])[0].production_type, '半成品');
  for (const length of [8, 9]) assert.equal(rowsToProducts([importHeaders.slice(0, length), row.slice(0, length)])[0].production_type, '');
  assert.throws(() => rowsToProducts([importHeaders, [...row.slice(0, 9), '未知']]), /生产类型/);
  const sheet = warehouseSheet({ name: '仓库' }, [{ ...product, production_type: '原料' }]);
  assert.equal(sheet.data[1][sheet.data[0].indexOf('生产类型')], '原料');
});
