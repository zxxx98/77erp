import { assertRestoredBusiness } from './backup-assertions.js';
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
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1, auth = true) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(auth && cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouse = async (name) => {
    const created = await request('/warehouses', 'POST', { name });
    assert.equal(created.status, 201);
    return created.data.id;
  };
  const command = (path, body, warehouseId = 1) => request(path, 'POST', { request_id: randomUUID(), ...body }, warehouseId);
  const product = async (barcode, warehouseId = 1, values = {}) => {
    const created = await request('/products', 'POST', {
      name: `调拨物料-${barcode}`, barcode, category: '日用', unit: '件', cost: 10, price: 20, threshold: 2, ...values,
    }, warehouseId);
    assert.equal(created.status, 201);
    return created.data.id;
  };
  const receive = (id, quantity, price, warehouseId = 1) =>
    command('/orders', { type: 'in', partner: '供应商', items: [{ product_id: id, quantity, price }] }, warehouseId);
  const row = (id) => db.prepare('SELECT * FROM products WHERE id=?').get(id);
  return { db, request, command, warehouse, product, receive, row };
}

test('a transfer moves stock and moving average cost between two warehouses with linked legs', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const source = await f.product('TR-001');
  await f.receive(source, 10, 12);
  assert.deepEqual({ ...f.row(source) }, { ...f.row(source), stock: 10, inventory_value_cents: 12000 });
  const created = await f.command('/transfers', { to_warehouse_id: target, note: '门店补货', items: [{ product_id: source, quantity: 4 }] });
  assert.equal(created.status, 200);
  assert.equal(created.data.ok, true);
  assert.match(created.data.number, /^DC\d{8}\d{6}$/);
  assert.match(created.data.in_number, /^DR\d{8}\d{6}$/);
  assert.deepEqual(created.data.created, ['调拨物料-TR-001']);
  const legs = f.db.prepare("SELECT * FROM orders WHERE kind='transfer' ORDER BY id").all();
  assert.equal(legs.length, 2);
  const [out, incoming] = legs;
  assert.equal(out.type, 'out');
  assert.equal(out.warehouse_id, 1);
  assert.equal(out.transfer_warehouse_id, target);
  assert.equal(out.partner, '分仓');
  assert.equal(incoming.type, 'in');
  assert.equal(incoming.warehouse_id, target);
  assert.equal(incoming.transfer_warehouse_id, 1);
  assert.equal(incoming.partner, '主仓库');
  assert.equal(out.transfer_id, incoming.transfer_id);
  assert.equal(out.transfer_id, created.data.transfer_id);
  // Internal moves carry no money and never enter receivables.
  for (const leg of legs) {
    assert.equal(leg.total, 0);
    assert.equal(leg.settlement_tracked, 0);
    assert.equal(leg.partner_id, null);
    assert.equal(leg.source_order_id, null);
    assert.equal(leg.created_by_name, 'admin');
  }
  assert.equal(f.row(source).stock, 6);
  assert.equal(f.row(source).inventory_value_cents, 7200);
  const destination = f.db.prepare('SELECT * FROM products WHERE warehouse_id=?').get(target);
  assert.equal(destination.stock, 4);
  assert.equal(destination.inventory_value_cents, 4800);
  assert.equal(destination.sync_key, f.row(source).sync_key);
  assert.equal((await f.request('/finance')).data.balances.length, 1);
  const transfer = (await f.request('/transfers')).data;
  assert.equal(transfer.total, 1);
  assert.equal(transfer.has_more, false);
  assert.deepEqual(transfer.transfers.map((r) => [r.direction, r.counterpart_name, r.cost_cents]), [['out', '分仓', 4800]]);
  // The destination warehouse sees the inbound leg of the same transfer.
  const inbound = (await f.request('/transfers', 'GET', undefined, target)).data.transfers;
  assert.deepEqual(inbound.map((r) => [r.direction, r.counterpart_name, r.cost_cents]), [['in', '主仓库', 4800]]);
  assert.equal(inbound[0].transfer_id, created.data.transfer_id);
  // Both legs appear in each warehouse's history and in the product history.
  assert.equal((await f.request('/orders', 'GET', undefined, target)).data.orders[0].number, created.data.in_number);
  const history = (await f.request(`/products/${source}/history`)).data.records;
  assert.equal(history[0].number, created.data.number);
  assert.equal(history[0].delta, -4);
});

