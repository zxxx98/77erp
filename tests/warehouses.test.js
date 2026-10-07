import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';

const product = { name: '仓库商品', barcode: 'WH-001', category: '生活日用', unit: '件', cost: 10, price: 20, threshold: 5, specification: '350ml', note: '档案备注' };
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1, auth = true) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(auth && cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouse = async name => { const r = await request('/warehouses', 'POST', { name }); assert.equal(r.status, 201); return r.data.id; };
  const command = (path, body, warehouse = 1) => request(path, 'POST', { request_id: randomUUID(), ...body }, warehouse);
  const order = (id, type, quantity, warehouse = 1, price = 10) => request('/orders', 'POST', { type, partner: '往来单位', items: [{ product_id: id, quantity, price }] }, warehouse);
  return { db, request, warehouse, command, order };
}

test('warehouses validate names and IDs, require login, and settings rename only the selected warehouse', async t => {
  const f = await fixture(t);
  const w = await f.warehouse('分仓');
  for (const name of ['', ' ', 'x'.repeat(61), '分仓']) assert.equal((await f.request('/warehouses', 'POST', { name })).status, 400);
  assert.equal((await f.request('/warehouses', 'POST', { name: '不能创建' }, 1, false)).status, 401);
  assert.equal((await f.request('/data', 'GET', undefined, 999)).status, 400);
  assert.equal((await f.request('/data?warehouse_id=1.5')).status, 400);
  assert.equal((await f.request('/settings', 'PUT', { business_name: '商户', warehouse_name: '新分仓' }, w)).status, 200);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.settings.warehouse_name, '新分仓');
  assert.equal((await f.request('/data')).data.settings.warehouse_name, '主仓库');
  assert.equal((await f.request(`/warehouses/${w}`, 'PUT', { name: '主仓库' })).status, 400);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.settings.warehouse_name, '新分仓');
});

test('selective product sync preserves independent quantities, valuations and histories; unselected saves stay local', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓'), other = await f.warehouse('第三仓');
  const created = await f.request('/products', 'POST', { ...product, sync_warehouse_ids: [w] });
  assert.equal(created.status, 201);
  const mainId = created.data.id;
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  assert.notEqual(mainId, remote.id);
  assert.equal(remote.stock, 0);
  assert.equal(remote.specification, '350ml');
  assert.equal((await f.request('/data', 'GET', undefined, other)).data.products.length, 0);
  assert.equal((await f.order(mainId, 'in', 10)).status, 201);
  assert.equal((await f.order(remote.id, 'in', 3, w, 12)).status, 201);
  assert.equal((await f.request(`/products/${mainId}`, 'PUT', { ...product, name: '本仓修改', price: 25 })).status, 200);
  assert.equal((await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data.name, product.name);
  assert.equal((await f.request(`/products/${mainId}`, 'PUT', { ...product, name: '同步修改', barcode: 'WH-NEW', cost: 99, sync_warehouse_ids: [w, other] })).status, 200);
  const updated = (await f.request('/products/barcode/WH-NEW', 'GET', undefined, w)).data;
  assert.equal(updated.id, remote.id);
  assert.equal(updated.name, '同步修改');
  assert.equal(updated.stock, 3);
  assert.equal(updated.inventory_value_cents, 3600);
  assert.equal((await f.request('/products/barcode/WH-NEW')).data.stock, 10);
  assert.equal((await f.request('/products/barcode/WH-NEW', 'GET', undefined, other)).data.stock, 0);
  const sale = await f.order(remote.id, 'out', 1, w, 20);
  assert.equal(sale.status, 201);
  assert.equal((await f.request(`/products/${remote.id}`, 'PUT', { ...product, barcode: 'WH-NEW', name: '分仓反向同步', sync_warehouse_ids: [1] }, w)).status, 200);
  assert.equal((await f.request('/products/barcode/WH-NEW')).data.name, '分仓反向同步');
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.orders.find(o => o.id === sale.data.id).items[0].name, '同步修改');
  assert.equal((await f.request('/data')).data.orders.length, 1);
  assert.equal((await f.request('/finance', 'GET', undefined, w)).data.orders.length, 2);
  const report = (await f.request('/reports/profit', 'GET', undefined, w)).data;
  assert.equal(report.totals.cost_cents, 1200);
  assert.equal(report.inventory_value_cents, 2400);
  assert.equal((await f.request('/reports/profit')).data.rows.length, 0);
  const returns = await f.command(`/orders/${sale.data.id}/returns`, { reason: '退货', items: [{ product_id: remote.id, quantity: 1 }] }, w);
  assert.equal(returns.status, 200);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.orders.find(o => o.id === returns.data.id).warehouse_id, w);
  assert.equal((await f.command(`/orders/${returns.data.id}/void`, { reason: '撤销退货' }, w)).status, 200);
  assert.equal((await f.request('/products/barcode/WH-NEW', 'GET', undefined, w)).data.stock, 2);
  assert.equal((await f.request('/products/barcode/WH-NEW')).data.stock, 10);
});

