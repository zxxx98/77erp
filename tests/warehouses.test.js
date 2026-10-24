import { assertRestoredBusiness } from './backup-assertions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';

const product = { name: '仓库物料', barcode: 'WH-001', category: '生活日用', unit: '件', cost: 10, price: 20, threshold: 5, specification: '350ml', note: '档案备注' };
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

test('category trees, edits, product references and imports are isolated by warehouse', async t => {
  const f = await fixture(t), w = await f.warehouse('分类分仓');
  assert.deepEqual((await f.request('/categories', 'GET', undefined, w)).data, []);
  const root = (await f.request('/categories', 'POST', { name: '餐厨' })).data.id;
  const child = (await f.request('/categories', 'POST', { name: '杯具', parent_id: root })).data.id;
  const otherRoot = (await f.request('/categories', 'POST', { name: '餐厨' }, w)).data.id;
  const otherChild = (await f.request('/categories', 'POST', { name: '杯具', parent_id: otherRoot }, w)).data.id;
  assert.notEqual(root, otherRoot);
  assert.equal((await f.request('/categories', 'POST', { name: '餐厨' }, w)).status, 400);
  const main = (await f.request('/products', 'POST', { ...product, category_id: child })).data.id;
  const remote = (await f.request('/products', 'POST', { ...product, category_id: otherChild }, w)).data.id;
  const before = (await f.request('/backup')).data.data;
  for (const [path, method, body] of [
    [`/CATEGORIES/00${root}/`, 'PUT', { name: '跨仓改名' }],
    [`/categories/${child}/delete`, 'POST', {}],
    ['/categories', 'POST', { name: '跨仓子类', parent_id: root }],
    [`/categories/${otherChild}`, 'PUT', { name: '跨仓子类', parent_id: root }],
    ['/products', 'POST', { ...product, barcode: 'CROSS-CATEGORY', category_id: child }],
    [`/products/${remote}`, 'PUT', { ...product, version: before.products.find(p => p.id === remote).version, category_id: child }],
  ]) {
    assert.equal((await f.request(path, method, body, w)).status, 400, path);
    assert.deepEqual((await f.request('/backup')).data.data, before);
  }
  const rows = [{ ...product, barcode: 'IMPORT-CATEGORY', category_id: child, stock: 2 }];
  const crossPreview = await f.request('/products/import/preview', 'POST', { rows }, w);
  assert.equal(crossPreview.data.errors.length, 1);
  const preview = (await f.request('/products/import/preview', 'POST', { rows })).data;
  assert.equal((await f.command('/products/import', { rows, token: preview.token }, w)).status, 400);
  assert.deepEqual((await f.request('/backup')).data.data, before);
  assert.equal((await f.request(`/categories/${root}`, 'PUT', { name: '主仓餐厨' })).status, 200);
  assert.equal((await f.request('/products/barcode/WH-001')).data.category, '主仓餐厨 / 杯具');
  assert.deepEqual((await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data, { ...before.products.find(p => p.id === remote), customer_part_numbers: [] });
  assert.equal((await f.request('/data')).data.categories.every(c => c.warehouse_id === 1), true);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.categories.every(c => c.warehouse_id === w), true);
  assert.equal(f.db.prepare('SELECT category_id FROM products WHERE id=?').get(main).category_id, child);
  const imported = [{ ...product, barcode: 'LOCAL-IMPORT', category: '分仓导入分类', stock: 1 }];
  const localPreview = (await f.request('/products/import/preview', 'POST', { rows: imported }, w)).data;
  assert.equal((await f.command('/products/import', { rows: imported, token: localPreview.token }, w)).status, 200);
  assert.equal((await f.request('/categories')).data.some(c => c.name === '分仓导入分类'), false);
  assert.equal((await f.request('/categories', 'GET', undefined, w)).data.some(c => c.name === '分仓导入分类'), true);
});

