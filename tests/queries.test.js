import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const request = async (cookie, path, method = 'GET', body, warehouse = 1) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = (await request(null, '/auth/setup', 'POST', { username: 'owner', password: 'Test-password-123' })).cookie;
  await request(admin, '/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const staffId = (await request(admin, '/users', 'POST', { position_id: readonlyPositionId(db), username: 'staff', employee_no: 'staff', password: 'Test-password-123' })).data.id;
  const staff = (await request(null, '/auth/login', 'POST', { username: 'staff', password: 'Test-password-123' })).cookie;
  const grant = async (permissions) => {
    const result = await grantPosition(db, (path, body, method) => request(admin, path, method, body), staffId, ['basic_view', ...permissions]);
    assert.equal(result.status, 200);
  };
  const command = (cookie, path, body, warehouse = 1) => request(cookie, path, 'POST', { request_id: randomUUID(), ...body }, warehouse);
  const warehouse = async (name) => (await request(admin, '/warehouses', 'POST', { name })).data.id;
  const category = async (name, parentId) => (await request(admin, '/categories', 'POST', { name, parent_id: parentId })).data.id;
  const product = async (values, warehouseId = 1) =>
    (await request(admin, '/products', 'POST', { category: '日用', unit: '件', cost: 10, price: 20, threshold: 5, ...values }, warehouseId)).data;
  const order = (cookie, body, warehouseId = 1) => command(cookie, '/orders', body, warehouseId);
  return { db, request, admin, staff, grant, command, warehouse, category, product, order };
}

test('update checks are read-only, warehouse-scoped and ignore sessions and rolled-back writes', async (t) => {
  const f = await fixture(t);
  const other = await f.warehouse('更新检查分仓');
  const local = await f.product({ name: '本仓物料', barcode: 'UPDATE-LOCAL' });
  const remote = await f.product({ name: '分仓物料', barcode: 'UPDATE-REMOTE' }, other);
  const revision = async (warehouse = 1, cookie = f.admin) => {
    const response = await f.request(cookie, '/updates', 'GET', undefined, warehouse);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.data).sort(), ['revision', 'user_id']);
    return response.data.revision;
  };
  assert.equal((await f.request(null, '/updates')).status, 401);
  const initial = await revision();
  assert.equal((await f.request(f.admin, '/workspace')).data.revision, initial);
  await f.request(f.admin, '/products');
  await f.request(f.admin, '/dashboard');
  await f.request(null, '/auth/login', 'POST', { username: 'staff', password: 'Test-password-123' });
  assert.equal(await revision(), initial);
  // A real business mutation in a different warehouse does not invalidate this one.
  const otherInitial = await revision(other);
  f.db.prepare('UPDATE products SET name=? WHERE id=?').run('分仓改名', remote.id);
  assert.equal(await revision(), initial);
  assert.notEqual(await revision(other), otherInitial);
  f.db.exec('BEGIN');
  f.db.prepare('UPDATE products SET stock=stock+1 WHERE id=?').run(local.id);
  f.db.exec('ROLLBACK');
  assert.equal(await revision(), initial);
  f.db.prepare('UPDATE products SET name=name WHERE id=?').run(local.id);
  assert.equal(await revision(), initial);
  f.db.prepare('UPDATE products SET name=? WHERE id=?').run('本仓改名', local.id);
  assert.notEqual(await revision(), initial);
  const beforeUnits = await revision();
  f.db.prepare("UPDATE app_metadata SET value=? WHERE key='product_units'").run(JSON.stringify(['件', '个', '套']));
  assert.notEqual(await revision(), beforeUnits);
  const beforeDelete = await revision();
  f.db.prepare('DELETE FROM products WHERE id=?').run(local.id);
  assert.notEqual(await revision(), beforeDelete);
  f.db.prepare("INSERT INTO app_metadata(key,value) VALUES ('stock_expression',?)").run(JSON.stringify({ left: 1, terms: [{ op: '-', warehouse_id: other }] }));
  const beforeComparisonChange = await revision();
  f.db.prepare('UPDATE products SET stock=stock+1 WHERE id=?').run(remote.id);
  assert.notEqual(await revision(), beforeComparisonChange);
});

