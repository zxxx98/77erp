import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const product = { name: '分类商品', unit: '件', cost: 10, price: 20, threshold: 5 };
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie;
  const request = async (path, method = 'GET', body, auth = true) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  const category = async (name, parent_id = null) => {
    const result = await request('/categories', 'POST', { name, parent_id });
    assert.equal(result.status, 200);
    return result.data.id;
  };
  return { db, request, category };
}

test('category rename and reparent update descendant product paths; cycles, duplicate siblings and occupied deletion are rejected atomically', async t => {
  const f = await fixture(t);
  const root = await f.category('餐厨'), child = await f.category('杯具', root), leaf = await f.category('保温杯', child);
  const other = await f.category('户外');
  const created = await f.request('/products', 'POST', { ...product, category_id: leaf });
  assert.equal(created.status, 201);
  assert.equal(f.db.prepare('SELECT category FROM products WHERE id=?').get(created.data.id).category, '餐厨 / 杯具 / 保温杯');
  assert.equal((await f.request(`/categories/${child}`, 'PUT', { name: '饮水用品', parent_id: other })).status, 200);
  assert.equal(f.db.prepare('SELECT category FROM products WHERE id=?').get(created.data.id).category, '户外 / 饮水用品 / 保温杯');
  assert.equal((await f.request(`/categories/${other}`, 'PUT', { name: '错误改名', parent_id: leaf })).status, 400);
  assert.equal(f.db.prepare('SELECT name,parent_id FROM categories WHERE id=?').get(other).name, '户外');
  assert.equal((await f.request('/categories', 'POST', { name: '保温杯', parent_id: child })).status, 400);
  assert.equal((await f.request('/categories', 'POST', { name: '新分类', parent_id: 999999 })).status, 400);
  assert.equal((await f.request(`/categories/${child}/delete`, 'POST', {})).status, 400);
  assert.equal((await f.request(`/categories/${leaf}/delete`, 'POST', {})).status, 400);
  assert.equal((await f.request(`/categories/${root}/delete`, 'POST', {})).status, 200);
  assert.equal((await f.request('/categories', 'POST', { name: '保温杯', parent_id: other })).status, 200);
});

test('product image, specification and notes survive lookup and legacy edits, and can be explicitly cleared', async t => {
  const f = await fixture(t), id = await f.category('文具');
  // A payload exceeding the previous 100 KB product request limit.
  const largeImage = 'data:image/png;base64,' + Buffer.concat([Buffer.from(image.split(',')[1], 'base64'), Buffer.alloc(120000)]).toString('base64');
  const created = await f.request('/products', 'POST', { ...product, category_id: id, image: largeImage, specification: ' A5 / 蓝色 ', note: ' 第一行\n第二行 ' });
  assert.equal(created.status, 201);
  const lookup = (await f.request(`/products/barcode/${created.data.barcode}`)).data;
  assert.equal(lookup.image, largeImage);
  assert.equal(lookup.specification, 'A5 / 蓝色');
  assert.equal(lookup.note, '第一行\n第二行');
  assert.equal(lookup.stock, 0);
  assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, category: '文具' })).status, 200);
  assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.image, largeImage);
  assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, category_id: id, image: '', specification: '', note: '' })).status, 200);
  assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.image, '');
});

test('invalid product metadata or category cannot create a product or orphan category', async t => {
  const f = await fixture(t), before = (await f.request('/data')).data;
  for (const detail of [{ specification: 'x'.repeat(501) }, { note: 'x'.repeat(2001) }, { image: 'https://example.com/image.png' }, { image: 'data:image/svg+xml;base64,AAAA' }, { image: 'data:image/png;base64,AAAA' }, { image: 42 }, { category_id: 999999 }, { category_id: '1' }]) {
    assert.equal((await f.request('/products', 'POST', { ...product, category: '不应创建', ...detail })).status, 400);
  }
  const oversized = 'data:image/png;base64,' + Buffer.alloc(1024 * 1024 + 1).toString('base64');
  assert.equal((await f.request('/products', 'POST', { ...product, category: '不应创建', image: oversized })).status, 400);
  const after = (await f.request('/data')).data;
  assert.deepEqual(after.categories, before.categories);
  assert.deepEqual(after.products, before.products);
});