test('explicit product synchronization reuses the target category path and leaves independent trees and stock intact', async t => {
  const f = await fixture(t), w = await f.warehouse('同步分仓');
  const root = (await f.request('/categories', 'POST', { name: '餐厨' })).data.id;
  const child = (await f.request('/categories', 'POST', { name: '杯具', parent_id: root })).data.id;
  const targetRoot = (await f.request('/categories', 'POST', { name: '餐厨' }, w)).data.id;
  const targetChild = (await f.request('/categories', 'POST', { name: '杯具', parent_id: targetRoot }, w)).data.id;
  const unrelated = (await f.request('/categories', 'POST', { name: '分仓专用' }, w)).data.id;
  const created = await f.request('/products', 'POST', { ...product, category_id: child, sync_warehouse_ids: [w] });
  assert.equal(created.status, 201);
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  assert.equal(remote.category_id, targetChild);
  await f.order(remote.id, 'in', 3, w);
  await f.request(`/categories/${root}`, 'PUT', { name: '主仓新路径' });
  const current = (await f.request('/products/barcode/WH-001')).data;
  assert.equal((await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data.category, '餐厨 / 杯具');
  assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...current, sync_warehouse_ids: [w] })).status, 200);
  const synced = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  assert.equal(synced.category, '主仓新路径 / 杯具');
  assert.notEqual(synced.category_id, child);
  assert.equal(synced.stock, 3);
  assert.equal(synced.inventory_value_cents, 3000);
  assert.equal((await f.request('/categories', 'GET', undefined, w)).data.find(c => c.id === unrelated).name, '分仓专用');
  assert.equal((await f.request('/categories', 'GET', undefined, w)).data.find(c => c.id === targetRoot).name, '餐厨');
});

test('other-warehouse stock lists matched warehouses by sync key or barcode', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓'), other = await f.warehouse('第三仓');
  const mainId = (await f.request('/products', 'POST', { ...product, sync_warehouse_ids: [w] })).data.id;
  assert.equal((await f.order(mainId, 'in', 10)).status, 201);
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  assert.equal((await f.order(remote.id, 'in', 3, w, 12)).status, 201);
  const listed = (await f.request(`/products/${mainId}/other-warehouses`)).data.warehouses;
  assert.deepEqual(listed, [{ warehouse_id: w, warehouse_name: '分仓', product_id: remote.id, stock: 3, unit: '件' }]);
  const fromRemote = (await f.request(`/products/${remote.id}/other-warehouses`, 'GET', undefined, w)).data.warehouses;
  assert.deepEqual(fromRemote, [{ warehouse_id: 1, warehouse_name: '主仓库', product_id: mainId, stock: 10, unit: '件' }]);
  assert.equal((await f.request(`/products/${mainId}/other-warehouses`)).status, 200);
  assert.equal((await f.request(`/products/${remote.id}/other-warehouses`)).status, 400);
  assert.equal((await f.request(`/products/${mainId}/other-warehouses`, 'GET', undefined, other)).status, 400);
  assert.equal((await f.request('/products/999999/other-warehouses')).status, 404);
  assert.equal((await f.request(`/products/${mainId}/other-warehouses`, 'GET', undefined, 1, false)).status, 401);
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
  assert.equal((await f.request(`/products/${mainId}`, 'PUT', { ...product, version: f.db.prepare('SELECT version FROM products WHERE id=?').get(mainId).version, name: '本仓修改', price: 25 })).status, 200);
  assert.equal((await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data.name, product.name);
  assert.equal((await f.request(`/products/${mainId}`, 'PUT', { ...product, version: f.db.prepare('SELECT version FROM products WHERE id=?').get(mainId).version, name: '同步修改', barcode: 'WH-NEW', cost: 99, sync_warehouse_ids: [w, other] })).status, 200);
  const updated = (await f.request('/products/barcode/WH-NEW', 'GET', undefined, w)).data;
  assert.equal(updated.id, remote.id);
  assert.equal(updated.name, '同步修改');
  assert.equal(updated.stock, 3);
  assert.equal(updated.inventory_value_cents, 3600);
  assert.equal((await f.request('/products/barcode/WH-NEW')).data.stock, 10);
  assert.equal((await f.request('/products/barcode/WH-NEW', 'GET', undefined, other)).data.stock, 0);
  const sale = await f.order(remote.id, 'out', 1, w, 20);
  assert.equal(sale.status, 201);
  assert.equal((await f.request(`/products/${remote.id}`, 'PUT', { ...product, version: updated.version, barcode: 'WH-NEW', name: '分仓反向同步', sync_warehouse_ids: [1] }, w)).status, 200);
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
    const r = await f.request(`/products/${id}`, 'PUT', { ...product, version: before.products.find(p => p.id === id).version, name: '不能部分保存', sync_warehouse_ids: targets });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.deepEqual((await f.request('/backup')).data.data, before);
  }
  assert.equal((await f.request('/products', 'POST', { ...product, barcode: 'CREATE-FAIL', sync_warehouse_ids: [w, 999] })).status, 400);
  assert.deepEqual((await f.request('/backup')).data.data, before);
});