test('update checks include team announcements and only the current user permissions and read receipts', async (t) => {
  const f = await fixture(t);
  const revision = async cookie => (await f.request(cookie, '/updates')).data.revision;
  const position = await f.request(f.admin, '/positions', 'POST', { name: 'Warehouse', description: '', permissions: ['basic_view', 'purchase'] });
  assert.equal(position.status, 201);
  const staff = (await f.request(f.admin, '/users')).data.find(user => user.username === 'staff');
  const adminBefore = await revision(f.admin), staffBefore = await revision(f.staff);
  assert.equal((await f.request(f.admin, `/users/${staff.id}/position`, 'PUT', { position_id: position.data.id, version: staff.permissions_version })).status, 200);
  assert.equal(await revision(f.admin), adminBefore);
  assert.notEqual(await revision(f.staff), staffBefore);
  const staffGranted = await revision(f.staff);
  const notice = await f.request(f.admin, '/announcements', 'POST', { title: '数据更新通知', content: '请查看更新。', pinned: false });
  assert.equal(notice.status, 201);
  assert.notEqual(await revision(f.admin), adminBefore);
  assert.notEqual(await revision(f.staff), staffGranted);
  const adminPublished = await revision(f.admin), staffPublished = await revision(f.staff);
  await f.request(f.staff, `/announcements/${notice.data.id}/read`, 'POST', { content_version: notice.data.content_version });
  assert.equal(await revision(f.admin), adminPublished);
  assert.notEqual(await revision(f.staff), staffPublished);
});

test('product queries page, search and filter on the server, and respect permissions and warehouses', async (t) => {
  const f = await fixture(t);
  const parent = await f.category('餐厨');
  const child = await f.category('杯具', parent);
  const mug = await f.product({ name: '陶瓷马克杯', barcode: 'Q-001', category: '餐厨/杯具', category_id: child, specification: '350ml', note: '礼盒装' });
  const pen = await f.product({ name: '中性笔', barcode: 'Q-002', category: '办公', specification: '0.5mm' });
  const retired = await f.product({ name: '停用物料', barcode: 'Q-003', category: '办公' });
  await f.request(f.admin, `/products/${retired.id}/status`, 'POST', { active: 0 });
  const other = await f.warehouse('分仓');
  await f.product({ name: '分仓物料', barcode: 'Q-001', category: '日用' }, other);

  const page = (await f.request(f.admin, '/products?limit=2')).data;
  assert.equal(page.total, 3);
  assert.equal(page.products.length, 2);
  assert.equal(page.has_more, true);
  assert.equal(page.next_offset, 2);
  const second = (await f.request(f.admin, '/products?limit=2&offset=2')).data;
  assert.deepEqual(second.products.map((p) => p.id), [retired.id]);
  assert.equal(second.has_more, false);
  // A parent category query includes its descendants.
  assert.deepEqual((await f.request(f.admin, `/products?category_id=${parent}`)).data.products.map((p) => p.id), [mug.id]);
  assert.deepEqual((await f.request(f.admin, `/products?category_id=${child}`)).data.products.map((p) => p.id), [mug.id]);
  assert.deepEqual((await f.request(f.admin, '/products?status=active')).data.products.map((p) => p.id), [mug.id, pen.id]);
  assert.deepEqual((await f.request(f.admin, '/products?status=inactive')).data.products.map((p) => p.id), [retired.id]);
  // Search covers name, barcode, category, specification and note.
  for (const [query, expected] of [['陶瓷', [mug.id]], ['Q-002', [pen.id]], ['0.5mm', [pen.id]], ['礼盒装', [mug.id]], ['办公', [pen.id, retired.id]]])
    assert.deepEqual((await f.request(f.admin, `/products?q=${encodeURIComponent(query)}`)).data.products.map((p) => p.id), expected, query);
  // A literal % must not act as a wildcard.
  assert.equal((await f.request(f.admin, '/products?q=%25')).data.total, 0);
  // Stock filters drive the inventory tabs.
  await f.order(f.admin, { type: 'in', partner: '供应商', items: [{ product_id: mug.id, quantity: 1, price: 10 }] });
  assert.deepEqual((await f.request(f.admin, '/products?stock=low')).data.products.map((p) => p.id), [mug.id, pen.id, retired.id]);
  assert.deepEqual((await f.request(f.admin, '/products?stock=empty')).data.products.map((p) => p.id), [pen.id, retired.id]);
  // Invalid paging and over-long searches fail loudly instead of scanning everything.
  for (const path of ['/products?limit=0', '/products?limit=101', '/products?limit=x', '/products?offset=-1', `/products?q=${'x'.repeat(101)}`, '/products?category_id=abc'])
    assert.equal((await f.request(f.admin, path)).status, 400, path);
  // The destination warehouse never leaks into the current listing.
  assert.equal((await f.request(f.admin, `/products?q=${encodeURIComponent('分仓物料')}`)).data.total, 0);
  assert.equal((await f.request(f.admin, '/products?limit=100', 'GET', undefined, other)).data.total, 1);

  // New employees may read the list but never see inventory value.
  const staff = (await f.request(f.staff, '/products')).data;
  assert.equal(staff.total, 3);
  assert.equal(staff.products[0].inventory_value_cents, undefined);
  await f.grant(['finance']);
  assert.ok(Object.hasOwn((await f.request(f.staff, '/products')).data.products[0], 'inventory_value_cents'));
});