test('transfers validate warehouses, quantities, stock and duplicates without leaving half moves', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const source = await f.product('TR-002');
  await f.receive(source, 5, 10);
  const before = () => f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const cases = [
    [{ to_warehouse_id: 1, items: [{ product_id: source, quantity: 1 }] }, /调入仓库不能与调出仓库相同/],
    [{ to_warehouse_id: 999, items: [{ product_id: source, quantity: 1 }] }, /调入仓库不存在/],
    [{ items: [{ product_id: source, quantity: 1 }] }, /请选择调入仓库/],
    [{ to_warehouse_id: target, items: [] }, /1–100 种物料/],
    [{ to_warehouse_id: target, items: [{ product_id: source, quantity: 0 }] }, /调拨数量需为正数/],
    [{ to_warehouse_id: target, items: [{ product_id: source, quantity: 6 }] }, /库存不足/],
    [{ to_warehouse_id: target, items: [{ product_id: source, quantity: 1 }, { product_id: source, quantity: 1 }] }, /不能重复添加/],
    [{ to_warehouse_id: target, items: [{ product_id: 9999, quantity: 1 }] }, /物料不属于当前仓库/],
  ];
  for (const [body, expected] of cases) {
    const result = await f.command('/transfers', body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.match(result.data.error, expected);
  }
  assert.equal(before(), 1);
  assert.equal(f.row(source).stock, 5);
  assert.equal((await f.request('/transfers')).data.transfers.length, 0);
  // A product from another warehouse cannot be transferred out of this one.
  const remote = await f.product('TR-002-R', target);
  assert.equal((await f.command('/transfers', { to_warehouse_id: target, items: [{ product_id: remote, quantity: 1 }] })).status, 400);
});

test('retried transfers only create one pair and reused quantities stay consistent', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const source = await f.product('TR-003');
  await f.receive(source, 10, 10);
  const requestId = randomUUID();
  const body = { request_id: requestId, to_warehouse_id: target, items: [{ product_id: source, quantity: 3 }] };
  const first = await f.request('/transfers', 'POST', body);
  const second = await f.request('/transfers', 'POST', body);
  assert.equal(first.status, 200);
  assert.equal(second.data.number, first.data.number);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE kind='transfer'").get().n, 2);
  assert.equal(f.row(source).stock, 7);
  // A different body under the same identifier is rejected instead of silently reusing it.
  const conflicting = await f.request('/transfers', 'POST', { ...body, items: [{ product_id: source, quantity: 1 }] });
  assert.equal(conflicting.status, 400);
  assert.match(conflicting.data.error, /操作标识重复/);
  // Transferring the same archive twice keeps one linked product in the target.
  await f.command('/transfers', { to_warehouse_id: target, items: [{ product_id: source, quantity: 2 }] });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM products WHERE warehouse_id=?').get(target).n, 1);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE warehouse_id=?').get(target).stock, 5);
});