test('sync collisions and invalid targets roll back the source and every target; same barcode is allowed per warehouse', async t => {
  const f = await fixture(t), w = await f.warehouse('目标一'), conflict = await f.warehouse('目标二');
  const id = (await f.request('/products', 'POST', product)).data.id;
  assert.equal((await f.request('/products', 'POST', product, conflict)).status, 201);
  assert.equal((await f.request('/products', 'POST', product, conflict)).status, 400);
  const before = (await f.request('/backup')).data.data;
  for (const targets of [[w, conflict], [w, 9999], [1], [w,w], ['2'], true]) {
    const r = await f.request(`/products/${id}`, 'PUT', { ...product, name: '不能部分保存', sync_warehouse_ids: targets });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.deepEqual((await f.request('/backup')).data.data, before);
  }
  assert.equal((await f.request('/products', 'POST', { ...product, barcode: 'CREATE-FAIL', sync_warehouse_ids: [w, 999] })).status, 400);
  assert.deepEqual((await f.request('/backup')).data.data, before);
});

test('cross-warehouse IDs cannot mutate products, orders, drafts, stocktakes or payments, including alternate numeric paths and replay IDs', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  const id = (await f.request('/products', 'POST', product)).data.id;
  const incoming = (await f.order(id, 'in', 5)).data;
  const draft = (await f.command('/drafts', { type: 'out', partner: '', note: '', items: [{ product_id: id, quantity: '', price: '' }] })).data;
  const payment = (await f.command(`/orders/${incoming.id}/payments`, { amount: 1, method: '现金', note: '' })).data;
  const before = (await f.request('/backup')).data.data;
  for (const path of [`/products/${id}`, `/products/${id}.0`, `/PRODUCTS/${id}/`]) assert.equal((await f.request(path, 'PUT', product, w)).status, 400);
  assert.equal((await f.order(id, 'out', 1, w)).status, 400);
  assert.equal((await f.request('/ORDERS/', 'POST', { type: 'in', partner: '供应商', items: [{ product_id: id, quantity: 1, price: 1 }] }, w)).status, 400);
  for (const [path, body] of [
    ['/STOCKTAKES/', { reason: '跨仓盘点', items: [{ product_id: id, expected_stock: 5, counted: 0 }] }],
    ['/drafts', { type: 'out', partner: '', note: '', items: [{ product_id: id, quantity: '', price: '' }] }],
    ['/drafts', { ...draft, items: [] }],
    [`/drafts/${draft.id}/discard`, { version: draft.version }],
    [`/orders/${incoming.id}/void`, { reason: '跨仓作废' }],
    [`/orders/${incoming.id}/returns`, { reason: '跨仓退货', items: [{ product_id: id, quantity: 1 }] }],
    [`/orders/${incoming.id}/payments`, { amount: 1, method: '现金', note: '' }],
    [`/orders/${incoming.id}/settlement`, { confirmation: 'TRACK_SETTLEMENT', paid: 0, note: '核对' }],
    [`/payments/${payment.id}/reverse`, { reason: '跨仓撤销' }],
  ]) assert.equal((await f.command(path, body, w)).status, 400, path);
  assert.equal((await f.request(`/orders/${incoming.id}/payments`, 'GET', undefined, w)).status, 400);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.products.length, 0);
  assert.equal((await f.request('/drafts', 'GET', undefined, w)).data.length, 0);
  assert.deepEqual((await f.request('/backup')).data.data, before);
  // A draft ID must also be guarded at submission, even with no draft items remaining.
  const remote = (await f.request('/products', 'POST', product, w)).data.id;
  assert.equal((await f.request('/orders', 'POST', { type: 'in', partner: '客户', draft_id: draft.id, draft_version: draft.version, items: [{ product_id: remote, quantity: 1, price: 1 }] }, w)).status, 400);
  const body = { request_id: randomUUID(), type: 'in', partner: '', note: '', items: [] };
  assert.equal((await f.request('/drafts', 'POST', body)).status, 200);
  assert.equal((await f.request('/drafts', 'POST', body, w)).status, 400);
});