test('order queries fold returns into their business side, page on the server and hide settlement without finance', async (t) => {
  const f = await fixture(t);
  const item = await f.product({ name: '查询物料', barcode: 'Q-100' });
  const purchase = (await f.order(f.admin, { type: 'in', partner: '优品供应链', items: [{ product_id: item.id, quantity: 10, price: 10 }] })).data;
  const sale = (await f.order(f.admin, { type: 'out', partner: '零售客户', items: [{ product_id: item.id, quantity: 4, price: 20 }] })).data;
  const purchaseReturn = (await f.command(f.admin, `/orders/${purchase.id}/returns`, { reason: '质量问题', items: [{ product_id: item.id, quantity: 2 }] })).data;
  const saleReturn = (await f.command(f.admin, `/orders/${sale.id}/returns`, { reason: '客户退货', items: [{ product_id: item.id, quantity: 1 }] })).data;
  const total = (await f.request(f.admin, '/orders?limit=100')).data;
  assert.equal(total.total, 4);

  const business = async (value) => (await f.request(f.admin, `/orders?business=${value}&limit=100`)).data.orders.map((o) => o.number);
  assert.deepEqual(await business('in'), [purchaseReturn.number, purchase.number]);
  assert.deepEqual(await business('out'), [saleReturn.number, sale.number]);
  assert.deepEqual((await f.request(f.admin, '/orders?kind=return&limit=100')).data.orders.map((o) => o.number), [saleReturn.number, purchaseReturn.number]);
  assert.deepEqual((await f.request(f.admin, '/orders?kind=normal&type=out&limit=100')).data.orders.map((o) => o.number), [sale.number]);
  assert.equal((await f.request(f.admin, '/orders?business=in&business=out')).status, 400);
  // Item names, numbers and partner names are all searchable server-side.
  for (const [path, expected] of [['q=查询物料', 4], ['q=Q-100', 4], ['partner=零售客户', 2], [`q=${sale.number}`, 1]])
    assert.equal((await f.request(f.admin, `/orders?${path}&limit=100`)).data.total, expected, path);
  // Date range and status filters use UTC days like the profit report.
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await f.request(f.admin, `/orders?from=${today}&to=${today}&limit=100`)).data.total, 4);
  assert.equal((await f.request(f.admin, '/orders?from=2000-01-01&to=2000-01-02')).data.total, 0);
  assert.equal((await f.request(f.admin, '/orders?from=2030-01-01&to=2000-01-01')).status, 400);
  assert.equal((await f.request(f.admin, '/orders?status=void')).data.total, 0);
  // Rows carry an item summary so lists stay small.
  const row = (await f.request(f.admin, `/orders?q=${purchase.number}`)).data.orders[0];
  assert.equal(row.item_count, 1);
  assert.equal(row.item_quantity, 10);
  assert.deepEqual(row.item_names, ['查询物料']);
  assert.equal(row.items, undefined);
  // Settlement fields are financial data.
  const staffRow = (await f.request(f.staff, `/orders?q=${purchase.number}`)).data.orders[0];
  for (const field of ['payment_status', 'paid_cents', 'due_cents', 'direction']) assert.equal(field in staffRow, false, field);
  assert.equal((await f.request(f.admin, '/orders?limit=2')).data.has_more, true);
  assert.equal((await f.request(f.admin, `/orders?limit=1&offset=1`)).data.orders.length, 1);
  // Pagination is stable across the full result set.
  const paged = [];
  for (let offset = 0; offset < 4; offset += 1) paged.push(...(await f.request(f.admin, `/orders?limit=1&offset=${offset}`)).data.orders.map((o) => o.number));
  assert.deepEqual(paged, total.orders.map((o) => o.number));
});