test('matched barcodes and missing archives both resolve to one linked product in the destination', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const withBarcode = await f.product('TR-004');
  await f.receive(withBarcode, 4, 10);
  const independent = await f.product('TR-004', target, { name: '分仓同名物料' });
  const moved = await f.command('/transfers', { to_warehouse_id: target, items: [{ product_id: withBarcode, quantity: 2 }] });
  assert.deepEqual(moved.data.created, []);
  assert.equal(f.row(independent).stock, 2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM products WHERE warehouse_id=?').get(target).n, 1);
  // A product with no archive in the destination gets one created from the source.
  const missing = await f.product('TR-005');
  await f.receive(missing, 3, 10);
  const created = await f.command('/transfers', { to_warehouse_id: target, items: [{ product_id: missing, quantity: 1 }] });
  assert.deepEqual(created.data.created, ['调拨物料-TR-005']);
  const copy = f.db.prepare('SELECT * FROM products WHERE warehouse_id=? AND barcode=?').get(target, 'TR-005');
  assert.equal(copy.stock, 1);
  assert.equal(copy.cost, f.row(missing).cost);
  assert.equal(copy.unit, f.row(missing).unit);
});

test('voiding a transfer restores both warehouses, refuses partial sides and keeps single-leg corrections out', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const source = await f.product('TR-006');
  await f.receive(source, 10, 15);
  const created = await f.command('/transfers', { to_warehouse_id: target, note: '补货', items: [{ product_id: source, quantity: 5 }] });
  const destination = f.db.prepare('SELECT * FROM products WHERE warehouse_id=?').get(target);
  assert.equal((await f.command(`/transfers/${created.data.transfer_id}/void`, {})).status, 400);
  assert.equal((await f.command(`/transfers/${created.data.transfer_id}/void`, { reason: '录错仓库' })).status, 200);
  assert.equal(f.row(source).stock, 10);
  assert.equal(f.row(source).inventory_value_cents, 15000);
  assert.equal(f.row(destination.id).stock, 0);
  assert.equal(f.row(destination.id).inventory_value_cents, 0);
  const legs = f.db.prepare("SELECT * FROM orders WHERE kind='transfer' ORDER BY id").all();
  for (const leg of legs) {
    assert.equal(leg.status, 'void');
    assert.equal(leg.void_reason, '录错仓库');
    assert.ok(leg.voided_at);
  }
  assert.equal((await f.command(`/transfers/${created.data.transfer_id}/void`, { reason: '再撤销' })).status, 400);
  assert.equal((await f.command('/transfers/6a1c4b6e-0000-4000-8000-000000000000/void', { reason: '不存在' })).status, 400);
  // The generic order corrections must not desync one side of a pair. Both
  // legs of an active transfer refuse them with a pointer to the right place.
  const activeLegs = f.db.prepare("SELECT id FROM orders WHERE kind='transfer' AND status='active' ORDER BY id").all();
  assert.equal(activeLegs.length, 0);
  const second = await f.command('/transfers', { to_warehouse_id: target, items: [{ product_id: source, quantity: 1 }] });
  for (const path of ['void', 'returns']) {
    const result = await f.command(`/orders/${f.db.prepare("SELECT id FROM orders WHERE kind='transfer' AND status='active' AND type='out'").get().id}/${path}`, { reason: '尝试单边' });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /仓库调拨/);
  }
  // Voiding from the destination warehouse is refused: the source owns the pair.
  assert.equal((await f.command(`/transfers/${second.data.transfer_id}/void`, { reason: '方向错误' }, target)).status, 400);
  // Consumed destination stock blocks the reversal instead of creating a negative balance.
  assert.equal((await f.command('/transfers', { to_warehouse_id: target, items: [{ product_id: source, quantity: 2 }] })).status, 200);
  await f.command('/orders', { type: 'out', partner: '客户', items: [{ product_id: f.db.prepare('SELECT id FROM products WHERE warehouse_id=?').get(target).id, quantity: 3, price: 20 }] }, target);
  const blocked = await f.command(`/transfers/${f.db.prepare("SELECT transfer_id FROM orders WHERE kind='transfer' AND status='active' ORDER BY id DESC LIMIT 1").get().transfer_id}/void`, { reason: '库存已消耗' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /库存不足/);
});