test('imports, stocktakes, draft submissions, and resets respect warehouse inventory boundaries', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  const id = (await f.request('/products', 'POST', product)).data.id;
  const rows = [{ ...product, stock: 8 }];
  const preview = await f.request('/products/import/preview', 'POST', { rows }, w);
  assert.equal(preview.data.errors.length, 0);
  assert.equal((await f.command('/products/import', { rows, token: preview.data.token }, w)).status, 200);
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  assert.equal(remote.stock, 8);
  assert.equal((await f.request('/stocktakes')).data.length, 0);
  assert.equal((await f.request('/stocktakes', 'GET', undefined, w)).data.length, 1);
  assert.equal((await f.command('/stocktakes', { reason: '分仓盘点', items: [{ product_id: remote.id, expected_stock: 8, counted: 9 }] }, w)).status, 200);
  const draft = (await f.command('/drafts', { type: 'out', partner: '客户', note: '', items: [{ product_id: remote.id, quantity: 2, price: 20 }] }, w)).data;
  const submission = { type: 'out', partner: '客户', draft_id: draft.id, draft_version: draft.version, items: draft.items };
  const order = await f.request('/orders', 'POST', submission, w);
  assert.equal(order.status, 201);
  assert.equal((await f.request('/orders', 'POST', submission, w)).data.id, order.data.id);
  assert.equal((await f.request('/products/barcode/WH-001')).data.id, id);
  assert.equal((await f.request('/products/barcode/WH-001')).data.stock, 0);
  assert.equal((await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data.stock, 7);
  assert.equal((await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' }, w)).status, 200);
  assert.equal((await f.request('/warehouses')).data.length, 2);
  assert.equal((await f.request('/data')).data.products.length, 0);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.orders.length, 0);
});

test('v4 backups round trip multiple warehouses and sync groups, reject crossed references, and migrate genuine v3 backups', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  await f.request('/products', 'POST', { ...product, sync_warehouse_ids: [w] });
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  await f.order(remote.id, 'in', 3, w);
  await f.command('/drafts', { type: 'out', partner: '', note: '', items: [{ product_id: remote.id, quantity: '', price: '' }] }, w);
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 4);
  for (const corrupt of ['warehouse', 'item', 'draft', 'sync', 'barcode']) {
    const value = structuredClone(backup);
    if (corrupt === 'warehouse') value.data.products[0].warehouse_id = 999;
    if (corrupt === 'item') value.data.order_items[0].product_id = value.data.products[0].id;
    if (corrupt === 'draft') value.data.drafts[0].warehouse_id = 1;
    if (corrupt === 'sync' || corrupt === 'barcode') {
      const copy = { ...value.data.products[0], id: 9999 };
      if (corrupt === 'sync') copy.barcode = 'OTHER'; else copy.sync_key = 'OTHER';
      value.data.products.push(copy);
    }
    assert.equal((await f.request('/backup/preview', 'POST', { backup: value })).status, 400, corrupt);
  }
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const preview = (await f.request('/backup/preview', 'POST', { backup })).data;
  assert.equal(preview.warehouses, 2);
  assert.equal((await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.deepEqual((await f.request('/backup')).data.data, backup.data);
  const legacy = structuredClone(backup);
  legacy.version = 3; delete legacy.data.warehouses;
  legacy.data.products = legacy.data.products.filter(p => p.warehouse_id === 1);
  for (const p of legacy.data.products) { delete p.warehouse_id; delete p.sync_key; }
  for (const table of ['orders','order_items','stock_adjustments','drafts','payments']) legacy.data[table] = [];
  const oldPreview = (await f.request('/backup/preview', 'POST', { backup: legacy })).data;
  assert.equal((await f.command('/backup/restore', { backup: legacy, ...oldPreview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.equal((await f.request('/data')).data.products.length, 1);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.products.length, 0);
});

test('an actual legacy database migrates without changing product IDs, stock, value or historical references; migration survives restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), '77erp-warehouses-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT NOT NULL UNIQUE, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '件', cost REAL NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), threshold INTEGER NOT NULL DEFAULT 20, color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('in','out')), partner TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', total REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL);
    INSERT INTO products VALUES (42,'旧商品','LEGACY-001','分类','件',10,20,7,5,'blue','2026-01-01');
    INSERT INTO orders VALUES (31,'RK-LEGACY','in','供应商','历史',70,'2026-01-01');
    INSERT INTO order_items VALUES (12,31,42,'旧商品','LEGACY-001',7,10);`);
  old.close();
  let instance = createApp(path);
  const p = instance.db.prepare('SELECT * FROM products').get();
  assert.equal(p.id, 42); assert.equal(p.stock, 7); assert.equal(p.inventory_value_cents, 7000); assert.equal(p.warehouse_id, 1);
  assert.equal(instance.db.prepare('SELECT warehouse_id FROM orders').get().warehouse_id, 1);
  assert.deepEqual(instance.db.prepare('PRAGMA foreign_key_check').all(), []);
  instance.db.close();
  instance = createApp(path);
  assert.deepEqual(instance.db.prepare('SELECT * FROM products').get(), p);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM warehouses').get().n, 1);
  instance.db.close();
});