test('order detail returns lines, returned quantities and only permitted financial fields', async (t) => {
  const f = await fixture(t);
  const item = await f.product({ name: '明细物料', barcode: 'Q-200' });
  await f.order(f.admin, { type: 'in', partner: '优品供应链', items: [{ product_id: item.id, quantity: 10, price: 10 }] });
  const sale = (await f.order(f.admin, { type: 'out', partner: '零售客户', note: '门店自提', items: [{ product_id: item.id, quantity: 5, price: 20 }] }, 1)).data;
  await f.command(f.admin, `/orders/${sale.id}/returns`, { reason: '部分退货', items: [{ product_id: item.id, quantity: 2 }] });
  const detail = (await f.request(f.admin, `/orders/${sale.id}`)).data.order;
  assert.equal(detail.number, sale.number);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].amount_cents, 10000);
  assert.equal(detail.items[0].returned_quantity, 2);
  assert.equal(detail.payment_status, 'unpaid');
  assert.equal(detail.due_cents, 10000);
  const staff = (await f.request(f.staff, `/orders/${sale.id}`)).data.order;
  assert.equal(staff.items[0].cost_cents, undefined);
  assert.equal(staff.payment_status, undefined);
  assert.equal(staff.items[0].amount_cents, 10000);
  assert.equal((await f.request(f.admin, '/orders/999999')).status, 404);
  // A non-numeric id is rejected by the warehouse guard before reaching the route.
  assert.equal((await f.request(f.admin, '/orders/abc')).status, 400);
  // Another warehouse cannot read the order.
  const other = await f.warehouse('分仓');
  assert.equal((await f.request(f.admin, `/orders/${sale.id}`, 'GET', undefined, other)).status, 400);
});

