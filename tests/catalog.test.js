import { assertRestoredBusiness } from './backup-assertions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { DatabaseSync } from 'node:sqlite';
import { categoryPaths, migrateWarehouseCategories } from '../server/catalog.js';

const image = 'https://img.example.com/file/77erp/products/cup.jpg';
const product = { name: '分类物料', unit: '件', cost: 10, price: 20, threshold: 5 };
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  db.prepare("UPDATE imagebed_settings SET base_url='https://img.example.com',auth_type='none' WHERE id=1").run();
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
  const imageUrl = image;
  const created = await f.request('/products', 'POST', { ...product, category_id: id, image: imageUrl, specification: ' A5 / 蓝色 ', note: ' 第一行\n第二行 ' });
  assert.equal(created.status, 201);
  const lookup = (await f.request(`/products/barcode/${created.data.barcode}`)).data;
  assert.equal(lookup.image, imageUrl);
  assert.equal(lookup.specification, 'A5 / 蓝色');
  assert.equal(lookup.note, '第一行\n第二行');
  assert.equal(lookup.stock, 0);
  assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: lookup.version, category: '文具' })).status, 200);
  assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.image, imageUrl);
  assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: (await f.request(`/products/barcode/${created.data.barcode}`)).data.version, category_id: id, image: '', specification: '', note: '' })).status, 200);
  assert.equal((await f.request(`/products/barcode/${created.data.barcode}`)).data.image, '');
});

test('invalid product metadata or category cannot create a product or orphan category', async t => {
  const f = await fixture(t), before = (await f.request('/data')).data;
  for (const detail of [{ specification: 'x'.repeat(501) }, { note: 'x'.repeat(2001) }, { image: 'https://example.com/image.png' }, { image: 'data:image/svg+xml;base64,AAAA' }, { image: 'data:image/png;base64,AAAA' }, { image: 42 }, { category_id: 999999 }, { category_id: '1' }]) {
    assert.equal((await f.request('/products', 'POST', { ...product, category: '不应创建', ...detail })).status, 400);
  }
  const oversized = 'data:image/png;base64,' + Buffer.alloc(1024 * 1024 + 1).toString('base64');
  assert.equal((await f.request('/products', 'POST', { ...product, category: '不应创建', image: oversized })).status, 413);
  const after = (await f.request('/data')).data;
  assert.deepEqual(after.categories, before.categories);
  assert.deepEqual(after.products, before.products);
});