test('v4 backups restore a tree and product details independently of current category IDs; malformed trees and references fail', async t => {
  const f = await fixture(t), root = await f.category('食材'), child = await f.category('调味品', root);
  await f.request('/products', 'POST', { ...product, category_id: child, image, specification: '500g', note: '避光保存' });
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 4);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const newRoot = await f.category('不同的当前分类');
  assert.equal((await f.request(`/categories/${newRoot}`, 'PUT', { name: '当前分类', parent_id: null })).status, 200);
  for (const corrupt of ['cycle', 'reference', 'path']) {
    const value = structuredClone(backup);
    if (corrupt === 'cycle') value.data.categories.find(c => c.id === root).parent_id = child;
    else if (corrupt === 'reference') value.data.products[0].category_id = 999999;
    else value.data.products[0].category = '不匹配';
    assert.equal((await f.request('/backup/preview', 'POST', { backup: value })).status, 400);
  }
  const preview = await f.request('/backup/preview', 'POST', { backup });
  assert.equal(preview.status, 200);
  assert.equal((await f.request('/backup/restore', 'POST', { backup, ...preview.data, request_id: randomUUID(), confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.deepEqual((await f.request('/backup')).data.data, backup.data);
  for (const version of [1, 2]) {
    const old = structuredClone(backup);
    old.version = version;
    delete old.data.categories;
    for (const p of old.data.products) {
      p.category = '旧分类';
      for (const key of ['category_id', 'image', 'specification', 'note']) delete p[key];
    }
    assert.equal((await f.request('/backup/preview', 'POST', { backup: old })).status, 200);
    const preview = (await f.request('/backup/preview', 'POST', { backup: old })).data;
    assert.equal((await f.request('/backup/restore', 'POST', { backup: old, ...preview, request_id: randomUUID(), confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
    const data = (await f.request('/data')).data;
    assert.equal(data.categories.length, 1);
    assert.equal(data.products[0].category_id, data.categories[0].id);
    assert.equal(data.products[0].image, '');
  }
});

test('existing flat category database migrates idempotently without changing stock or product identity', t => {
  const folder = mkdtempSync(join(tmpdir(), '77erp-catalog-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'legacy.sqlite');
  let { db } = createApp(path);
  const original = db.prepare('SELECT id,name,barcode,category,stock FROM products ORDER BY id').all();
  for (const key of ['category_id', 'image', 'specification', 'note']) db.exec(`ALTER TABLE products DROP COLUMN ${key}`);
  db.exec('DROP TABLE categories'); db.close();
  ({ db } = createApp(path));
  assert.deepEqual(db.prepare('SELECT id,name,barcode,category,stock FROM products ORDER BY id').all(), original);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id IS NULL').get().n, 0);
  db.prepare('UPDATE products SET specification=?,note=?,image=? WHERE id=1').run('350ml', '迁移后录入', image);
  const categories = db.prepare('SELECT * FROM categories ORDER BY id').all(); db.close();
  ({ db } = createApp(path));
  assert.deepEqual(db.prepare('SELECT * FROM categories ORDER BY id').all(), categories);
  assert.equal(db.prepare('SELECT specification FROM products WHERE id=1').get().specification, '350ml');
  db.close();
});

test('all category endpoints require authentication', async t => {
  const f = await fixture(t);
  for (const [path, method, body] of [['/categories', 'GET'], ['/categories', 'POST', {name: 'x'}], ['/categories/1', 'PUT', {name: 'x'}], ['/categories/1/delete', 'POST', {}]])
    assert.equal((await f.request(path, method, body, false)).status, 401);
});