test('the dashboard aggregates counts, today totals, trend and recent orders per warehouse', async (t) => {
  const f = await fixture(t);
  const item = await f.product({ name: '看板物料', barcode: 'Q-300', threshold: 20 });
  await f.order(f.admin, { type: 'in', partner: '优品供应链', items: [{ product_id: item.id, quantity: 30, price: 10 }] });
  await f.order(f.admin, { type: 'out', partner: '零售客户', items: [{ product_id: item.id, quantity: 25, price: 20 }] });
  const sale = (await f.request(f.admin, '/orders?kind=normal&type=out')).data.orders[0];
  const dashboard = (await f.request(f.admin, '/dashboard')).data;
  assert.equal(dashboard.days, 7);
  assert.equal(dashboard.products.total, 1);
  assert.equal(dashboard.products.low_stock, 1);
  assert.equal(dashboard.products.out_of_stock, 0);
  assert.equal(dashboard.products.inventory_value_cents, 5000);
  assert.deepEqual(dashboard.products.low_stock_products.map((p) => p.id), [item.id]);
  assert.equal(dashboard.today.purchase_cents, 30000);
  assert.equal(dashboard.today.sales_cents, 50000);
  assert.equal(dashboard.today.purchase_count, 1);
  assert.equal(dashboard.today.sales_count, 1);
  assert.equal(dashboard.trend.length, 7);
  assert.equal(dashboard.trend.at(-1).day, new Date().toISOString().slice(0, 10));
  assert.equal(dashboard.trend.at(-1).sales_cents, 50000);
  assert.equal(dashboard.recent_orders.length, 2);
  assert.equal(dashboard.recent_orders[0].number, sale.number);
  assert.equal(dashboard.recent_orders[0].item_names[0], '看板物料');
  assert.equal(dashboard.warehouses.length, 1);
  assert.equal((await f.request(f.admin, '/dashboard?days=30')).data.trend.length, 30);
  assert.equal((await f.request(f.admin, '/dashboard?days=99')).data.days, 7);
  // Cost and amount visibility follows the finance permission.
  const staff = (await f.request(f.staff, '/dashboard')).data;
  assert.equal(staff.products.inventory_value_cents, undefined);
  assert.equal(staff.today.sales_cents, 50000);
  assert.equal(staff.products.low_stock_products[0].inventory_value_cents, undefined);
  // A second warehouse stays isolated.
  const other = await f.warehouse('分仓');
  const empty = (await f.request(f.admin, '/dashboard', 'GET', undefined, other)).data;
  assert.equal(empty.products.total, 0);
  assert.equal(empty.today.purchase_cents, 0);
  assert.equal(empty.recent_orders.length, 0);
});

test('dashboard stock alerts exclude inactive products and return after reactivation', async (t) => {
  const f = await fixture(t);
  const low = await f.product({ name: '低库存物料', barcode: 'ALERT-LOW' });
  const empty = await f.product({ name: '缺货物料', barcode: 'ALERT-EMPTY' });
  await f.order(f.admin, { type: 'in', partner: '供应商', items: [{ product_id: low.id, quantity: 2, price: 10 }] });
  const other = await f.warehouse('预警分仓');
  await f.product({ name: '分仓缺货物料', barcode: 'ALERT-OTHER' }, other);
  const alerts = async (lowCount, emptyCount, ids) => {
    const { products } = (await f.request(f.admin, '/dashboard')).data;
    assert.equal(products.low_stock, lowCount);
    assert.equal(products.out_of_stock, emptyCount);
    assert.deepEqual(products.low_stock_products.map(p => p.id), ids);
  };
  await alerts(1, 1, [empty.id, low.id]);
  for (const p of [low, empty]) assert.equal((await f.request(f.admin, `/products/${p.id}/status`, 'POST', { active: 0 })).status, 200);
  await alerts(0, 0, []);
  for (const stock of ['low', 'empty']) assert.equal((await f.request(f.admin, `/products?status=active&stock=${stock}`)).data.total, 0);
  for (const p of [low, empty]) assert.equal((await f.request(f.admin, `/products/${p.id}/status`, 'POST', { active: 1 })).status, 200);
  await alerts(1, 1, [empty.id, low.id]);
});