test('cross-warehouse IDs cannot mutate products, orders, templates, stocktakes or payments, including alternate numeric paths and replay IDs', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  const id = (await f.request('/products', 'POST', product)).data.id;
  const incoming = (await f.order(id, 'in', 5)).data;
  const template = (await f.command('/templates', { name: '常用模板', type: 'out', partner: '', note: '', items: [{ product_id: id, quantity: 1, price: 10 }] })).data;
  const payment = (await f.command(`/orders/${incoming.id}/payments`, { amount: 1, method: '现金', note: '' })).data;
  const before = (await f.request('/backup')).data.data;
  for (const path of [`/products/${id}`, `/products/${id}.0`, `/PRODUCTS/${id}/`]) assert.equal((await f.request(path, 'PUT', product, w)).status, 400);
  assert.equal((await f.order(id, 'out', 1, w)).status, 400);
  assert.equal((await f.request('/ORDERS/', 'POST', { type: 'in', partner: '供应商', items: [{ product_id: id, quantity: 1, price: 1 }] }, w)).status, 400);
  for (const [path, body] of [
    ['/STOCKTAKES/', { reason: '跨仓盘点', items: [{ product_id: id, expected_stock: 5, counted: 0 }] }],
    ['/templates', { type: 'out', partner: '', note: '', items: [{ product_id: id, quantity: 1, price: 10 }] }],
    ['/templates', { ...template, items: [] }],
    [`/templates/${template.id}/delete`, { version: template.version }],
    [`/orders/${incoming.id}/void`, { reason: '跨仓作废' }],
    [`/orders/${incoming.id}/returns`, { reason: '跨仓退货', items: [{ product_id: id, quantity: 1 }] }],
    [`/orders/${incoming.id}/payments`, { amount: 1, method: '现金', note: '' }],
    [`/orders/${incoming.id}/settlement`, { confirmation: 'TRACK_SETTLEMENT', paid: 0, note: '核对' }],
    [`/payments/${payment.id}/reverse`, { reason: '跨仓撤销' }],
  ]) assert.equal((await f.command(path, body, w)).status, 400, path);
  assert.equal((await f.request(`/orders/${incoming.id}/payments`, 'GET', undefined, w)).status, 400);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.products.length, 0);
  assert.equal((await f.request('/templates', 'GET', undefined, w)).data.length, 0);
  assert.deepEqual((await f.request('/backup')).data.data, before);
  const body = { name: '重试模板', request_id: randomUUID(), type: 'in', partner: '', note: '', items: [{product_id: id, quantity: 1, price: 10}] };
  assert.equal((await f.request('/templates', 'POST', body)).status, 200);
  assert.equal((await f.request('/templates', 'POST', body, w)).status, 400);
});

