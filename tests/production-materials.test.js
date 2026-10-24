import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { migrateProduction } from '../server/production.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  // This Windows host allocates low ephemeral ports; fetch rejects reserved service ports.
  const blocked = new Set([1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
  while (server.address().port < 1024 || blocked.has(server.address().port)) {
    await new Promise(resolve => server.close(resolve));
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId || 1), Cookie: options.cookie === null ? '' : options.cookie || cookie || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  cookie = (await request('/auth/setup', { username: 'materialadmin', password: 'Test-admin-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const command = (path, body, options) => request(path, { request_id: randomUUID(), ...body }, options);
  const product = async barcode => { const result = await request('/products', { name: barcode, barcode, category: '生产', unit: 'kg', cost: 1, price: 2, threshold: 0 }); assert.equal(result.status, 201); return result.data.id; };
  const parent = await product('FINISHED'), material = await product('RAW'), second = await product('SECOND');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10001 WHERE id=?').run(material);
  db.prepare('UPDATE products SET stock=50,inventory_value_cents=5000 WHERE id=?').run(second);
  const bom = ok(await command('/boms', { name: '材料流程', product_id: parent, base_quantity: 1, base_unit: 'kg', note: '', enabled: 1,
    items: [{ product_id: material, quantity: 2, unit: 'kg', note: '' }, { product_id: second, quantity: 1, unit: 'kg', note: '' }] }));
  const create = async () => ok(await command('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '', material_workflow: 0 }));
  const get = id => request(`/production-orders/${id}`).then(ok);
  const stock = id => db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(id);
  const start = order => command(`/production-orders/${order.id}/start`, { version: order.version, schema_version: 2 }).then(ok);
  const confirm = doc => command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version }).then(ok);
  const complete = (order, quantity = 15, extra = {}) => command(`/production-orders/${order.id}/complete`, { version: order.version, completed_quantity: 5,
    items: [{ product_id: material, quantity }, { product_id: second, quantity: 5 }], finish_order: false, ...extra });
  return { db, request, command, ok, product, parent, material, second, bom, create, get, stock, start, confirm, complete };
}

test('start requests whole-order materials; warehouse approval deducts once; registration consumes the issued pool', async t => {
  const f = await fixture(t), initial = f.stock(f.material), order = await f.create();
  const started = await f.start(order);
  assert.equal(started.material_workflow, 1, 'request cannot bypass the new workflow');
  assert.equal(started.status, 'awaiting_materials');
  assert.deepEqual(f.stock(f.material), initial);
  assert.deepEqual(started.material_documents[0].items.map(row => row.quantity), [20, 10]);
  const confirmed = await f.confirm(started.material_documents[0]);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(f.stock(f.material).stock, 80);
  const active = await f.get(order.id);
  assert.equal(active.status, 'in_progress');
  const posted = f.ok(await f.complete(active));
  assert.equal(f.stock(f.material).stock, 80);
  assert.equal(posted.items[0].available_quantity, 5);
  assert.equal(posted.items[0].issued_quantity, 20);
  assert.equal(posted.items[0].available_cost_cents + posted.items[0].cost_cents, confirmed.items[0].cost_cents);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  const history = f.ok(await f.request(`/products/${f.material}/history`)).records;
  assert.deepEqual(history.map(row => [row.event, row.delta]), [['production_material_out', -20]]);
});

test('new orders cannot register before approval; cancellation reopens start, version/retries prevent duplicate posting', async t => {
  const f = await fixture(t), order = await f.create(), initial = f.stock(f.material);
  assert.equal((await f.complete(order)).status, 409);
  let active = await f.start(order), doc = active.material_documents[0];
  assert.equal((await f.complete(active)).status, 409);
  assert.equal((await f.command(`/production-orders/${order.id}/start`, { version: active.version })).status, 409);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/cancel`, { version: doc.version, reason: '' })).status, 400);
  doc = f.ok(await f.command(`/production-material-documents/${doc.id}/cancel`, { version: doc.version, reason: '重新核对' }));
  assert.equal(doc.status, 'cancelled'); assert.equal((await f.get(order.id)).status, 'draft');
  assert.deepEqual(f.stock(f.material), initial);
  active = await f.start(await f.get(order.id)); doc = active.material_documents.at(-1);
  const body = { version: doc.version, request_id: randomUUID() };
  const result = f.ok(await f.request(`/production-material-documents/${doc.id}/confirm`, body));
  assert.deepEqual(f.ok(await f.request(`/production-material-documents/${doc.id}/confirm`, body)), result);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })).status, 409);
  assert.equal(f.stock(f.material).stock, 80);
});

test('supplements, finished-order returns and batch reversal conserve the pool cost and never directly return raw stock', async t => {
  const f = await fixture(t), initial = f.stock(f.material); let order = await f.start(await f.create());
  await f.confirm(order.material_documents[0]); order = await f.get(order.id);
  order = f.ok(await f.complete(order));
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, schema_version: 2, type: 'out', items: [{ product_id: f.material, quantity: 2 }], note: '补料' }));
  assert.equal((await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: [{ product_id: f.material, quantity: 1 }], note: '' })).status, 409);
  assert.equal((await f.command(`/production-orders/${order.id}/finish`, { version: order.version })).status, 409);
  await f.confirm(order.material_documents.at(-1)); order = await f.get(order.id);
  assert.equal(order.items[0].available_quantity, 7);
  const beforeReverse = f.stock(f.material);
  order = f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, { version: order.version, reason: '数量修正' }));
  assert.equal(order.status, 'in_progress'); assert.equal(order.items[0].available_quantity, 22);
  assert.deepEqual(f.stock(f.material), beforeReverse);
  order = f.ok(await f.complete(order));
  order = f.ok(await f.command(`/production-orders/${order.id}/finish`, { version: order.version }));
  assert.equal((await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items: [{ product_id: f.material, quantity: 1 }], note: '' })).status, 409);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: [{ product_id: f.material, quantity: 7 }, { product_id: f.second, quantity: 5 }], note: '退余料' }));
  const returned = await f.confirm(order.material_documents.at(-1)); assert.equal(returned.status, 'confirmed');
  order = await f.get(order.id); assert.equal(order.items[0].available_quantity, 0); assert.equal(order.items[0].available_cost_cents, 0);
  assert.equal(f.stock(f.material).stock, 85);
  assert.equal(f.stock(f.material).inventory_value_cents + order.items[0].cost_cents, initial.inventory_value_cents);
  const backup = f.ok(await f.request('/backup')), preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  const restored = await f.get(order.id); assert.equal(restored.items[0].available_quantity, 0); assert.equal(restored.material_documents.length, 3);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('approval rechecks all stock atomically and return balances after concurrent registration', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); const doc = order.material_documents[0];
  f.db.prepare('UPDATE products SET stock=0,inventory_value_cents=0 WHERE id=?').run(f.second);
  const before = f.stock(f.material);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })).status, 400);
  assert.deepEqual(f.stock(f.material), before); assert.equal((await f.get(order.id)).status, 'awaiting_materials');
  f.db.prepare('UPDATE products SET stock=50,inventory_value_cents=5000 WHERE id=?').run(f.second);
  await f.confirm(doc); order = await f.get(order.id);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: [{ product_id: f.material, quantity: 10 }], note: '' }));
  const pending = order.material_documents.at(-1);
  order = f.ok(await f.complete(order));
  assert.equal((await f.command(`/production-material-documents/${pending.id}/confirm`, { version: pending.version })).status, 400);
  assert.equal((await f.get(order.id)).items[0].available_quantity, 5);
  assert.equal(f.stock(f.material).stock, 80);
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: order.version, reason: '未退料' })).status, 409);
});

test('production requests and warehouse approval have independent permissions, directional reads and finance redaction', async t => {
  const f = await fixture(t);
  const user = async (username, permissions) => {
    const created = await f.request('/users', { username, password: 'Test-staff-123' }); assert.equal(created.status, 201);
    f.ok(await f.request(`/users/${created.data.id}/permissions`, { version: 1, permissions }, { method: 'PUT' }));
    const cookie = (await f.request('/auth/login', { username, password: 'Test-staff-123' }, { cookie: null })).cookie;
    return { cookie, id: created.data.id };
  };
  const producer = await user('producer', ['production']), warehouse = await user('warehouse', ['sale']), receiver = await user('receiver', ['purchase']);
  let order = await f.create();
  order = f.ok(await f.command(`/production-orders/${order.id}/start`, { version: order.version }, producer));
  const doc = order.material_documents[0];
  const visibleCosts = value => JSON.stringify(value).includes('cost_cents');
  assert.equal(visibleCosts(order), false);
  assert.equal((await f.request('/production-material-documents?type=out', undefined, producer)).status, 403);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version }, producer)).status, 403);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version }, receiver)).status, 403);
  assert.equal((await f.request('/production-material-documents?type=in', undefined, warehouse)).status, 403);
  const listed = f.ok(await f.request('/production-material-documents?type=out&status=pending&q=RAW&offset=0&limit=1', undefined, warehouse));
  assert.equal(visibleCosts(listed), false);
  const all = f.ok(await f.request('/production-material-documents?type=out&status=pending&limit=1', undefined, warehouse));
  assert.equal(all.total, 1); assert.equal(all.documents[0].production_id, order.id);
  const body = { version: doc.version, request_id: randomUUID() };
  const approved = f.ok(await f.request(`/production-material-documents/${doc.id}/confirm`, body, warehouse));
  assert.equal(visibleCosts(approved), false);
  assert.equal((await f.request(`/production-orders/${order.id}`, undefined, warehouse)).status, 403);
  f.ok(await f.request(`/users/${warehouse.id}/permissions`, { version: f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(warehouse.id).permissions_version, permissions: ['purchase'] }, { method: 'PUT' }));
  assert.equal((await f.request(`/production-material-documents/${doc.id}/confirm`, body, warehouse)).status, 403, 'a retry must recheck the stored direction after permissions change');
  order = await f.get(order.id);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: [{ product_id: f.material, quantity: 1 }], note: '' }, producer));
  const pendingReturn = order.material_documents.at(-1);
  assert.equal((await f.command(`/production-material-documents/${pendingReturn.id}/cancel`, { version: pendingReturn.version, reason: '取消' }, producer)).status, 200);
});

test('material approvals reject disabled products, changed units, cross-warehouse documents and invalid quantities', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); const doc = order.material_documents[0];
  const initial = f.stock(f.material);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.material);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })).status, 400);
  f.db.prepare("UPDATE products SET active=1,unit='件' WHERE id=?").run(f.material);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })).status, 409);
  f.db.prepare("UPDATE products SET unit='kg' WHERE id=?").run(f.material);
  const warehouseId = (await f.request('/warehouses', { name: '分仓', reuse_catalog: false })).data.id;
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version }, { warehouseId })).status, 404);
  assert.deepEqual(f.stock(f.material), initial);
  await f.confirm(doc); order = await f.get(order.id);
  for (const items of [[{ product_id: f.parent, quantity: 1 }], [{ product_id: f.material, quantity: 0.00001 }], [{ product_id: f.material, quantity: -1 }], [{ product_id: f.material, quantity: 1 }, { product_id: f.material, quantity: 1 }]]) {
    assert.equal((await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items, note: '' })).status, 400);
  }
});

test('whole-order void requires returning the restored pool and removes ledger references only after correction', async t => {
  const f = await fixture(t), initial = f.stock(f.material); let order = await f.start(await f.create());
  await f.confirm(order.material_documents[0]); order = f.ok(await f.complete(await f.get(order.id)));
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: order.version, reason: '取消' })).status, 409);
  order = f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, { version: order.version, reason: '取消批次' }));
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'in', items: order.items.map(item => ({ product_id: item.product_id, quantity: item.available_quantity })), note: '' }));
  await f.confirm(order.material_documents.at(-1)); order = await f.get(order.id);
  order = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: order.version, reason: '材料已退' }));
  assert.equal(order.status, 'void'); assert.deepEqual(f.stock(f.material), initial);
  f.ok(await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) }));
  f.ok(await f.command(`/production-orders/${order.id}/delete`, { version: order.version }));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_material_documents').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_material_document_items').get().n, 0);
});

test('backup ledger rejects forged phases, unbalanced costs and malformed document references', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order = f.ok(await f.complete(await f.get(order.id))); const backup = f.ok(await f.request('/backup'));
  for (const mutate of [
    data => { data.production_orders[0].material_phase = 'draft'; },
    data => { data.production_material_documents[0].production_id = 9999; },
    data => { data.production_material_document_items[0].cost_cents++; },
    data => { data.production_material_document_items[0].quantity = 1; },
    data => { data.production_material_documents[0].status = 'pending'; },
    data => { data.production_orders[0].material_workflow = 0; },
  ]) {
    const broken = structuredClone(backup); mutate(broken.data);
    assert.equal((await f.request('/backup/preview', { backup: broken })).status, 400);
  }
});

test('material pool quantity caps reject an entire supplement without changing stock', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]); order = await f.get(order.id);
  f.db.prepare('UPDATE products SET stock=99999990,inventory_value_cents=10 WHERE id=?').run(f.material);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items: [{ product_id: f.material, quantity: 99999990 }], note: '' }));
  const before = f.stock(f.material), doc = order.material_documents.at(-1);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })).status, 400);
  assert.deepEqual(f.stock(f.material), before);
});

test('material pool value caps reject costs that cannot be represented safely', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]); order = await f.get(order.id);
  f.db.prepare('UPDATE products SET stock=1,inventory_value_cents=? WHERE id=?').run(Number.MAX_SAFE_INTEGER, f.material);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items: [{ product_id: f.material, quantity: 1 }], note: '' }));
  const before = f.stock(f.material), doc = order.material_documents.at(-1);
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })).status, 400);
  assert.deepEqual(f.stock(f.material), before);
});

test('migrated databases and version 33 backups retain historical workflow while all later API orders require approval', async t => {
  const f = await fixture(t), order = await f.create();
  f.db.exec('DROP TRIGGER data_revision_production_orders_UPDATE; ALTER TABLE production_orders DROP COLUMN material_workflow; ALTER TABLE production_orders DROP COLUMN material_phase;');
  migrateProduction(f.db); migrateProduction(f.db);
  let historical = await f.get(order.id); assert.equal(historical.material_workflow, 0);
  historical = f.ok(await f.complete(historical)); assert.equal(f.stock(f.material).stock, 85);
  const backup = f.ok(await f.request('/backup')); backup.version = 33;
  delete backup.data.production_material_documents; delete backup.data.production_material_document_items;
  for (const row of backup.data.production_orders) { delete row.material_workflow; delete row.material_phase; }
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal((await f.get(order.id)).material_workflow, 0);
  f.bom.version = f.db.prepare('SELECT version FROM boms WHERE id=?').get(f.bom.id).version;
  const fresh = await f.create(); assert.equal(fresh.material_workflow, 1); assert.equal((await f.complete(fresh)).status, 409);
});

test('backup cannot replace a pending initial request with a supplement on a draft order', async t => {
  const f = await fixture(t); await f.start(await f.create()); const backup = f.ok(await f.request('/backup'));
  backup.data.production_orders[0].material_phase = 'draft';
  backup.data.production_material_documents[0].kind = 'supplement';
  assert.equal((await f.request('/backup/preview', { backup })).status, 400);
});

test('registration works with zero raw warehouse stock and competing approval versions post once', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE products SET stock=20,inventory_value_cents=2001 WHERE id=?').run(f.material);
  f.db.prepare('UPDATE products SET stock=10,inventory_value_cents=1000 WHERE id=?').run(f.second);
  let order = await f.start(await f.create()); const doc = order.material_documents[0];
  const responses = await Promise.all([1,2].map(() => f.command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })));
  assert.deepEqual(responses.map(row => row.status).sort(), [200,409]);
  assert.equal(f.stock(f.material).stock, 0);
  order = f.ok(await f.complete(await f.get(order.id)));
  assert.equal(order.items[0].available_quantity, 5); assert.equal(f.stock(f.material).stock, 0);
});

test('warehouse queues paginate and filter literally; material requests retain four-decimal whole-unit rules', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE products SET unit_round_up=1 WHERE id=?').run(f.material);
  let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]); order = await f.get(order.id);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items: [{ product_id: f.material, quantity: 0.1 }], note: '' }));
  assert.equal(order.material_documents.at(-1).items[0].quantity, 1);
  const page = f.ok(await f.request('/production-material-documents?type=out&limit=1&offset=0'));
  assert.equal(page.total, 2); assert.equal(page.has_more, true);
  assert.equal(f.ok(await f.request('/production-material-documents?type=out&limit=1&offset=1')).has_more, false);
  assert.equal(f.ok(await f.request('/production-material-documents?type=out&status=confirmed')).total, 1);
  assert.equal(f.ok(await f.request('/production-material-documents?type=out&q=%25_')).total, 0);
  for (const query of ['?type=bad', '?type=out&status=bad', '?type=out&offset=-1', '?type=out&limit=101', '?type=out&q=a&q=b']) assert.equal((await f.request('/production-material-documents' + query)).status, 400);
});

async function highLifetimeCost(t) {
  const f = await fixture(t);
  f.db.prepare('UPDATE products SET stock=20,inventory_value_cents=? WHERE id=?').run(Number.MAX_SAFE_INTEGER - 1, f.material);
  f.db.prepare('UPDATE products SET stock=10,inventory_value_cents=0 WHERE id=?').run(f.second);
  let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order = f.ok(await f.complete(await f.get(order.id), 20));
  f.db.prepare('UPDATE products SET stock=1,inventory_value_cents=3 WHERE id=?').run(f.material);
  order = f.ok(await f.command(`/production-orders/${order.id}/material-requests`, { version: order.version, type: 'out', items: [{ product_id: f.material, quantity: 1 }], note: '' }));
  await f.confirm(order.material_documents.at(-1));
  return { f, order: await f.get(order.id) };
}

test('pool costs retain every cent when lifetime issued value exceeds the safe integer range', async t => {
  const { f, order } = await highLifetimeCost(t);
  assert.equal(order.items[0].available_quantity, 1);
  assert.equal(order.items[0].available_cost_cents, 3);
  const backup = f.ok(await f.request('/backup')); f.ok(await f.request('/backup/preview', { backup }));
});

test('batch void atomically rejects a restored material pool whose value would exceed the safe range', async t => {
  const { f, order } = await highLifetimeCost(t);
  const before = f.stock(f.parent);
  assert.equal((await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, { version: order.version, reason: '原成本退回超限' })).status, 400);
  assert.deepEqual(f.stock(f.parent), before);
  assert.equal((await f.get(order.id)).batches[0].status, 'active');
});