test('literal order routes stay reachable next to the new query endpoints', async (t) => {
  const f = await fixture(t);
  const item = await f.product({ name: '导出物料', barcode: 'Q-400' });
  await f.order(f.admin, { type: 'in', partner: '供应商', items: [{ product_id: item.id, quantity: 1, price: 10 }] });
  const exported = await f.request(f.admin, '/orders/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.data.length, 1);
  assert.equal(exported.data[0].items[0].name, '导出物料');
  assert.equal((await f.request(f.admin, '/products/barcode/Q-400')).data.id, item.id);
  assert.equal((await f.request(f.admin, `/products/${item.id}/other-warehouses`)).status, 200);
  assert.equal((await f.request(f.admin, `/products/${item.id}/history`)).status, 200);
});

test('workspace bootstrap omits business collections and product details remain warehouse scoped', async (t) => {
  const f = await fixture(t);
  const product = await f.product({ name: '按需读取', barcode: 'LAZY-001' });
  const workspace = await f.request(f.admin, '/workspace');
  assert.equal(workspace.status, 200);
  assert.equal(workspace.data.warehouse_id, 1);
  for (const key of ['products', 'orders', 'contacts']) assert.equal(Object.hasOwn(workspace.data, key), false);
  assert.ok(workspace.data.settings);
  const detail = await f.request(f.admin, `/products/${product.id}`);
  assert.equal(detail.data.product.name, '按需读取');
  const warehouse = await f.warehouse('详情隔离仓');
  assert.equal((await f.request(f.admin, `/products/${product.id}`, 'GET', undefined, warehouse)).status, 400);
  await f.grant([]);
  assert.equal((await f.request(f.staff, '/workspace')).status, 200);
  const staffDetail = await f.request(f.staff, `/products/${product.id}`);
  assert.equal(staffDetail.status, 200);
  assert.equal(Object.hasOwn(staffDetail.data.product, 'inventory_value_cents'), false);
});

test('order aggregates cover the entire filter, not only the returned page', async (t) => {
  const f = await fixture(t);
  const product = await f.product({ name: '分页统计', barcode: 'PAGE-SUM' });
  for (let i = 0; i < 3; i++) await f.order(f.admin, { type: 'in', partner: '分页供应商', items: [{ product_id: product.id, quantity: 2, price: 10 }] });
  const page = (await f.request(f.admin, '/orders?limit=1&business=in')).data;
  assert.equal(page.orders.length, 1);
  assert.equal(page.total, 3);
  assert.equal(page.aggregate.net_total, 60);
  assert.equal(page.aggregate.active_count, 3);
  assert.equal(page.aggregate.quantity, 6);
  assert.equal(Object.hasOwn(page.orders[0], 'items'), false);
  const next = (await f.request(f.admin, '/orders?limit=1&offset=1&business=in')).data;
  assert.notEqual(next.orders[0].id, page.orders[0].id);
  assert.deepEqual(next.aggregate, page.aggregate);
});

test('zero safety stock disables dashboard alerts and inventory warning filters, and edits take effect immediately', async t => {
  const f = await fixture(t);
  const unmonitored = await f.product({ name: '不预警物料', barcode: 'NO-ALERT', threshold: 0 });
  const monitored = await f.product({ name: '预警物料', barcode: 'YES-ALERT', threshold: 0.0001 });
  const assertAlerts = async expected => {
    const { products } = (await f.request(f.admin, '/dashboard')).data;
    assert.equal(products.low_stock, 0);
    assert.equal(products.out_of_stock, expected.length);
    assert.deepEqual(products.low_stock_products.map(p => p.id), expected);
    for (const filter of ['low', 'empty'])
      assert.deepEqual((await f.request(f.admin, `/products?stock=${filter}`)).data.products.map(p => p.id), expected);
  };
  await assertAlerts([monitored.id]);
  assert.equal((await f.request(f.admin, '/products')).data.total, 2);
  const updateThreshold = async (id, threshold) => {
    const product = (await f.request(f.admin, `/products/${id}`)).data.product;
    assert.equal((await f.request(f.admin, `/products/${id}`, 'PUT', { ...product, threshold })).status, 200);
  };
  await updateThreshold(monitored.id, 0);
  await assertAlerts([]);
  await updateThreshold(unmonitored.id, 2);
  await assertAlerts([unmonitored.id]);
});