test('imports, stocktakes, template submissions, and resets respect warehouse inventory boundaries', async t => {
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
  const template = (await f.command('/templates', { name: '常用模板', type: 'out', partner: '客户', note: '', items: [{ product_id: remote.id, quantity: 2, price: 20 }] }, w)).data;
  const submission = { request_id: randomUUID(), type: 'out', partner: '客户', items: template.items };
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

test('v11 backups round trip multiple warehouses and sync groups, reject crossed references, and migrate genuine v3 backups', async t => {
  const f = await fixture(t), w = await f.warehouse('分仓');
  await f.request('/products', 'POST', { ...product, sync_warehouse_ids: [w] });
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  await f.order(remote.id, 'in', 3, w);
  await f.command('/templates', { name: '常用模板', type: 'out', partner: '', note: '', items: [{ product_id: remote.id, quantity: 1, price: 10 }] }, w);
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 37);
  for (const corrupt of ['warehouse', 'item', 'template', 'sync', 'barcode', 'category-owner', 'category-parent', 'category-warehouse']) {
    const value = structuredClone(backup);
    if (corrupt === 'warehouse') value.data.products[0].warehouse_id = 999;
    if (corrupt === 'item') value.data.order_items[0].product_id = value.data.products[0].id;
    if (corrupt === 'template') value.data.templates[0].warehouse_id = 1;
    if (corrupt === 'category-owner') value.data.products[1].category_id = value.data.products[0].category_id;
    if (corrupt === 'category-parent') value.data.categories.find(c => c.warehouse_id === w).parent_id = value.data.categories.find(c => c.warehouse_id === 1).id;
    if (corrupt === 'category-warehouse') value.data.categories[0].warehouse_id = 999;
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
  assertRestoredBusiness((await f.request('/backup')).data.data, backup.data);
  const legacy = structuredClone(backup);
  legacy.version = 3; delete legacy.data.warehouses;
  legacy.data.categories = legacy.data.categories.filter(c => c.warehouse_id === 1);
  for (const c of legacy.data.categories) delete c.warehouse_id;
  legacy.data.products = legacy.data.products.filter(p => p.warehouse_id === 1);
  for (const p of legacy.data.products) { delete p.warehouse_id; delete p.sync_key; }
  for (const table of ['orders','order_items','stock_adjustments','templates','payments']) legacy.data[table] = [];
  const oldPreview = (await f.request('/backup/preview', 'POST', { backup: legacy })).data;
  assert.equal((await f.command('/backup/restore', { backup: legacy, ...oldPreview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.equal((await f.request('/data')).data.products.length, 1);
  assert.equal((await f.request('/data', 'GET', undefined, w)).data.products.length, 0);
});

test('legacy backups v3 through v9 migrate shared trees into independent warehouse categories', async t => {
  const f = await fixture(t), w = await f.warehouse('旧备份分仓'), empty = await f.warehouse('旧备份空仓');
  const root = (await f.request('/categories', 'POST', { name: '旧分类' })).data.id;
  const leaf = (await f.request('/categories', 'POST', { name: '子分类', parent_id: root })).data.id;
  await f.request('/categories', 'POST', { name: '未使用分类' });
  assert.equal((await f.request('/products', 'POST', { ...product, category_id: leaf, sync_warehouse_ids: [w] })).status, 201);
  const remote = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
  await f.order(remote.id, 'in', 3, w);
  const backup = (await f.request('/backup')).data;
  const oldCategories = backup.data.categories.filter(c => c.warehouse_id === 1).map(({ warehouse_id, ...c }) => c);
  for (const version of [3, 4, 5, 6, 7, 8, 9]) {
    const legacy = structuredClone(backup);
    legacy.version = version;
    legacy.data.categories = structuredClone(oldCategories);
    for (const p of legacy.data.products) p.category_id = leaf;
    if (version < 4) {
      delete legacy.data.warehouses;
      legacy.data.products = legacy.data.products.filter(p => p.warehouse_id === 1);
      for (const p of legacy.data.products) { delete p.warehouse_id; delete p.sync_key; }
      for (const table of ['orders', 'order_items', 'payments', 'stock_adjustments']) legacy.data[table] = [];
    }
    if (version < 5) for (const row of legacy.data.orders) { delete row.created_by; delete row.created_by_name; }
    if (version < 8) for (const p of legacy.data.products) delete p.version;
    const preview = await f.request('/backup/preview', 'POST', { backup: legacy });
    assert.equal(preview.status, 200, `v${version}: ${JSON.stringify(preview.data)}`);
    const restore = await f.command('/backup/restore', { backup: legacy, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' });
    assert.equal(restore.status, 200, `v${version}: ${JSON.stringify(restore.data)}`);
    const restored = (await f.request('/backup')).data;
    assert.equal(restored.version, 37);
    for (const warehouseId of [1, w, empty]) {
      const rows = (await f.request('/categories', 'GET', undefined, warehouseId)).data;
      assert.equal(rows.length, 3);
      assert.equal(rows.every(c => c.warehouse_id === warehouseId), true);
      assert.equal(rows.find(c => c.name === '子分类').parent_id, rows.find(c => c.name === '旧分类').id);
    }
    for (const p of restored.data.products) assert.equal(restored.data.categories.find(c => c.id === p.category_id).warehouse_id, p.warehouse_id);
    if (version >= 4) {
      const current = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data;
      assert.equal(current.stock, 3);
      assert.equal(current.inventory_value_cents, 3000);
      assert.equal(current.category, '旧分类 / 子分类');
      assert.deepEqual(restored.data.orders, version < 5 ? backup.data.orders.map(o => ({ ...o, created_by: null, created_by_name: '' })) : backup.data.orders);
      assert.deepEqual(restored.data.order_items, backup.data.order_items);
    }
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  }
});

test('an actual legacy database migrates without changing product IDs, stock, value or historical references; migration survives restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), '77erp-warehouses-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT NOT NULL UNIQUE, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '件', cost REAL NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), threshold INTEGER NOT NULL DEFAULT 20, color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('in','out')), partner TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', total REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL);
    INSERT INTO products VALUES (42,'旧物料','LEGACY-001','分类','件',10,20,7,5,'blue','2026-01-01');
    INSERT INTO orders VALUES (31,'RK-LEGACY','in','供应商','历史',70,'2026-01-01');
    INSERT INTO order_items VALUES (12,31,42,'旧物料','LEGACY-001',7,10);`);
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

test('new warehouses optionally reuse the current catalog, including unused branches and inactive products, without stock or history', async t => {
  const f = await fixture(t);
  const source = await f.warehouse('来源分仓');
  const root = (await f.request('/categories', 'POST', { name: '完整分类' }, source)).data.id;
  const child = (await f.request('/categories', 'POST', { name: '子分类', parent_id: root }, source)).data.id;
  await f.request('/categories', 'POST', { name: '空分类' }, source);
  const original = (await f.request('/products', 'POST', { ...product, category_id: child }, source)).data.id;
  await f.order(original, 'in', 3, source);
  await f.request(`/products/${original}/status`, 'POST', { active: 0 }, source);
  const created = await f.request('/warehouses', 'POST', { name: '复用分仓', reuse_catalog: true }, source);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const copied = (await f.request('/data', 'GET', undefined, created.data.id)).data;
  assert.equal(copied.categories.length, 3);
  assert.equal(copied.categories.find(c => c.name === '子分类').parent_id, copied.categories.find(c => c.name === '完整分类').id);
  const sourceProduct = (await f.request('/data', 'GET', undefined, source)).data.products[0];
  const targetProduct = copied.products[0];
  for (const field of ['name', 'barcode', 'category', 'unit', 'cost', 'price', 'threshold', 'specification', 'note', 'image', 'active', 'sync_key'])
    assert.equal(targetProduct[field], sourceProduct[field], field);
  assert.notEqual(targetProduct.id, sourceProduct.id);
  assert.equal(targetProduct.category_id, copied.categories.find(c => c.name === '子分类').id);
  assert.equal(targetProduct.stock, 0);
  assert.equal(targetProduct.inventory_value_cents, 0);
  assert.deepEqual(copied.orders, []);
  assert.deepEqual((await f.request('/stocktakes', 'GET', undefined, created.data.id)).data, []);
  const empty = await f.warehouse('不复用');
  assert.deepEqual((await f.request('/data', 'GET', undefined, empty)).data.categories, []);
  for (const reuse_catalog of ['true', 1, {}])
    assert.equal((await f.request('/warehouses', 'POST', { name: '无效复用', reuse_catalog })).status, 400);
  assert.equal((await f.request('/warehouses', 'POST', { name: '复用分仓', reuse_catalog: true }, source)).status, 400);
  assert.equal((await f.request('/warehouses')).data.length, 4);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('warehouse deletion clears local catalogs and zero-stock history, preserves other warehouses, and protects stock', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/warehouses/1', 'DELETE', {})).status, 400);
  assert.equal((await f.request('/warehouses/9999', 'DELETE', {})).status, 400);
  const w = await f.warehouse('可删除分仓');
  const main = (await f.request('/products', 'POST', { ...product, sync_warehouse_ids: [w] })).data.id;
  const local = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data.id;
  for (const parentName of ['父分类一', '父分类二']) {
    const parent = (await f.request('/categories', 'POST', { name: parentName }, w)).data.id;
    await f.request('/categories', 'POST', { name: '同名子分类', parent_id: parent }, w);
  }
  assert.equal((await f.command('/templates', { name: '待删除模板', type: 'in', partner: '', note: '', items: [{ product_id: local, quantity: 1, price: 10 }] }, w)).status, 200);
  assert.equal((await f.command('/stock-qrs', { name: '待删除二维码', type: 'in', partner: '供应商', require_confirmation: false, max_scans: null, items: [{ product_id: local, quantity: 1, price_e4: 100000 }] }, w)).status, 201);
  f.db.prepare('UPDATE notification_settings SET warehouse_ids=? WHERE id=1').run(JSON.stringify([w]));
  f.db.prepare('UPDATE products SET stock=1 WHERE id=?').run(local);
  assert.equal((await f.request(`/warehouses/${w}`, 'DELETE', {})).status, 400);
  f.db.prepare('UPDATE products SET stock=0,inventory_value_cents=1 WHERE id=?').run(local);
  assert.equal((await f.request(`/warehouses/${w}`, 'DELETE', {}, w)).status, 200);
  assert.equal((await f.request('/data', 'GET', undefined, w)).status, 400);
  assert.equal((await f.request('/products/barcode/WH-001')).data.id, main);
  for (const table of ['products', 'categories', 'templates', 'stock_qr_codes'])
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE warehouse_id=?`).get(w).n, 0, table);
  assert.equal(f.db.prepare('SELECT warehouse_ids FROM notification_settings WHERE id=1').get().warehouse_ids, '[]');
  const next = await f.warehouse('新仓库不复用旧编号');
  assert.ok(next > w);
  const adjusted = (await f.request('/products', 'POST', { ...product }, next)).data.id;
  await f.command('/stocktakes', { reason: '零差异盘点', items: [{ product_id: adjusted, expected_stock: 0, counted: 0 }] }, next);
  assert.equal((await f.request(`/warehouses/${next}`, 'DELETE', {})).status, 200);
  const history = await f.warehouse('历史分仓');
  const used = (await f.request('/products', 'POST', product, history)).data.id;
  const order = await f.order(used, 'in', 1, history);
  await f.command(`/orders/${order.data.id}/void`, { reason: '作废入库清零' }, history);
  assert.equal((await f.request(`/warehouses/${history}`, 'DELETE', {})).status, 200);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deleting a zero-stock warehouse removes orders, returns, payments, adjustments and QR usage atomically without touching other warehouses', async t => {
  const f = await fixture(t), w = await f.warehouse('含历史分仓');
  await f.request('/products', 'POST', { ...product, sync_warehouse_ids: [w] });
  const local = (await f.request('/products/barcode/WH-001', 'GET', undefined, w)).data.id;
  const sourceId = f.db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  let incoming;
  for (const warehouse of [1, w]) {
    const p = (await f.request('/products/barcode/WH-001', 'GET', undefined, warehouse)).data;
    const qr = await f.command('/stock-qrs', { name: '有使用记录的二维码', type: 'in', partner: '共享供应商', require_confirmation: false, max_scans: null,
      items: [{ product_id: p.id, quantity: 3, price_e4: 100000 }] }, warehouse);
    assert.equal(qr.status, 201);
    const preview = await f.request('/stock-qrs/preview', 'POST', { mode: 'in', label: { format: '77erp', version: 1, type: 'stock_operation', source_id: sourceId, warehouse_id: warehouse, qr_id: qr.data.qr_id } }, warehouse);
    assert.equal(preview.status, 200);
    const result = await f.command(`/stock-qrs/${qr.data.qr_id}/execute`, { preview_token: preview.data.preview_token, confirmed: false }, warehouse);
    assert.equal(result.status, 201);
    const paid = await f.command(`/orders/${result.data.id}/payments`, { amount: 1, method: '现金', note: '待撤销记录' }, warehouse);
    assert.equal(paid.status, 200);
    assert.equal((await f.command(`/payments/${paid.data.id}/reverse`, { reason: '撤销付款' }, warehouse)).status, 200);
    assert.equal((await f.command(`/orders/${result.data.id}/payments`, { amount: 1, method: '现金', note: '有效付款' }, warehouse)).status, 200);
    if (warehouse === w) incoming = result.data;
  }
  const returned = await f.command(`/orders/${incoming.id}/returns`, { reason: '采购退货', items: [{ product_id: local, quantity: 1 }] }, w);
  assert.equal(returned.status, 200);
  assert.equal((await f.command(`/orders/${returned.data.id}/void`, { reason: '作废退货' }, w)).status, 200);
  assert.equal((await f.order(local, 'out', 1, w)).status, 201);
  assert.equal((await f.command('/stock/reduce', { product_id: local, quantity: 1, reason: '报损' }, w)).status, 200);
  const beforeRejected = (await f.request('/backup')).data.data;
  assert.equal((await f.request(`/warehouses/${w}`, 'DELETE', {})).status, 400);
  assert.deepEqual((await f.request('/backup')).data.data, beforeRejected);
  assert.equal((await f.command('/stocktakes', { reason: '盘点清零', items: [{ product_id: local, expected_stock: 1, counted: 0 }] }, w)).status, 200);
  const before = (await f.request('/backup')).data.data;
  const productIds = new Set(before.products.filter(p => p.warehouse_id === w).map(p => p.id));
  const orderIds = new Set(before.orders.filter(o => o.warehouse_id === w).map(o => o.id));
  const qrIds = new Set(before.stock_qr_codes.filter(q => q.warehouse_id === w).map(q => q.id));
  assert.equal((await f.request(`/warehouses/${w}`, 'DELETE', {}, w)).status, 200);
  const after = (await f.request('/backup')).data;
  for (const [table, rows] of Object.entries(before)) {
    const expected = rows.filter(row => table === 'warehouses' ? row.id !== w
      : row.warehouse_id !== undefined ? row.warehouse_id !== w
      : ['order_items', 'payments'].includes(table) ? !orderIds.has(row.order_id)
      : table === 'stock_adjustments' ? !productIds.has(row.product_id)
      : table.startsWith('stock_qr_') ? !qrIds.has(row.stock_qr_id) : true);
    assert.deepEqual(after.data[table], expected, table);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_qr_previews WHERE warehouse_id=?').get(w).n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_qr_previews WHERE warehouse_id=1').get().n, 1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((await f.request('/backup/preview', 'POST', { backup: after })).status, 200);
});