test('customer part numbers are validated, searchable, versioned and preserved across legacy edits, sync and backups', async t => {
  const f = await fixture(t);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  await f.request('/contacts', 'POST', { request_id: randomUUID(), name: '客户料号测试客户', role: 'customer', active: 1, person: '', phone: '', address: '', note: '' });
  const customer = (await f.request('/contacts')).data.find(c => c.name === '客户料号测试客户');
  const parts = [{ customer_id: customer.id, part_number: ' CPN_%甲-001 ' }, { customer_id: customer.id, part_number: '乙-002' }];
  const warehouse = (await f.request('/warehouses', 'POST', { name: '客户料号分仓' })).data.id;
  const created = await f.request('/products', 'POST', { ...product, category: '料号分类', customer_part_numbers: parts, sync_warehouse_ids: [warehouse] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const path = `/products/${created.data.id}`;
  const initial = (await f.request(path)).data.product;
  assert.deepEqual(initial.customer_part_numbers, parts.map(p => ({ ...p, part_number: p.part_number.trim(), customer_name: customer.name })));
  assert.deepEqual((await f.request(`/products/barcode/${created.data.barcode}`)).data.customer_part_numbers, initial.customer_part_numbers);
  assert.deepEqual((await f.request('/data')).data.products[0].customer_part_numbers, initial.customer_part_numbers);
  assert.deepEqual((await f.request('/dashboard')).data.products.low_stock_products[0].customer_part_numbers, initial.customer_part_numbers);
  for (const q of ['CPN_%', '乙-002']) {
    const found = (await f.request(`/products?q=${encodeURIComponent(q)}`)).data;
    assert.equal(found.total, 1);
    assert.equal(found.products[0].id, created.data.id);
  }
  assert.equal((await f.request('/products?q=CPNxx')).data.total, 0);
  const target = f.db.prepare('SELECT * FROM products WHERE warehouse_id=?').get(warehouse);
  assert.deepEqual(JSON.parse(target.customer_part_numbers), parts.map(p => ({ customer_id: p.customer_id, part_number: p.part_number.trim() })));
  const { customer_part_numbers, ...legacy } = initial;
  assert.equal((await f.request(path, 'PUT', { ...legacy, name: '旧客户端编辑' })).status, 200);
  let current = (await f.request(path)).data.product;
  assert.deepEqual(current.customer_part_numbers, customer_part_numbers);
  const savedVersion = current.version;
  assert.equal((await f.request(path, 'PUT', { ...current, customer_part_numbers: [{ customer_id: customer.id, part_number: '新料号' }] })).status, 200);
  current = (await f.request(path)).data.product;
  assert.ok(current.version > savedVersion);
  assert.equal((await f.request(path, 'PUT', { ...initial, customer_part_numbers: [] })).status, 409);
  for (const invalid of [null, '[]', [{}], [{ customer_id: 999999, part_number: '无效' }], [{ customer_id: customer.id, part_number: ' ' }], [{ customer_id: customer.id, part_number: 'x'.repeat(101) }], Array(101).fill(parts[0]), [parts[0], parts[0]]]) {
    assert.equal((await f.request(path, 'PUT', { ...current, customer_part_numbers: invalid })).status, 400);
    assert.equal((await f.request(path)).data.product.version, current.version);
  }
  assert.equal((await f.request(`/contacts/${customer.id}/delete`, 'POST', { request_id: randomUUID(), version: customer.version })).status, 400);
  const inactiveCustomer = { ...customer, name: '改名后的客户', active: 0 };
  assert.equal((await f.request('/contacts', 'POST', { ...inactiveCustomer, request_id: randomUUID() })).status, 200);
  assert.equal((await f.request(path)).data.product.customer_part_numbers[0].customer_name, inactiveCustomer.name);
  assert.equal((await f.request(path, 'PUT', current)).status, 200);
  assert.equal((await f.request(path, 'PUT', { ...current, customer_part_numbers: parts })).status, 400);
  const backup = (await f.request('/backup')).data;
  const preview = (await f.request('/backup/preview', 'POST', { backup })).data;
  assert.equal((await f.request('/backup/restore', 'POST', { backup, ...preview, request_id: randomUUID(), confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assertRestoredBusiness((await f.request('/backup')).data.data, backup.data);
  const broken = structuredClone(backup);
  broken.data.products.find(p => p.id === current.id).customer_part_numbers = JSON.stringify([{ customer_id: 999999, part_number: '无效关联' }]);
  assert.equal((await f.request('/backup/preview', 'POST', { backup: broken })).status, 400);
  const oldBackup = structuredClone(backup);
  oldBackup.version = 15;
  for (const p of oldBackup.data.products) delete p.customer_part_numbers;
  assert.equal((await f.request('/backup/preview', 'POST', { backup: oldBackup })).status, 200);
  current = (await f.request(path)).data.product;
  assert.equal((await f.request(path, 'PUT', { ...current, customer_part_numbers: [] })).status, 200);
  assert.deepEqual((await f.request(path)).data.product.customer_part_numbers, []);
});

test('v11 backups restore a tree and product details independently of current category IDs; malformed trees and references fail', async t => {
  const f = await fixture(t), root = await f.category('食材'), child = await f.category('调味品', root);
  await f.request('/products', 'POST', { ...product, category_id: child, image, specification: '500g', note: '避光保存' });
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 26);
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
  assertRestoredBusiness((await f.request('/backup')).data.data, backup.data);
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
  // Downgrade fixtures must also remove triggers that did not exist in the legacy schema.
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'data_revision_*'").all()) db.exec(`DROP TRIGGER ${name}`);
  db.exec('DROP TRIGGER product_version_update');
  for (const key of ['category_id', 'image', 'specification', 'note', 'customer_part_numbers']) db.exec(`ALTER TABLE products DROP COLUMN ${key}`);
  db.exec('DROP TABLE categories'); db.close();
  ({ db } = createApp(path));
  assert.deepEqual(db.prepare('SELECT id,name,barcode,category,stock FROM products ORDER BY id').all(), original);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id IS NULL').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products WHERE customer_part_numbers!='[]'").get().n, 0);
  db.prepare('UPDATE products SET specification=?,note=?,image=? WHERE id=1').run('350ml', '迁移后录入', image);
  const categories = db.prepare('SELECT * FROM categories ORDER BY id').all(); db.close();
  ({ db } = createApp(path));
  assert.deepEqual(db.prepare('SELECT * FROM categories ORDER BY id').all(), categories);
  assert.equal(db.prepare('SELECT specification FROM products WHERE id=1').get().specification, '350ml');
  db.close();
});

test('a shared legacy tree is copied into every existing warehouse, retaining products and history across restarts', t => {
  const folder = mkdtempSync(join(tmpdir(), '77erp-category-scope-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'legacy.sqlite');
  let { db } = createApp(path);
  db.exec("INSERT INTO warehouses(id,name,created_at) VALUES (2,'分仓','2026-01-01'),(3,'空仓','2026-01-01');");
  // A child ID can precede its parent's ID after reparenting an old tree.
  db.exec("INSERT INTO categories(id,name,parent_id) VALUES (100,'餐厨',NULL),(90,'杯具',100),(101,'未使用分类',NULL);");
  db.prepare('UPDATE products SET category_id=90,category=? WHERE id=1').run('餐厨 / 杯具');
  const source = db.prepare('SELECT * FROM products WHERE id=1').get();
  const remote = { ...source, id: 1000, barcode: 'LEGACY-REMOTE', warehouse_id: 2, sync_key: randomUUID(), stock: 3, inventory_value_cents: 3000 };
  const fields = Object.keys(remote);
  db.prepare(`INSERT INTO products (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(remote));
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'data_revision_*'").all()) db.exec(`DROP TRIGGER ${name}`);
  db.exec('DROP INDEX categories_sibling_name; ALTER TABLE categories DROP COLUMN warehouse_id; CREATE UNIQUE INDEX categories_sibling_name ON categories(COALESCE(parent_id,0),name);');
  const oldCategories = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const oldProducts = db.prepare('SELECT * FROM products ORDER BY id').all();
  const oldOrders = db.prepare('SELECT * FROM orders ORDER BY id').all();
  const oldItems = db.prepare('SELECT * FROM order_items ORDER BY id').all();
  db.close();
  ({ db } = createApp(path));
  const migrated = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const oldPaths = [...categoryPaths(oldCategories).values()].sort();
  for (const warehouseId of [1, 2, 3]) {
    const rows = migrated.filter(c => c.warehouse_id === warehouseId);
    assert.equal(rows.length, oldCategories.length);
    assert.deepEqual([...categoryPaths(rows).values()].sort(), oldPaths);
  }
  assert.deepEqual(migrated.filter(c => c.warehouse_id === 1).map(({ warehouse_id, ...c }) => c), oldCategories.map(c => ({ ...c })));
  for (const original of oldProducts) {
    const current = db.prepare('SELECT * FROM products WHERE id=?').get(original.id);
    assert.deepEqual({ ...current, category_id: original.category_id, version: original.version }, { ...original });
    const category = migrated.find(c => c.id === current.category_id);
    assert.equal(category.warehouse_id, current.warehouse_id);
    assert.equal(categoryPaths(migrated).get(current.category_id), original.category);
  }
  assert.deepEqual(db.prepare('SELECT * FROM orders ORDER BY id').all(), oldOrders);
  assert.deepEqual(db.prepare('SELECT * FROM order_items ORDER BY id').all(), oldItems);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const stableProducts = db.prepare('SELECT * FROM products ORDER BY id').all();
  db.close();
  ({ db } = createApp(path));
  assert.deepEqual(db.prepare('SELECT * FROM categories ORDER BY id').all(), migrated);
  assert.deepEqual(db.prepare('SELECT * FROM products ORDER BY id').all(), stableProducts);
  db.close();
});

test('an invalid legacy category tree rolls migration back and can be retried after repair', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE warehouses(id INTEGER PRIMARY KEY);
      INSERT INTO warehouses VALUES (1),(2);
      CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT,parent_id INTEGER REFERENCES categories(id));
      CREATE UNIQUE INDEX categories_sibling_name ON categories(COALESCE(parent_id,0),name);
      CREATE TABLE products(id INTEGER PRIMARY KEY,category_id INTEGER REFERENCES categories(id),warehouse_id INTEGER);
      INSERT INTO categories VALUES (1,'循环分类',1);`);
    assert.throws(() => migrateWarehouseCategories(db), /自身或下级/);
    assert.equal(db.prepare('PRAGMA table_info(categories)').all().some(c => c.name === 'warehouse_id'), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 1);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.exec('UPDATE categories SET parent_id=NULL');
    db.exec('CREATE TABLE history(product_id INTEGER REFERENCES products(id)); PRAGMA foreign_keys=OFF; INSERT INTO history VALUES (999); PRAGMA foreign_keys=ON;');
    assert.throws(() => migrateWarehouseCategories(db), /数据关联无效/);
    assert.equal(db.prepare('PRAGMA table_info(categories)').all().some(c => c.name === 'warehouse_id'), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 1);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.exec('DELETE FROM history');
    migrateWarehouseCategories(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 2);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('all category endpoints require authentication', async t => {
  const f = await fixture(t);
  for (const [path, method, body] of [['/categories', 'GET'], ['/categories', 'POST', {name: 'x'}], ['/categories/1', 'PUT', {name: 'x'}], ['/categories/1/delete', 'POST', {}]])
    assert.equal((await f.request(path, method, body, false)).status, 401);
});