test('transfers survive backup and restore, and reject tampered pairs', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const source = await f.product('TR-007');
  await f.receive(source, 6, 10);
  const created = await f.command('/transfers', { to_warehouse_id: target, note: '备份用例', items: [{ product_id: source, quantity: 2 }] });
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 32);
  assert.equal(backup.data.orders.filter((o) => o.kind === 'transfer').length, 2);
  const before = structuredClone(backup.data);
  const preview = (await f.request('/backup/preview', 'POST', { backup })).data;
  assert.equal((await f.command('/backup/restore', { backup, token: preview.token, current_token: preview.current_token, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assertRestoredBusiness((await f.request('/backup')).data.data, before);
  const restored = f.db.prepare("SELECT * FROM orders WHERE kind='transfer' ORDER BY id").all();
  assert.equal(restored.length, 2);
  assert.equal(restored[0].transfer_id, created.data.transfer_id);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(source).stock, 4);
  // A single leg, crossed warehouses and mismatched lines are rejected.
  const single = structuredClone(backup);
  single.data.orders = single.data.orders.filter((o) => o.id !== restored[1].id);
  single.data.order_items = single.data.order_items.filter((i) => i.order_id !== restored[1].id);
  assert.equal((await f.request('/backup/preview', 'POST', { backup: single })).status, 400);
  const crossed = structuredClone(backup);
  crossed.data.orders.find((o) => o.id === restored[0].id).transfer_warehouse_id = 1;
  assert.equal((await f.request('/backup/preview', 'POST', { backup: crossed })).status, 400);
  const mismatched = structuredClone(backup);
  mismatched.data.order_items.find((i) => i.order_id === restored[1].id).quantity = 3;
  assert.equal((await f.request('/backup/preview', 'POST', { backup: mismatched })).status, 400);
  const legacy = structuredClone(backup);
  legacy.version = 11;
  for (const order of legacy.data.orders) { delete order.transfer_id; delete order.transfer_warehouse_id; }
  assert.equal((await f.request('/backup/preview', 'POST', { backup: legacy })).status, 200);
});

test('transfer records, notifications and reports keep internal moves out of money totals', async (t) => {
  const f = await fixture(t);
  const target = await f.warehouse('分仓');
  const source = await f.product('TR-008', 1, { threshold: 5 });
  await f.receive(source, 8, 10);
  f.db.prepare("UPDATE notification_settings SET enabled=1,url=?,format='json',events=?,warehouse_ids='[]',include_amounts=0 WHERE id=1")
    .run('https://hooks.example.com/x', JSON.stringify(['transfer']));
  const created = await f.command('/transfers', { to_warehouse_id: target, note: '预警测试', items: [{ product_id: source, quantity: 4 }] });
  assert.equal(created.status, 200);
  const deliveries = f.db.prepare("SELECT payload FROM notification_deliveries WHERE event='transfer'").all();
  assert.equal(deliveries.length, 1);
  const payload = JSON.parse(deliveries[0].payload);
  assert.equal(payload.event, 'transfer');
  assert.equal(payload.data.action, '仓库间调拨');
  assert.equal(payload.data.from, '主仓库');
  assert.equal(payload.data.to, '分仓');
  assert.equal(payload.data.number, created.data.number);
  assert.match(payload.message, /调出仓库：主仓库/);
  // A transfer never counts as purchase or sale in the rolling summary.
  const dashboard = (await f.request('/dashboard')).data;
  assert.equal(dashboard.today.purchase_count, 1);
  assert.equal(dashboard.today.sales_count, 0);
  // The dashboard covers the current warehouse only, and the moved value left it.
  assert.equal(dashboard.products.inventory_value_cents, f.row(source).inventory_value_cents);
  const hidden = await f.request('/finance');
  assert.deepEqual(hidden.data.balances.map((b) => b.name), ['供应商']);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE kind='transfer'").get().n, 2);
  const list = (await f.request('/orders', 'GET', undefined, target)).data.orders;
  assert.equal(list[0].kind, 'transfer');
  assert.equal(list[0].type, 'in');
});
