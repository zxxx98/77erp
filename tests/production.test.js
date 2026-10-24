import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { moveInventory } from '../server/commerce.js';
import { productionMaterialAnalysis } from '../shared/production.js';
import { parseBomQuantity } from '../shared/bom.js';
import { migrateBom } from '../server/bom.js';
import { migrateProduction } from '../server/production.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId || 1),
        ...(options.cookie === null ? {} : { Cookie: options.cookie || cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = await response.json();
    // These regressions deliberately retain historical direct-stock production semantics.
    // Only test fixtures tag persisted rows; API requests cannot opt out of the new workflow.
    if (path === '/production-orders' && body !== undefined && response.status === 200) {
      db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(data.id);
      data.material_workflow = 0;
    }
    // Existing accounting regressions exercise posted output by explicitly approving
    // the new receipt through the warehouse API. Future batches never bypass approval.
    if (response.status === 200 && /\/production-orders\/\d+\/complete$/.test(path) && !options.pendingReceipt) {
      const current = (await request(`/production-orders/${data.id}`, undefined, options)).data;
      for (const doc of current.receipt_documents || []) if (doc.status === 'pending') {
        const approved = await request(`/production-receipts/${doc.id}/confirm`, {version:doc.version,request_id:randomUUID()});
        assert.equal(approved.status,200,JSON.stringify(approved.data));
      }
      data = {...(await request(`/production-orders/${data.id}`, undefined, options)).data, captured_at: data.captured_at};
    }
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  cookie = (await request('/auth/setup', { username: 'productionadmin', password: 'Test-admin-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const command = (path, body, options) => request(path, { request_id: randomUUID(), ...body }, options);
  const product = async (barcode, warehouseId = 1, extra = {}) => {
    const result = await request('/products', { name: `物料 ${barcode}`, barcode, category: '生产', unit: '件', cost: 1, price: 2, threshold: 0, ...extra }, { warehouseId });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.id;
  };
  const parent = await product('FINISHED'), material = await product('MATERIAL'), second = await product('SECOND');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=12345 WHERE id=?').run(material);
  db.prepare('UPDATE products SET stock=50,inventory_value_cents=5000 WHERE id=?').run(second);
  const definition = (extra = {}) => ({ name: '生产测试配方', product_id: parent, base_quantity: 2, base_unit: '件', note: '', enabled: 1,
    items: [{ product_id: material, quantity: 3, unit: '件', note: '材料备注' }, { product_id: second, quantity: 0.2, unit: '件', note: '' }], ...extra });
  const bom = ok(await command('/boms', definition()));
  const plan = extra => ({ bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '生产备注', ...extra });
  const create = async extra => ok(await command('/production-orders', plan(extra)));
  const completion = (order, extra) => ({ version: order.version, completed_quantity: 9,
    items: [{ product_id: material, quantity: 16 }, { product_id: second, quantity: 1.5 }], ...extra });
  const complete = async order => ok(await command(`/production-orders/${order.id}/complete`, completion(order)));
  const inventory = () => db.prepare('SELECT id,stock,inventory_value_cents,version FROM products ORDER BY id').all();
  return { db, request, command, ok, product, parent, material, second, bom, definition, plan, create, completion, complete, inventory };
}

test('production deletion requires a void order and current version, isolates warehouses and deduplicates retries', async t => {
  const f = await fixture(t), order = await f.create(), path = `/production-orders/${order.id}/delete`;
  const remove = version => f.command(path, { version });
  assert.equal((await remove(order.version)).status, 409);
  const active = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { finish_order: false })));
  assert.equal(active.status, 'in_progress');
  assert.equal((await remove(active.version)).status, 409);
  const done = f.ok(await f.command(`/production-orders/${order.id}/finish`, { version: active.version }));
  assert.equal((await remove(done.version)).status, 409);
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '取消生产' }));
  const before = f.inventory(), revision = f.ok(await f.request('/updates')).revision;
  assert.equal((await remove(done.version)).status, 409);
  assert.equal((await remove(undefined)).status, 409);
  assert.equal((await remove(String(voided.version))).status, 409);
  const body = { version: voided.version, request_id: randomUUID() };
  assert.equal((await f.request(path, body, { cookie: null })).status, 401);
  const warehouseId = (await f.request('/warehouses', { name: '删除隔离仓库' })).data.id;
  assert.equal((await f.request(path, body, { warehouseId })).status, 404);
  const retained = await f.create();
  const backup = f.ok(await f.request('/backup')), preview = f.ok(await f.request('/backup/preview', { backup }));
  assert.deepEqual(f.ok(await f.request(path, body)), { ok: true });
  assert.deepEqual(f.ok(await f.request(path, body)), { ok: true });
  assert.equal((await remove(voided.version)).status, 404);
  assert.equal((await f.request(`/production-orders/${order.id}`)).status, 404);
  assert.deepEqual(f.ok(await f.request('/production-orders')).orders.map(row => row.id), [retained.id]);
  assert.notEqual(f.ok(await f.request('/updates')).revision, revision);
  assert.equal((await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 400);
  assert.deepEqual(f.inventory(), before);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const product of [f.parent, f.material, f.second]) assert.deepEqual(f.ok(await f.request(`/products/${product}/history`)).records, []);
  const after = f.ok(await f.request('/backup'));
  assert.deepEqual(after.data.production_orders.map(row => row.id), [retained.id]);
  assert.ok(after.data.production_items.every(row => row.production_id === retained.id));
  assert.equal(after.data.production_batches.length, 0);
});

test('deleting a void draft releases its BOM reference without changing inventory', async t => {
  const f = await fixture(t), order = await f.create();
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: order.version, reason: '取消草稿' }));
  const before = f.inventory();
  assert.equal((await f.command(`/boms/${f.bom.id}/delete`, { version: f.bom.version })).status, 409);
  f.ok(await f.command(`/production-orders/${order.id}/delete`, { version: voided.version }));
  assert.deepEqual(f.inventory(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_items').get().n, 0);
  f.ok(await f.command(`/boms/${f.bom.id}/delete`, { version: f.bom.version }));
});

test('production drafts preserve exact BOM snapshots, rescale batches and never reserve stock or create commerce', async t => {
  const f = await fixture(t), before = f.inventory(), revision = (await f.request('/updates')).data.revision;
  const body = { ...f.plan(), request_id: randomUUID() };
  const order = f.ok(await f.request('/production-orders', body));
  assert.deepEqual((await f.request('/production-orders', body)).data, order);
  assert.match(order.number, /^SC\d{8}-[a-f0-9]{12}$/);
  assert.equal(order.status, 'draft'); assert.equal(order.bom_version, f.bom.version);
  assert.deepEqual(order.items.map(row => row.planned_quantity), [15, 1]);
  assert.ok(order.items.every(row => row.actual_quantity === null && row.cost_cents === null));
  assert.notEqual((await f.request('/updates')).data.revision, revision);
  const changed = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, name: '修改后的配方', base_quantity: 1,
    items: [{ product_id: f.material, quantity: 99, unit: '件', note: '新备注' }] })));
  assert.notEqual(changed.version, f.bom.version);
  const saved = f.ok(await f.command(`/production-orders/${order.id}`, { version: order.version, planned_quantity: 1, note: '调整产量' }));
  assert.deepEqual(saved.items.map(row => row.planned_quantity), [1.5, 0.1]);
  assert.equal(saved.bom_name, '生产测试配方'); assert.equal(saved.items[0].note, '材料备注');
  assert.notEqual(saved.version, order.version);
  assert.equal((await f.command(`/production-orders/${order.id}`, { version: order.version, planned_quantity: 2, note: '' })).status, 409);
  assert.equal((await f.command('/production-orders', f.plan())).status, 409, 'new orders must review changed recipe');
  assert.deepEqual(f.inventory(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_adjustments').get().n, 0);
  const rounded = await f.create({ bom_id: changed.id, bom_version: changed.version, planned_quantity: 0.0001 });
  assert.equal(rounded.items[0].planned_quantity, 0.0099);
});

test('loss snapshots drive plans and actual-output variance without double-counting scrap, survive restore and reverse exactly', async t => {
  const f = await fixture(t), oldDraft = await f.create(), scrap = await f.product('LOSS-SCRAP'), outputScrap = await f.product('OUTPUT-SCRAP');
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version,
    items: [{ product_id: f.material, quantity: 9, loss_rate: 10, unit: '件', note: '' }],
    scraps: [{ product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 6, unit: '件', note: '' },
      { product_id: outputScrap, method: 'output', source_product_id: null, quantity: 0.5, unit: '件', note: '' }] })));
  const before = f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]);
  const prepared = f.ok(await f.request('/production-orders/prepare', f.plan({ bom_version: bom.version })));
  assert.equal(prepared.rows[0].required, 50); assert.equal(prepared.rows[0].loss_rate, 10);
  assert.deepEqual(prepared.scraps.map(row => row.planned_quantity), [3, 2.5]);
  const draft = await f.create({ bom_version: bom.version });
  assert.equal(draft.items[0].loss_rate, 10); assert.equal(draft.items[0].planned_quantity, 50);
  assert.equal((await f.request(`/production-orders/${oldDraft.id}`)).data.items[0].loss_rate, 0);
  // Changing the live recipe must not affect either previously saved order.
  f.ok(await f.command(`/boms/${bom.id}`, { ...bom, items: [{ ...bom.items[0], loss_rate: 25 }] }));
  const resized = f.ok(await f.command(`/production-orders/${draft.id}`, { version: draft.version, planned_quantity: 4, note: '' }));
  assert.equal(resized.items[0].loss_rate, 10); assert.equal(resized.items[0].planned_quantity, 20);
  assert.deepEqual(resized.scraps.map(row => row.planned_quantity), [1.2, 1]);
  const done = f.ok(await f.command(`/production-orders/${draft.id}/complete`, { version: resized.version, completed_quantity: 6,
    items: [{ product_id: f.material, quantity: 33, variance_reason: '额外调机' }],
    scraps: [{ product_id: scrap, quantity: 2, disposition: 'stock' }, { product_id: outputScrap, quantity: 1.5, disposition: 'discard' }] }));
  assert.equal(done.items[0].standard_quantity, 30); assert.equal(done.items[0].variance_quantity, 3); assert.equal(done.items[0].variance_rate, 10);
  assert.deepEqual(done.scraps.map(row => row.expected_quantity), [1.98, 1.5], 'completion uses actual input, not a second loss multiplier');
  const backup = f.ok(await f.request('/backup')); assert.equal(backup.version, 36);
  for (const change of [
    data => { data.bom_items[0].loss_rate = 100; },
    data => { data.production_items.at(-1).loss_rate = 25; },
    data => { data.production_items.at(-1).loss_rate = null; },
    data => { delete data.bom_items[0].loss_rate; },
    data => { delete data.production_items.at(-1).loss_rate; },
  ]) {
    const invalid = structuredClone(backup); change(invalid.data);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const after = f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]);
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.deepEqual(f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]), after);
  const loaded = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.equal(loaded.items[0].loss_rate, 10); assert.equal(loaded.items[0].standard_quantity, 30);
  const voided = f.ok(await f.command(`/production-orders/${loaded.id}/void`, { version: loaded.version, reason: '测试回退' }));
  assert.equal(voided.items[0].standard_quantity, 30); assert.equal(voided.items[0].variance_reason, '额外调机');
  assert.deepEqual(f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]), before);
});

test('database upgrades and format 27 restore zero loss rates without changing old production analysis', async t => {
  const f = await fixture(t), done = await f.complete(await f.create());
  const backup = f.ok(await f.request('/backup')); backup.version = 27;
  for (const table of ['bom_items', 'production_items']) for (const row of backup.data[table]) delete row.loss_rate;
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.ok((await f.request(`/boms/${f.bom.id}`)).data.items.every(row => row.loss_rate === 0));
  const loaded = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.ok(loaded.items.every(row => row.loss_rate === 0));
  assert.deepEqual(loaded.items.map(row => row.standard_quantity), done.items.map(row => row.standard_quantity));
  for (const table of ['bom_items', 'production_items'])
    f.db.exec(`DROP TRIGGER data_revision_${table}_UPDATE; ALTER TABLE ${table} DROP COLUMN loss_rate;`);
  migrateBom(f.db); migrateProduction(f.db);
  for (const table of ['bom_items', 'production_items']) assert.ok(f.db.prepare(`SELECT loss_rate FROM ${table}`).all().every(row => row.loss_rate === 0));
});

test('external loss snapshots drive rescaling, batch standards and restore independently of the current BOM', async t => {
  const f = await fixture(t);
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, loss_method: 'external',
    items: [{ product_id: f.material, quantity: 9, loss_rate: 10, unit: '件', note: '' }] })));
  const draft = await f.create({ bom_version: bom.version });
  assert.equal(draft.loss_method, 'external'); assert.equal(draft.items[0].planned_quantity, 49.5);
  f.ok(await f.command(`/boms/${bom.id}`, { ...bom, loss_method: 'internal' }));
  const resized = f.ok(await f.command(`/production-orders/${draft.id}`, { version: draft.version, planned_quantity: 6, note: '' }));
  assert.equal(resized.loss_method, 'external'); assert.equal(resized.items[0].planned_quantity, 29.7);
  const batch = f.ok(await f.command(`/production-orders/${draft.id}/complete`, { version: resized.version, completed_quantity: 2,
    finish_order: false, items: [{ product_id: f.material, quantity: 11 }] }));
  const done = f.ok(await f.command(`/production-orders/${draft.id}/complete`, { version: batch.version, completed_quantity: 4,
    items: [{ product_id: f.material, quantity: 22 }] }));
  assert.equal(done.items[0].standard_quantity, 29.7); assert.equal(done.items[0].variance_quantity, 3.3);
  assert.deepEqual(done.batches.map(batch => batch.items[0].standard_quantity), [9.9, 19.8]);
  const backup = f.ok(await f.request('/backup'));
  for (const change of [
    data => { data.boms[0].loss_method = 'invalid'; },
    data => { delete data.boms[0].loss_method; },
    data => { data.production_orders[0].loss_method = 'internal'; },
    data => { data.production_orders[0].loss_method = null; },
    data => { delete data.production_orders[0].loss_method; },
  ]) {
    const invalid = structuredClone(backup); change(invalid.data);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  const loaded = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.equal(loaded.loss_method, 'external'); assert.equal(loaded.items[0].standard_quantity, 29.7);
});

test('format 30 backups and existing databases default to internal loss without changing saved standards', async t => {
  const f = await fixture(t);
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version,
    items: [{ product_id: f.material, quantity: 9, loss_rate: 10, unit: '件', note: '' }] })));
  const draft = await f.create({ bom_version: bom.version });
  const backup = f.ok(await f.request('/backup')); backup.version = 30;
  for (const table of ['boms', 'production_orders']) for (const row of backup.data[table]) delete row.loss_method;
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal((await f.request(`/boms/${bom.id}`)).data.loss_method, 'internal');
  const loaded = f.ok(await f.request(`/production-orders/${draft.id}`));
  assert.equal(loaded.loss_method, 'internal'); assert.equal(loaded.items[0].planned_quantity, 50);
  for (const table of ['boms', 'production_orders']) f.db.exec(`DROP TRIGGER data_revision_${table}_UPDATE; ALTER TABLE ${table} DROP COLUMN loss_method;`);
  migrateBom(f.db); migrateProduction(f.db); migrateBom(f.db); migrateProduction(f.db);
  for (const table of ['boms', 'production_orders']) assert.equal(f.db.prepare(`SELECT loss_method FROM ${table} LIMIT 1`).get().loss_method, 'internal');
});

test('fractional recipes survive production snapshots, rescaling, completion, backup and reversal', async t => {
  const f = await fixture(t), before = f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]);
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, base_quantity: 1,
    items: [{ product_id: f.material, ...parseBomQuantity('1/40'), unit: '件', note: '每 40 件一箱' },
      { product_id: f.second, ...parseBomQuantity('1/3'), unit: '件', note: '' }] })));
  const draft = await f.create({ bom_version: bom.version, planned_quantity: 40 });
  assert.deepEqual(draft.items.map(item => item.planned_quantity), [1, 13.3334]);
  assert.deepEqual(draft.items.map(item => item.base_quantity_fraction), ['1/40', '1/3']);
  f.ok(await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version })));
  const updated = f.ok(await f.command(`/production-orders/${draft.id}`, { version: draft.version, planned_quantity: 3, note: '' }));
  assert.deepEqual(updated.items.map(item => item.planned_quantity), [0.075, 1]);
  const done = f.ok(await f.command(`/production-orders/${draft.id}/complete`, { version: updated.version, completed_quantity: 3,
    items: updated.items.map(item => ({ product_id: item.product_id, quantity: item.planned_quantity })) }));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.material).stock, 99.925);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.second).stock, 49);
  const backup = f.ok(await f.request('/backup'));
  const tampered = structuredClone(backup); tampered.data.production_items[0].base_quantity_fraction = '1/3';
  assert.equal((await f.request('/backup/preview', { backup: tampered })).status, 400);
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  const restored = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.equal(restored.items[0].base_quantity_fraction, '1/40');
  f.ok(await f.command(`/production-orders/${done.id}/void`, { version: restored.version, reason: '核对分数耗料回退' }));
  assert.deepEqual(f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]), before);
});

test('existing decimal BOMs and production records migrate with empty fractions and accept version 24 backups', async t => {
  const f = await fixture(t), order = await f.create();
  f.db.exec(`DROP TRIGGER data_revision_bom_items_UPDATE; DROP TRIGGER data_revision_production_items_UPDATE;
    ALTER TABLE bom_items DROP COLUMN quantity_fraction; ALTER TABLE production_items DROP COLUMN base_quantity_fraction;`);
  migrateBom(f.db); migrateProduction(f.db); migrateBom(f.db); migrateProduction(f.db);
  assert.equal(f.db.prepare('SELECT quantity_fraction FROM bom_items LIMIT 1').get().quantity_fraction, '');
  assert.equal(f.db.prepare('SELECT base_quantity_fraction FROM production_items LIMIT 1').get().base_quantity_fraction, '');
  const backup = f.ok(await f.request('/backup')); backup.version = 24;
  for (const row of backup.data.bom_items) delete row.quantity_fraction;
  for (const row of backup.data.production_items) delete row.base_quantity_fraction;
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.deepEqual(f.ok(await f.request(`/production-orders/${order.id}`)).items.map(item => item.planned_quantity), [15, 1]);
});

test('actual consumption transfers weighted inventory value to good output exactly once, and void restores original quantities and costs', async t => {
  const f = await fixture(t), before = f.inventory(), order = await f.create();
  const body = { ...f.completion(order), request_id: randomUUID() }, path = `/production-orders/${order.id}/complete`;
  const done = f.ok(await f.request(path, body));
  assert.equal(done.status, 'completed'); assert.equal(done.completed_quantity, 9);
  assert.deepEqual(done.items.map(row => row.cost_cents), [1975, 150]); assert.equal(done.total_cost_cents, 2125);
  assert.deepEqual(f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]), [[9, 2125], [84, 10370], [48.5, 4850]]);
  const after = f.inventory(); assert.deepEqual(f.ok(await f.request(path, body)), done); assert.deepEqual(f.inventory(), after);
  assert.equal((await f.command(path, f.completion(done))).status, 409);
  assert.equal((await f.command(`/production-orders/${order.id}`, { version: done.version, planned_quantity: 1, note: '' })).status, 409);
  const voidBody = { version: done.version, reason: '误报完工', request_id: randomUUID() }, voidPath = `/production-orders/${order.id}/void`;
  const voided = f.ok(await f.request(voidPath, voidBody));
  assert.equal(voided.status, 'void'); assert.equal(voided.voided_by_name, 'productionadmin'); assert.equal(voided.completed_by_name, 'productionadmin');
  assert.deepEqual(f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]), before.map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]));
  const reverted = f.inventory(); assert.deepEqual(f.ok(await f.request(voidPath, voidBody)), voided); assert.deepEqual(f.inventory(), reverted);
  assert.equal((await f.command(voidPath, { version: voided.version, reason: '再次作废' })).status, 409);
  const materialHistory = f.ok(await f.request(`/products/${f.material}/history`)).records;
  assert.deepEqual(materialHistory.map(row => [row.event, row.delta]).sort(), [['production_out', -16], ['production_void_in', 16]].sort());
  const finishedHistory = f.ok(await f.request(`/products/${f.parent}/history`)).records;
  assert.deepEqual(finishedHistory.map(row => [row.event, row.delta]).sort(), [['production_in', 9], ['production_void_out', -9]].sort());
  assert.ok(materialHistory.every(row => row.number === order.number && row.operator === 'productionadmin'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
});

test('completion and reversal failures roll back all inventory, costs, versions, rows and request receipts', async t => {
  const f = await fixture(t), order = await f.create(), before = f.inventory();
  const failures = [
    { items: [{ product_id: f.material, quantity: 16 }, { product_id: f.second, quantity: 51 }] },
    { completed_quantity: 0 }, { completed_quantity: 0.0000001 }, { completed_quantity: '1' },
    { items: [] }, { items: null }, { items: [{ product_id: f.material, quantity: 1 }, { product_id: f.material, quantity: 1 }] },
    { items: [{ product_id: f.material, quantity: 0 }, { product_id: f.second, quantity: 0 }] },
    { items: [{ product_id: f.material, quantity: -1 }, { product_id: f.second, quantity: 1 }] },
    { items: [{ product_id: f.parent, quantity: 1 }, { product_id: f.second, quantity: 1 }] },
    { version: order.version + 1 },
  ];
  const receiptCount = f.db.prepare('SELECT COUNT(*) n FROM operation_requests').get().n;
  for (const extra of failures) {
    assert.ok([400, 409].includes((await f.command(`/production-orders/${order.id}/complete`, f.completion(order, extra))).status), JSON.stringify(extra));
    assert.deepEqual(f.inventory(), before);
    assert.equal(f.db.prepare('SELECT version FROM production_orders WHERE id=?').get(order.id).version, order.version);
    assert.ok(f.db.prepare('SELECT * FROM production_items').all().every(row => row.actual_quantity === null));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM operation_requests').get().n, receiptCount);
    assert.equal(f.db.isTransaction, false);
  }
  // Output stock/value caps are now checked atomically at receipt approval;
  // the dedicated production-receipts suite covers those independent transactions.
  const done = await f.complete(order);
  moveInventory(f.db, f.parent, -1);
  const shipped = f.inventory();
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '成品已使用' })).status, 400);
  assert.deepEqual(f.inventory(), shipped);
  moveInventory(f.db, f.parent, 1, 0);
  const changedCost = f.inventory();
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '成本被占用' })).status, 400);
  assert.deepEqual(f.inventory(), changedCost);
  assert.equal(f.db.prepare('SELECT status FROM production_orders WHERE id=?').get(order.id).status, 'completed');
});

test('production supports four decimals, zero unused rows, and preserves original cost through later material receipts', async t => {
  const f = await fixture(t), order = await f.create({ planned_quantity: 0.0001 });
  assert.deepEqual(order.items.map(row => row.planned_quantity), [0.0002, 0.0001]);
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { completed_quantity: 0.0001,
    items: [{ product_id: f.material, quantity: 0.0002 }, { product_id: f.second, quantity: 0 }] })));
  assert.equal(done.total_cost_cents, 0); assert.equal(done.items[1].actual_quantity, 0);
  assert.equal(f.inventory()[1].stock, 99.9998);
  f.ok(await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '小数回退' }));
  const next = await f.create(), completed = await f.complete(next);
  moveInventory(f.db, f.material, 10, 9999);
  const value = f.inventory()[1].inventory_value_cents;
  f.ok(await f.command(`/production-orders/${next.id}/void`, { version: completed.version, reason: '保留原成本' }));
  assert.equal(f.inventory()[1].inventory_value_cents, value + 1975);
  assert.equal(f.inventory()[1].stock, 110);
});

test('inactive goods and changed units block completion; drafts can be voided without stock changes and completed records remain visible', async t => {
  const f = await fixture(t), order = await f.create();
  for (const id of [f.parent, f.material]) {
    f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(id);
    assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(order))).status, 400);
    f.db.prepare('UPDATE products SET active=1,unit=? WHERE id=?').run('箱', id);
    assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(order))).status, 409);
    f.db.prepare('UPDATE products SET unit=? WHERE id=?').run('件', id);
  }
  const done = await f.complete(order), before = f.inventory();
  f.db.prepare('UPDATE products SET unit=? WHERE id=?').run('箱', f.parent);
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '单位已变' })).status, 409);
  f.db.prepare('UPDATE products SET unit=?,active=0 WHERE id IN (?,?)').run('件', f.parent, f.material);
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '允许退回停用物料' }));
  assert.equal(voided.status, 'void');
  f.db.prepare('UPDATE products SET active=1 WHERE id IN (?,?)').run(f.parent, f.material);
  const draft = await f.create(), current = f.inventory();
  assert.equal((await f.command(`/production-orders/${draft.id}/void`, { version: draft.version, reason: '' })).status, 400);
  const cancelled = f.ok(await f.command(`/production-orders/${draft.id}/void`, { version: draft.version, reason: '取消计划' }));
  assert.equal(cancelled.completed_at, null); assert.deepEqual(f.inventory(), current);
  assert.equal((await f.request(`/products/${f.parent}`, {}, { method: 'DELETE' })).status, 400);
  assert.ok(before.length);
});

test('production permission is independent of BOM, writes and financial reads are scoped, and void also requires corrections', async t => {
  const f = await fixture(t), order = await f.create();
  const user = (await f.request('/users', { username: 'producer', password: 'Test-staff-123' })).data;
  const cookie = (await f.request('/auth/login', { username: 'producer', password: 'Test-staff-123' }, { cookie: null })).cookie;
  const permissions = async permissions => f.ok(await f.request(`/users/${user.id}/permissions`, { permissions, version: f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(user.id).permissions_version }, { method: 'PUT' }));
  const asStaff = { cookie };
  assert.equal((await f.request('/production-orders', undefined, { cookie: null })).status, 401);
  await permissions(['bom', 'corrections']);
  assert.equal((await f.request('/production-orders', undefined, asStaff)).status, 403);
  assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(order), asStaff)).status, 403);
  await permissions(['production']);
  assert.equal((await f.request('/boms', undefined, asStaff)).status, 403);
  assert.equal((await f.request('/production-orders/boms', undefined, asStaff)).status, 200);
  await permissions(['production', 'finance']);
  const completionBody = { ...f.completion(order), request_id: randomUUID() };
  const withCosts = f.ok(await f.request(`/production-orders/${order.id}/complete`, completionBody, asStaff));
  assert.equal(withCosts.total_cost_cents, 2125);
  await permissions(['production']);
  const done = f.ok(await f.request(`/production-orders/${order.id}/complete`, completionBody, asStaff));
  assert.equal(done.completed_by_name, 'producer');
  assert.equal(done.items[0].standard_quantity, 13.5); assert.equal(done.items[0].variance_quantity, 2.5);
  for (const value of [done, f.ok(await f.request('/production-orders', undefined, asStaff)), f.ok(await f.request(`/production-orders/${order.id}`, undefined, asStaff))])
    assert.equal(/cost|inventory_value|price/.test(JSON.stringify(value)), false);
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '无权限' }, asStaff)).status, 403);
  await permissions(['production', 'corrections', 'purchase']);
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '权限内作废' }, asStaff));
  assert.equal(voided.status, 'void');
  await permissions(['production']);
  assert.equal((await f.command(`/production-orders/${order.id}/delete`, { version: voided.version }, asStaff)).status, 403);
  await permissions(['corrections']);
  assert.equal((await f.command(`/production-orders/${order.id}/delete`, { version: voided.version }, asStaff)).status, 403);
  await permissions(['production', 'corrections']);
  assert.deepEqual(f.ok(await f.command(`/production-orders/${order.id}/delete`, { version: voided.version }, asStaff)), { ok: true });
  await permissions([]);
  assert.deepEqual(f.ok(await f.request(`/products/${f.parent}/history`, undefined, asStaff)).records, []);
});

test('production retains zero-stock warehouse history and reset cannot make old editors valid for reused IDs', async t => {
  const f = await fixture(t), old = await f.create();
  const warehouseId = (await f.request('/warehouses', { name: '有生产历史的空仓' })).data.id;
  const product = await f.product('REMOTE-OUT', warehouseId), material = await f.product('REMOTE-IN', warehouseId, { specification: '规'.repeat(500) });
  const bom = f.ok(await f.command('/boms', f.definition({ product_id: product, items: [{ product_id: material, quantity: 1, unit: '件', note: '' }] }), { warehouseId }));
  const order = f.ok(await f.command('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 1, note: '' }, { warehouseId }));
  assert.equal(order.items[0].specification.length, 500);
  const deletion = await f.request(`/warehouses/${warehouseId}`, {}, { method: 'DELETE' });
  assert.equal(deletion.status, 400); assert.match(deletion.data.error, /生产单/);
  const removed = await f.request(`/products/${product}`, {}, { method: 'DELETE', warehouseId });
  assert.equal(removed.status, 400); assert.match(removed.data.error, /生产单/);
  const backup = f.ok(await f.request('/backup')); assert.equal((await f.request('/backup/preview', { backup })).status, 200);
  f.ok(await f.request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const newParent = await f.product('FINISHED'), newMaterial = await f.product('MATERIAL');
  const newBom = f.ok(await f.command('/boms', f.definition({ product_id: newParent, items: [{ product_id: newMaterial, quantity: 1, unit: '件', note: '' }] })));
  const fresh = await f.create({ bom_id: newBom.id, bom_version: newBom.version });
  assert.equal(fresh.id, old.id); assert.notEqual(fresh.version, old.version);
  assert.equal((await f.command(`/production-orders/${fresh.id}/void`, { version: old.version, reason: '过期页面' })).status, 409);
});

test('a material overflow on reversal rolls back the finished-good deduction and original audit state', async t => {
  const f = await fixture(t), done = await f.complete(await f.create());
  f.db.prepare('UPDATE products SET stock=99999999 WHERE id=?').run(f.second);
  const before = f.inventory();
  assert.equal((await f.command(`/production-orders/${done.id}/void`, { version: done.version, reason: '退料会溢出' })).status, 400);
  assert.deepEqual(f.inventory(), before);
  const current = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.equal(current.status, 'completed'); assert.equal(current.version, done.version); assert.equal(current.voided_at, null);
});

test('production stock alerts are transactional and idempotent, without purchase or sale notifications', async t => {
  const f = await fixture(t);
  const config = f.ok(await f.request('/settings/notifications'));
  f.ok(await f.request('/settings/notifications', { ...config, enabled: true, url: 'https://hooks.example.com/production',
    events: ['low_stock', 'out_of_stock', 'stock_recovered', 'purchase_in', 'sale_out'] }, { method: 'PUT' }));
  f.db.prepare('UPDATE products SET threshold=90 WHERE id=?').run(f.material);
  const order = await f.create();
  const body = { ...f.completion(order), request_id: randomUUID() }, path = `/production-orders/${order.id}/complete`;
  f.ok(await f.request(path, body)); f.ok(await f.request(path, body));
  const events = () => f.db.prepare('SELECT event,payload FROM notification_deliveries ORDER BY rowid').all();
  assert.deepEqual(events().map(row => row.event), ['low_stock']);
  const done = f.ok(await f.request(`/production-orders/${order.id}`));
  const voidBody = { request_id: randomUUID(), version: done.version, reason: '回退通知' }, voidPath = `/production-orders/${order.id}/void`;
  f.ok(await f.request(voidPath, voidBody)); f.ok(await f.request(voidPath, voidBody));
  assert.deepEqual(events().map(row => row.event), ['low_stock', 'stock_recovered']);
  assert.ok(events().every(row => JSON.parse(row.payload).data.production_id === order.id));
  const next = await f.create(), before = events();
  assert.equal((await f.command(`/production-orders/${next.id}/complete`, f.completion(next, {
    items: [{ product_id: f.material, quantity: 16 }, { product_id: f.second, quantity: 51 }],
  }))).status, 400);
  assert.deepEqual(events(), before);
});

test('production searches and endpoints isolate warehouses and reject invalid plans and pagination', async t => {
  const f = await fixture(t), order = await f.create();
  const warehouseId = (await f.request('/warehouses', { name: '生产分仓' })).data.id;
  assert.equal((await f.request('/production-orders', undefined, { warehouseId })).data.total, 0);
  assert.equal((await f.request(`/production-orders/${order.id}`, undefined, { warehouseId })).status, 404);
  assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(order), { warehouseId })).status, 404);
  assert.equal((await f.command('/production-orders', f.plan(), { warehouseId })).status, 404);
  for (const extra of [{ planned_quantity: 0 }, { planned_quantity: -1 }, { planned_quantity: 0.0000001 }, { planned_quantity: 100000000 }, { note: 'a'.repeat(501) }, { bom_id: 0 }, { bom_version: null }])
    assert.equal((await f.command('/production-orders', f.plan(extra))).status, 400);
  for (const query of ['?q=a&q=b', '?status=bad', '?offset=-1', '?offset=1.5', '?limit=101'])
    assert.equal((await f.request('/production-orders' + query)).status, 400);
  for (const q of ['FINISHED', '生产测试', order.number]) assert.equal(f.ok(await f.request('/production-orders?q=' + encodeURIComponent(q))).total, 1);
  assert.equal(f.ok(await f.request('/production-orders?status=completed')).total, 0);
  assert.equal((await f.request('/production-orders/NaN')).status, 400);
});

test('production backup validates quantities, state, cost conservation and relations, restores without replay and invalidates stale editors', async t => {
  const f = await fixture(t), draft = await f.create(), done = await f.complete(await f.create());
  const backup = f.ok(await f.request('/backup'));
  assert.equal(backup.version, 36); assert.equal(backup.data.production_orders.length, 2);
  const before = f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]);
  for (const tamper of [
    value => { value.production_items = []; },
    value => { value.production_items[0].product_id = f.parent; },
    value => { value.production_items[0].planned_quantity = 100; },
    value => { value.production_items[0].position = -1; },
    value => { value.production_orders[1].total_cost_cents++; },
    value => { value.production_orders[1].completed_at = null; },
    value => { value.production_orders[0].status = 'void'; },
    value => { value.production_orders[0].bom_id = 99999; },
    value => { value.production_orders[0].warehouse_id = 99999; },
  ]) {
    const invalid = structuredClone(backup); tamper(invalid.data);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const restore = async value => {
    const preview = f.ok(await f.request('/backup/preview', { backup: value }));
    f.ok(await f.command('/backup/restore', { backup: value, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  };
  const preview = f.ok(await f.request('/backup/preview', { backup })); assert.equal(preview.production_orders, 2);
  await f.command(`/production-orders/${draft.id}`, { version: draft.version, planned_quantity: 12, note: '' });
  assert.equal((await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 400);
  await restore(backup);
  assert.deepEqual(f.inventory().map(({ stock, inventory_value_cents }) => [stock, inventory_value_cents]), before);
  const restored = f.ok(await f.request(`/production-orders/${draft.id}`)); assert.notEqual(restored.version, draft.version);
  assert.equal((await f.command(`/production-orders/${draft.id}/complete`, f.completion(draft))).status, 409);
  const finished = f.ok(await f.request(`/production-orders/${done.id}`)); assert.equal(finished.total_cost_cents, 2125);
  f.ok(await f.command(`/production-orders/${done.id}/void`, { version: finished.version, reason: '恢复后正常作废' }));
  const old = structuredClone(backup); old.version = 23; delete old.data.production_orders; delete old.data.production_items;
  await restore(old); assert.equal(f.ok(await f.request('/production-orders')).total, 0);
  await restore(backup);
  f.ok(await f.request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_orders').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_items').get().n, 0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('BOM scrap rules reuse existing products with independent ratios, validate sources and preserve rules for older clients', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP'), otherScrap = await f.product('SCRAP-2');
  const rule = { product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 3, unit: '件', note: '工艺甲' };
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, scraps: [rule] })));
  const other = await f.product('OTHER-OUTPUT');
  const otherBom = f.ok(await f.command('/boms', f.definition({ product_id: other, scraps: [{ ...rule, quantity: 5 }] })));
  const preview = async value => f.ok(await f.command(`/boms/${value.id}/calculate`, { version: value.version, production_quantity: 10 }));
  assert.equal((await preview(bom)).scraps[0].planned_quantity, 0.45);
  assert.equal((await preview(otherBom)).scraps[0].planned_quantity, 0.75);
  const before = f.inventory();
  for (const scraps of [null, [rule, rule], [{ ...rule, product_id: f.parent }], [{ ...rule, product_id: f.material }],
    [{ ...rule, quantity: 0 }], [{ ...rule, quantity: 101 }], [{ ...rule, quantity: 0.0000001 }],
    [{ ...rule, source_product_id: other }], [{ ...rule, unit: 'kg' }], [{ ...rule, method: 'unknown' }],
    [{ ...rule, quantity: 60 }, { ...rule, product_id: otherScrap, quantity: 50 }],
    [{ ...rule, method: 'output', source_product_id: null, quantity_fraction: '1/3', quantity: 1 }],
  ]) {
    assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, scraps }))).status, 400);
    assert.equal((await f.request(`/boms/${bom.id}`)).data.version, bom.version);
    assert.deepEqual(f.inventory(), before);
  }
  const kept = f.ok(await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version })));
  assert.equal(kept.scraps[0].quantity, 3, 'omitted scraps retain rules on older client edits');
  assert.equal((await f.request(`/products/${scrap}`, {}, { method: 'DELETE' })).status, 400);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(scrap);
  assert.equal((await f.command(`/boms/${kept.id}/calculate`, { production_quantity: 10 })).status, 400);
  f.db.prepare('UPDATE products SET active=1,unit=? WHERE id=?').run('kg', scrap);
  assert.equal((await f.command(`/boms/${kept.id}/calculate`, { production_quantity: 10 })).status, 409);
});

test('production scraps snapshot rules, rescale fractions, calculate from actual inputs and output, and post zero-cost stock exactly once', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP'), dust = await f.product('DUST');
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, scraps: [
    { product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 3, unit: '件', note: '按净投入' },
    { product_id: dust, method: 'output', source_product_id: null, ...parseBomQuantity('1/3'), unit: '件', note: '按产出' },
  ] })));
  const before = f.inventory();
  const order = await f.create({ bom_version: bom.version });
  assert.deepEqual(order.scraps.map(row => row.planned_quantity), [0.45, 1.6667]);
  assert.deepEqual(f.inventory(), before);
  // The saved production rules survive subsequent removal from the BOM.
  f.ok(await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, scraps: [] })));
  const edited = f.ok(await f.command(`/production-orders/${order.id}`, { version: order.version, planned_quantity: 6, note: '' }));
  assert.deepEqual(edited.scraps.map(row => row.planned_quantity), [0.27, 1]);
  const body = { ...f.completion(edited, { completed_quantity: 3 }), request_id: randomUUID(),
    scraps: [{ product_id: scrap, quantity: 0.5, disposition: 'stock' }, { product_id: dust, quantity: 0.4, disposition: 'discard' }] };
  const path = `/production-orders/${order.id}/complete`, done = f.ok(await f.request(path, body));
  assert.deepEqual(done.scraps.map(row => row.expected_quantity), [0.48, 0.5]);
  assert.deepEqual(done.scraps.map(row => row.actual_quantity), [0.5, 0.4]);
  assert.equal(done.items[0].standard_quantity, 4.5); assert.equal(done.items[0].variance_quantity, 11.5, 'waste is not deducted from consumption again');
  assert.equal(done.total_cost_cents, 2125);
  assert.deepEqual({ ...f.db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(scrap) }, { stock: 0.5, inventory_value_cents: 0 });
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(dust).stock, 0);
  const after = f.inventory(); assert.deepEqual(f.ok(await f.request(path, body)), done); assert.deepEqual(f.inventory(), after);
  const history = f.ok(await f.request(`/products/${scrap}/history`)).records;
  assert.equal(history[0].event, 'production_scrap_in'); assert.equal(history[0].delta, 0.5); assert.equal(history[0].number, done.receipt_documents[0].number);
  assert.equal(f.ok(await f.request(`/products/${dust}/history`)).records.length, 0);
  const voidBody = { version: done.version, reason: '废料同步回退', request_id: randomUUID() }, voidPath = `/production-orders/${done.id}/void`;
  const voided = f.ok(await f.request(voidPath, voidBody));
  assert.equal(voided.scraps[0].actual_quantity, 0.5);
  assert.deepEqual(f.inventory().map(row => [row.stock, row.inventory_value_cents]), before.map(row => [row.stock, row.inventory_value_cents]));
  const reverted = f.inventory(); f.ok(await f.request(voidPath, voidBody)); assert.deepEqual(f.inventory(), reverted);
  assert.deepEqual(f.ok(await f.request(`/products/${scrap}/history`)).records.map(row => row.event).sort(), ['production_scrap_in', 'production_scrap_void_out']);
  f.ok(await f.command(`/production-orders/${order.id}/delete`, { version: voided.version }));
  assert.deepEqual(f.inventory(), reverted);
  for (const table of ['production_orders', 'production_items', 'production_scraps', 'production_batches', 'production_batch_items', 'production_batch_scraps'])
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.deepEqual(f.ok(await f.request(`/products/${scrap}/history`)).records, []);
});

test('invalid scrap completions, changed units, and insufficient scrap on void roll back the entire production transaction', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP');
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, scraps: [
    { product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 5, unit: '件', note: '' },
  ] })));
  const order = await f.create({ bom_version: bom.version }), before = f.inventory();
  const actual = { product_id: scrap, quantity: 1, disposition: 'stock' };
  for (const scraps of [undefined, [], null, [actual, actual], [{ ...actual, product_id: f.second }],
    [{ ...actual, quantity: -1 }], [{ ...actual, quantity: 0.0000001 }], [{ ...actual, disposition: 'unknown' }]]) {
    assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { scraps }))).status, 400);
    assert.deepEqual(f.inventory(), before);
    assert.equal(f.db.prepare('SELECT actual_quantity FROM production_items LIMIT 1').get().actual_quantity, null);
    assert.equal(f.db.prepare('SELECT expected_quantity FROM production_scraps LIMIT 1').get().expected_quantity, null);
  }
  for (const [field, value, status] of [['active', 0, 400], ['unit', 'kg', 409]]) {
    f.db.prepare(`UPDATE products SET ${field}=? WHERE id=?`).run(value, scrap);
    assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { scraps: [actual] }))).status, status);
    f.db.prepare('UPDATE products SET active=1,unit=? WHERE id=?').run('件', scrap);
  }
  // Scrap stock caps apply at warehouse receipt approval, covered with atomic
  // finished-stock rollback in production-receipts.test.js.
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { scraps: [actual] })));
  moveInventory(f.db, scrap, -0.5, 0);
  const consumed = f.inventory();
  assert.equal((await f.command(`/production-orders/${done.id}/void`, { version: done.version, reason: '废料已使用' })).status, 400);
  assert.deepEqual(f.inventory(), consumed);
  assert.equal((await f.request(`/production-orders/${done.id}`)).data.status, 'completed');
  moveInventory(f.db, scrap, 0.5, 0);
  f.ok(await f.command(`/production-orders/${done.id}/void`, { version: done.version, reason: '补回后作废' }));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(scrap).stock, 0);
});

test('scrap backup validates rule relations and completion state, restores quantities without replay, and accepts format 25', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP');
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, scraps: [
    { product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 5, unit: '件', note: '' },
  ] })));
  const draft = await f.create({ bom_version: bom.version }), order = await f.create({ bom_version: bom.version });
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { scraps: [{ product_id: scrap, quantity: 0.8, disposition: 'stock' }] })));
  const backup = f.ok(await f.request('/backup')), before = f.inventory().map(row => [row.stock, row.inventory_value_cents]);
  assert.equal(backup.version, 36);
  for (const tamper of [
    data => { data.bom_scraps[0].bom_id = 99999; }, data => { data.bom_scraps[0].source_product_id = f.second; data.bom_scraps[0].unit = 'kg'; },
    data => { data.bom_scraps[0].quantity = 101; }, data => { data.production_scraps[0].production_id = 99999; },
    data => { data.production_scraps[0].actual_quantity = 1; }, data => { data.production_scraps[1].expected_quantity = 999; },
    data => { data.production_scraps[1].disposition = 'unknown'; }, data => { data.production_scraps[1].planned_quantity = 100; },
  ]) {
    const invalid = structuredClone(backup); tamper(invalid.data);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const restore = async value => {
    const preview = f.ok(await f.request('/backup/preview', { backup: value }));
    f.ok(await f.command('/backup/restore', { backup: value, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  };
  await restore(backup);
  assert.deepEqual(f.inventory().map(row => [row.stock, row.inventory_value_cents]), before);
  assert.notEqual((await f.request(`/production-orders/${draft.id}`)).data.version, draft.version);
  const restored = f.ok(await f.request(`/production-orders/${done.id}`));
  f.ok(await f.command(`/production-orders/${done.id}/void`, { version: restored.version, reason: '恢复后废料回退' }));
  const old = structuredClone(backup); old.version = 25; delete old.data.bom_scraps; delete old.data.production_scraps;
  await restore(old);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bom_scraps').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_scraps').get().n, 0);
  await restore(backup);
  f.ok(await f.request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_scraps').get().n, 0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('scrap rows remain warehouse-scoped and production-only permissions cannot reveal costs or bypass correction permissions', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP');
  const rule = { product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 5, unit: '件', note: '' };
  const remote = (await f.request('/warehouses', { name: '废料分仓' })).data.id;
  const remoteScrap = await f.product('REMOTE-SCRAP', remote);
  assert.equal((await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, scraps: [{ ...rule, product_id: remoteScrap }] }))).status, 400);
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, scraps: [rule] })));
  const order = await f.create({ bom_version: bom.version });
  const user = (await f.request('/users', { username: 'scrapworker', password: 'Test-staff-123' })).data;
  const cookie = (await f.request('/auth/login', { username: 'scrapworker', password: 'Test-staff-123' }, { cookie: null })).cookie;
  f.ok(await f.request(`/users/${user.id}/permissions`, { permissions: ['production'], version: 1 }, { method: 'PUT' }));
  const body = f.completion(order, { items: [{ product_id: f.material, quantity: 0 }, { product_id: f.second, quantity: 1 }],
    scraps: [{ product_id: scrap, quantity: 0, disposition: 'stock' }] });
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, body, { cookie }));
  assert.equal(done.scraps[0].expected_quantity, 0); assert.equal(done.scraps[0].actual_quantity, 0);
  assert.ok(!/cost|price|inventory_value/.test(JSON.stringify(done)));
  assert.equal((await f.request(`/production-orders/${order.id}`, undefined, { warehouseId: remote })).status, 404);
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '无纠正权限' }, { cookie })).status, 403);
  assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, scraps: [] }), { cookie })).status, 403);
  assert.equal((await f.request(`/products/${scrap}`, {}, { method: 'DELETE' })).status, 400);
});


test('material analysis uses actual good output and saved recipes, preserves signed four-decimal quantities and original inventory costs', async t => {
  const f = await fixture(t), order = await f.create(), before = f.inventory();
  f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version,
    items: [{ product_id: f.material, quantity: 99, unit: '件', note: '' }] })));
  const body = { request_id: randomUUID(), version: order.version, completed_quantity: 8,
    items: [{ product_id: f.material, quantity: 13, variance_reason: '  调机耗料  ', standard_quantity: 999, variance_quantity: 0 },
      { product_id: f.second, quantity: 0.6, variance_reason: '调整工艺节省' }] };
  const path = `/production-orders/${order.id}/complete`, done = f.ok(await f.request(path, body));
  assert.deepEqual(done.items.map(item => item.planned_quantity), [15, 1]);
  assert.deepEqual(done.items.map(item => item.standard_quantity), [12, 0.8]);
  assert.deepEqual(done.items.map(item => item.variance_quantity), [1, -0.2]);
  assert.ok(Math.abs(done.items[0].variance_rate - 100 / 12) < 1e-10);
  assert.equal(done.items[1].variance_rate, -25);
  assert.deepEqual(done.items.map(item => item.variance_reason), ['调机耗料', '调整工艺节省']);
  assert.ok(done.items.every(item => item.analysis_error === ''));
  assert.equal(done.total_cost_cents, done.items.reduce((sum, item) => sum + item.cost_cents, 0));
  const stock = f.inventory();
  assert.deepEqual(f.ok(await f.request(path, body)), done); assert.deepEqual(f.inventory(), stock);
  const loaded = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.equal(loaded.items[0].standard_quantity, 12); assert.equal(loaded.items[0].variance_reason, '调机耗料');
  const voided = f.ok(await f.command(`/production-orders/${done.id}/void`, { version: done.version, reason: '保留分析供追溯' }));
  assert.equal(voided.items[0].variance_quantity, 1); assert.equal(voided.items[0].variance_reason, '调机耗料');
  assert.deepEqual(f.inventory().map(row => [row.stock, row.inventory_value_cents]), before.map(row => [row.stock, row.inventory_value_cents]));
  const fractional = productionMaterialAnalysis({ base_quantity: 0.3334, base_quantity_fraction: '1/3' }, 3, 1, 0.9999);
  assert.equal(fractional.standard_quantity, 1); assert.equal(fractional.variance_quantity, -0.0001); assert.equal(fractional.variance_rate, -0.01);
  const unused = productionMaterialAnalysis({ base_quantity: 1 }, 2, 1, 0);
  assert.equal(unused.variance_quantity, -2); assert.equal(unused.variance_rate, -100);
  const exact = productionMaterialAnalysis({ base_quantity: 1 }, 2, 1, 2);
  assert.equal(exact.variance_quantity, 0); assert.equal(exact.variance_rate, 0);
});

test('invalid variance reasons roll back completion and absent reasons remain compatible with old clients', async t => {
  const f = await fixture(t), order = await f.create(), before = f.inventory();
  for (const variance_reason of [null, 123, {}, '字'.repeat(501)]) {
    const result = await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { items: [
      { product_id: f.material, quantity: 16, variance_reason: '第一行也须回滚' }, { product_id: f.second, quantity: 1.5, variance_reason },
    ] }));
    assert.equal(result.status, 400); assert.match(result.data.error, /差异原因/);
    assert.deepEqual(f.inventory(), before);
    assert.ok(f.db.prepare('SELECT * FROM production_items').all().every(item => item.variance_reason === '' && item.actual_quantity === null));
  }
  const done = await f.complete(order);
  assert.ok(done.items.every(item => item.variance_reason === ''));
  assert.deepEqual(done.items.map(item => item.standard_quantity), [13.5, 0.9]);
});

test('analysis overflow never blocks valid completion or historic reads and does not change actual inventory accounting', async t => {
  const f = await fixture(t);
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, base_quantity: 1,
    items: [{ product_id: f.material, quantity: 99999999, unit: '件', note: '' }] })));
  const order = await f.create({ bom_version: bom.version, planned_quantity: 0.0001 });
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, { version: order.version, completed_quantity: 2,
    items: [{ product_id: f.material, quantity: 1, variance_reason: '实际按核实数量登记' }] }));
  assert.equal(done.status, 'completed'); assert.equal(done.items[0].standard_quantity, null);
  assert.equal(done.items[0].variance_quantity, null); assert.equal(done.items[0].variance_rate, null);
  assert.match(done.items[0].analysis_error, /上限/);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.material).stock, 99);
  assert.equal((await f.request(`/production-orders/${order.id}`)).status, 200);
});

test('variance reasons survive backup and void, reject malformed drafts, and format 26 restores empty reasons', async t => {
  const f = await fixture(t), draft = await f.create(), order = await f.create();
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { items: [
    { product_id: f.material, quantity: 16, variance_reason: '调机\n材料偏差' }, { product_id: f.second, quantity: 1.5, variance_reason: '字'.repeat(500) },
  ] })));
  const backup = f.ok(await f.request('/backup')); assert.equal(backup.version, 36);
  assert.ok(backup.data.production_items.every(item => !('standard_quantity' in item)));
  for (const change of [
    data => { data.production_items[0].variance_reason = '草稿不得提前记完工原因'; },
    data => { data.production_items[2].variance_reason = null; },
    data => { data.production_items[2].variance_reason = '字'.repeat(501); },
  ]) {
    const invalid = structuredClone(backup); change(invalid.data);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const restore = async value => {
    const preview = f.ok(await f.request('/backup/preview', { backup: value }));
    f.ok(await f.command('/backup/restore', { backup: value, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  };
  const before = f.inventory().map(row => [row.stock, row.inventory_value_cents]);
  await restore(backup);
  const loaded = f.ok(await f.request(`/production-orders/${done.id}`));
  assert.equal(loaded.items[0].variance_reason, '调机\n材料偏差'); assert.equal(loaded.items[0].standard_quantity, 13.5);
  assert.deepEqual(f.inventory().map(row => [row.stock, row.inventory_value_cents]), before);
  assert.equal((await f.request(`/production-orders/${draft.id}`)).data.items[0].standard_quantity, null);
  const voided = f.ok(await f.command(`/production-orders/${done.id}/void`, { version: loaded.version, reason: '恢复后回退' }));
  assert.equal(voided.items[0].variance_reason, '调机\n材料偏差');
  const legacy = structuredClone(backup); legacy.version = 26;
  for (const item of legacy.data.production_items) delete item.variance_reason;
  await restore(legacy);
  assert.ok((await f.request(`/production-orders/${done.id}`)).data.items.every(item => item.variance_reason === ''));
  // Simulate an existing database before the new column was introduced.
  f.db.exec('DROP TRIGGER data_revision_production_items_UPDATE; ALTER TABLE production_items DROP COLUMN variance_reason;');
  migrateProduction(f.db);
  assert.ok(f.db.prepare('SELECT variance_reason FROM production_items').all().every(item => item.variance_reason === ''));
});

test('partial completions post after warehouse approval, retain snapshots and compare cumulative output without replacing earlier batches', async t => {
  const f = await fixture(t), order = await f.create();
  const first = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, {
    finish_order: false, completed_quantity: 4, note: '首批', items: [
      { product_id: f.material, quantity: 7, variance_reason: '首批调机' }, { product_id: f.second, quantity: 0.4 },
    ],
  })));
  assert.equal(first.status, 'in_progress'); assert.equal(first.completed_quantity, 4); assert.equal(first.batch_count, 1);
  assert.equal(first.items[0].standard_quantity, 6); assert.equal(first.items[0].actual_quantity, 7);
  assert.equal(f.inventory()[0].stock, 4); assert.equal(f.inventory()[1].stock, 93);
  assert.equal(f.ok(await f.request('/production-orders?status=in_progress')).total, 1);
  assert.equal(f.ok(await f.request('/production-orders?status=draft')).total, 0);
  assert.equal((await f.command(`/production-orders/${order.id}`, { version: first.version, planned_quantity: 20, note: '' })).status, 409);
  f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, items: [{ product_id: f.material, quantity: 99, unit: '件', note: '' }] })));
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(first, {
    completed_quantity: 6, items: [{ product_id: f.material, quantity: 9 }, { product_id: f.second, quantity: 0.6 }],
  })));
  assert.equal(done.status, 'completed'); assert.equal(done.completed_quantity, 10); assert.equal(done.batch_count, 2);
  assert.equal(done.items[0].actual_quantity, 16); assert.equal(done.items[0].standard_quantity, 15); assert.equal(done.items[0].variance_quantity, 1);
  assert.deepEqual(done.items[0].variance_reasons, [{ batch_number: 1, reason: '首批调机' }]);
  assert.deepEqual(done.batches.map(batch => [batch.batch_number, batch.completed_quantity]), [[1, 4], [2, 6]]);
  assert.deepEqual(done.batches.map(batch => batch.items[0].variance_quantity), [1, 0]);
  assert.equal(done.total_cost_cents, done.batches.reduce((sum, batch) => sum + batch.total_cost_cents, 0));
  const history = f.ok(await f.request(`/products/${f.material}/history`)).records;
  assert.deepEqual(history.map(row => row.delta).sort((a, b) => a - b), [-9, -7]);
  assert.ok(history.every(row => /第 [12] 批/.test(row.note)));
  assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(done))).status, 409);
});

test('voiding any batch reopens a closed order, preserves numbering and retries, and whole-order void reverses only remaining batches', async t => {
  const f = await fixture(t), before = f.inventory().map(row => [row.stock, row.inventory_value_cents]), order = await f.create();
  const first = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { finish_order: false, completed_quantity: 4 })));
  const second = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(first, { completed_quantity: 6 })));
  const body = { version: second.version, reason: '首批误报', request_id: randomUUID() }, path = `/production-orders/${order.id}/batches/${first.batches[0].id}/void`;
  const corrected = f.ok(await f.request(path, body)), afterCorrection = f.inventory();
  assert.equal(corrected.status, 'in_progress'); assert.equal(corrected.completed_quantity, 6); assert.equal(corrected.batch_count, 1);
  assert.equal(corrected.items[0].actual_quantity, 16); assert.deepEqual(corrected.batches.map(batch => batch.status), ['void', 'active']);
  assert.deepEqual(f.ok(await f.request(path, body)), corrected); assert.deepEqual(f.inventory(), afterCorrection);
  assert.equal((await f.command(path, { version: corrected.version, reason: '不能再次作废' })).status, 409);
  assert.equal((await f.command(`/production-orders/${order.id}/finish`, { version: second.version })).status, 409);
  const replenished = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(corrected, { finish_order: false, completed_quantity: 4 })));
  assert.deepEqual(replenished.batches.map(batch => batch.batch_number), [1, 2, 3]);
  assert.equal(replenished.completed_quantity, 10);
  const inventory = f.inventory();
  const finished = f.ok(await f.command(`/production-orders/${order.id}/finish`, { version: replenished.version }));
  assert.equal(finished.status, 'completed'); assert.deepEqual(f.inventory(), inventory, 'finish posts no stock twice');
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: finished.version, reason: '整单取消' }));
  assert.equal(voided.status, 'void'); assert.equal(voided.completed_quantity, 10);
  assert.deepEqual(voided.batches.map(batch => batch.voided_with_order), [0, 1, 1]);
  assert.deepEqual(f.inventory().map(row => [row.stock, row.inventory_value_cents]), before);
  assert.equal((await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) })).status, 200);
});

test('cumulative standards round once while batch scrap expectations and mixed dispositions retain posted quantities', async t => {
  const f = await fixture(t), scrap = await f.product('BATCH-SCRAP'), fractionalScrap = await f.product('FRACTION-SCRAP');
  const bom = f.ok(await f.command(`/boms/${f.bom.id}`, f.definition({ version: f.bom.version, base_quantity: 1,
    items: [{ product_id: f.material, ...parseBomQuantity('1/3'), unit: '件', note: '' }], scraps: [
      { product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 6, unit: '件', note: '' },
      { product_id: fractionalScrap, method: 'output', source_product_id: null, ...parseBomQuantity('1/3'), unit: '件', note: '' },
    ] })));
  let order = await f.create({ bom_version: bom.version, planned_quantity: 3 });
  for (let i = 0; i < 3; i++) order = f.ok(await f.command(`/production-orders/${order.id}/complete`, {
    version: order.version, finish_order: i === 2, completed_quantity: 1, items: [{ product_id: f.material, quantity: 0.3333 }],
    scraps: [{ product_id: scrap, quantity: 0.02, disposition: i ? 'discard' : 'stock' }, { product_id: fractionalScrap, quantity: 0, disposition: 'discard' }],
  }));
  assert.equal(order.items[0].actual_quantity, 0.9999); assert.equal(order.items[0].standard_quantity, 1); assert.equal(order.items[0].variance_quantity, -0.0001);
  assert.equal(order.batches[0].items[0].standard_quantity, 0.3334);
  assert.equal(order.scraps[0].actual_quantity, 0.06); assert.equal(order.scraps[0].stock_quantity, 0.02); assert.equal(order.scraps[0].discard_quantity, 0.04);
  assert.equal(order.scraps[0].disposition, 'mixed'); assert.equal(order.scraps[1].expected_quantity, 1.0002);
  const backup = f.ok(await f.request('/backup')), preview = f.ok(await f.request('/backup/preview', { backup }));
  assert.equal(preview.production_batches, 3);
  const before = f.inventory().map(row => [row.stock, row.inventory_value_cents]);
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.deepEqual(f.inventory().map(row => [row.stock, row.inventory_value_cents]), before);
  assert.equal(f.ok(await f.request(`/production-orders/${order.id}`)).scraps[0].disposition, 'mixed');
});

test('failed or concurrent batches roll back all rows, inventory and totals, and all-void orders can record a replacement', async t => {
  const f = await fixture(t), order = await f.create();
  assert.equal((await f.command(`/production-orders/${order.id}/finish`, { version: order.version })).status, 400);
  const first = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { finish_order: false, completed_quantity: 4 })));
  const before = f.inventory(), rows = f.db.prepare('SELECT * FROM production_batches').all();
  for (const extra of [
    { items: [{ product_id: f.material, quantity: 1 }, { product_id: f.second, quantity: 51 }] },
    { finish_order: 'false' }, { note: '字'.repeat(501) }, { items: [{ product_id: f.material, quantity: 0 }, { product_id: f.second, quantity: 0 }] },
  ]) {
    assert.equal((await f.command(`/production-orders/${order.id}/complete`, f.completion(first, extra))).status, 400);
    assert.deepEqual(f.inventory(), before); assert.deepEqual(f.db.prepare('SELECT * FROM production_batches').all(), rows);
    assert.equal(f.ok(await f.request(`/production-orders/${order.id}`)).version, first.version);
  }
  const result = await Promise.all([1, 2].map(() => f.command(`/production-orders/${order.id}/complete`, f.completion(first, { finish_order: false, completed_quantity: 2 }))));
  assert.deepEqual(result.map(row => row.status).sort(), [200, 409]);
  let loaded = f.ok(await f.request(`/production-orders/${order.id}`));
  for (const batch of loaded.batches) loaded = f.ok(await f.command(`/production-orders/${order.id}/batches/${batch.id}/void`, { version: loaded.version, reason: '全部重报' }));
  assert.equal(loaded.status, 'draft'); assert.equal(loaded.completed_quantity, null); assert.equal(loaded.items[0].actual_quantity, null);
  assert.equal((await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) })).status, 200);
  const next = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(loaded)));
  assert.equal(next.batches.at(-1).batch_number, 3); assert.equal(next.completed_quantity, 9);
});

test('batch backup validates child relations, aggregate facts and void state; legacy v28 orders remain reversible without invented batches', async t => {
  const f = await fixture(t), order = await f.create();
  const done = await f.complete(order), backup = f.ok(await f.request('/backup'));
  for (const change of [
    data => { data.production_batch_items = []; },
    data => { data.production_batches = []; data.production_batch_items = []; data.production_batch_scraps = []; },
    data => { data.production_batch_items[0].batch_id = 9999; },
    data => { data.production_batch_items[0].product_id = f.parent; },
    data => { data.production_batch_items[0].cost_cents++; },
    data => { data.production_batches[0].completed_quantity++; },
    data => { data.production_batches[0].voided_with_order = 1; },
    data => { data.production_batches[0].status = 'void'; },
    data => { data.production_batches[0].batch_number = 0; },
    data => { data.production_orders[0].completed_quantity++; },
    data => { data.production_batches.push({ ...data.production_batches[0], id: 999 }); },
  ]) {
    const invalid = structuredClone(backup); change(invalid.data);
    assert.equal((await f.request('/backup/preview', { backup: invalid })).status, 400);
  }
  const legacy = structuredClone(backup); legacy.version = 28;
  for (const key of ['production_batches', 'production_batch_items', 'production_batch_scraps']) delete legacy.data[key];
  const preview = f.ok(await f.request('/backup/preview', { backup: legacy }));
  f.ok(await f.command('/backup/restore', { backup: legacy, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  const loaded = f.ok(await f.request(`/production-orders/${order.id}`));
  assert.deepEqual(loaded.batches, []); assert.equal(loaded.completed_quantity, done.completed_quantity);
  assert.equal(f.ok(await f.request(`/products/${f.parent}/history`)).records.length, 1);
  const beforeUpgrade = f.inventory();
  f.db.exec('DROP TABLE production_batch_scraps; DROP TABLE production_batch_items; DROP TABLE production_batches; DROP TRIGGER data_revision_production_orders_UPDATE; ALTER TABLE production_orders DROP COLUMN batch_tracking;');
  migrateProduction(f.db);
  assert.deepEqual(f.inventory(), beforeUpgrade); assert.equal(f.ok(await f.request(`/production-orders/${order.id}`)).batch_tracking, 0);
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: loaded.version, reason: '历史单回退' }));
  assert.equal(f.inventory()[0].stock, 0); assert.equal(f.inventory()[1].stock, 100);
  const reversed = f.inventory();
  f.ok(await f.command(`/production-orders/${order.id}/delete`, { version: voided.version }));
  assert.deepEqual(f.inventory(), reversed);
  assert.equal((await f.request(`/production-orders/${order.id}`)).status, 404);
});

test('batch corrections require correction permission and nested costs stay hidden after finance permission is removed', async t => {
  const f = await fixture(t), order = await f.create();
  const user = (await f.request('/users', { username: 'batchworker', password: 'Test-staff-123' })).data.id;
  const cookie = (await f.request('/auth/login', { username: 'batchworker', password: 'Test-staff-123' }, { cookie: null })).cookie;
  const permissions = async values => {
    const version = f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(user).permissions_version;
    assert.equal((await f.request(`/users/${user}/permissions`, { version, permissions: values }, { method: 'PUT' })).status, 200);
  };
  await permissions(['production', 'finance']);
  const body = { ...f.completion(order, { finish_order: false }), request_id: randomUUID() };
  const posted = f.ok(await f.request(`/production-orders/${order.id}/complete`, body, { cookie }));
  assert.ok(posted.batches[0].total_cost_cents > 0);
  await permissions(['production']);
  for (const value of [f.ok(await f.request(`/production-orders/${order.id}/complete`, body, { cookie })),
    f.ok(await f.request(`/production-orders/${order.id}`, undefined, { cookie }))])
    assert.equal(/cost|inventory_value|price/.test(JSON.stringify(value)), false);
  const batchPath = `/production-orders/${order.id}/batches/${posted.batches[0].id}/void`;
  assert.equal((await f.command(batchPath, { version: posted.version, reason: '未授权' }, { cookie })).status, 403);
  const unrelated = await f.create();
  assert.equal((await f.command(`/production-orders/${unrelated.id}/batches/${posted.batches[0].id}/void`, { version: unrelated.version, reason: '串单' })).status, 404);
  const remote = (await f.request('/warehouses', { name: '批次隔离仓' })).data.id;
  assert.equal((await f.command(batchPath, { version: posted.version, reason: '跨仓' }, { warehouseId: remote })).status, 404);
  const finished = f.ok(await f.command(`/production-orders/${order.id}/finish`, { version: posted.version }, { cookie }));
  await permissions(['production', 'corrections', 'purchase']);
  const reversed = f.ok(await f.command(batchPath, { version: finished.version, reason: '有权限纠正' }, { cookie }));
  assert.equal(reversed.status, 'draft'); assert.equal(reversed.completed_quantity, null);
});

test('cumulative material and output caps roll back a new batch even when current stock permits it', async t => {
  for (const overflowMaterial of [true, false]) {
    const f = await fixture(t), order = await f.create();
    if (overflowMaterial) f.db.prepare('UPDATE products SET stock=99999999 WHERE id=?').run(f.material);
    const first = f.ok(await f.command(`/production-orders/${order.id}/complete`, { version: order.version, finish_order: false,
      completed_quantity: overflowMaterial ? 1 : 99999999,
      items: [{ product_id: f.material, quantity: overflowMaterial ? 99999999 : 1 }, { product_id: f.second, quantity: 0 }] }));
    if (overflowMaterial) f.db.prepare('UPDATE products SET stock=1,inventory_value_cents=1 WHERE id=?').run(f.material);
    else f.db.prepare('UPDATE products SET stock=0,inventory_value_cents=0 WHERE id=?').run(f.parent);
    const before = f.inventory();
    const invalid = await f.command(`/production-orders/${order.id}/complete`, { version: first.version, finish_order: false,
      completed_quantity: 1, items: [{ product_id: f.material, quantity: 1 }, { product_id: f.second, quantity: 0 }] });
    assert.equal(invalid.status, 400); assert.match(invalid.data.error, /累计数量/);
    assert.deepEqual(f.inventory(), before); assert.equal(f.ok(await f.request(`/production-orders/${order.id}`)).batches.length, 1);
  }
});

test('whole-order reversal is atomic across batches when an earlier batch cannot be reversed', async t => {
  const f = await fixture(t), order = await f.create();
  const first = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(order, { finish_order: false, completed_quantity: 4 })));
  const done = f.ok(await f.command(`/production-orders/${order.id}/complete`, f.completion(first, { completed_quantity: 6 })));
  f.db.prepare('UPDATE products SET stock=6 WHERE id=?').run(f.parent);
  const before = f.inventory();
  assert.equal((await f.command(`/production-orders/${order.id}/void`, { version: done.version, reason: '后续领用' })).status, 400);
  assert.deepEqual(f.inventory(), before);
  assert.ok(f.ok(await f.request(`/production-orders/${order.id}`)).batches.every(batch => batch.status === 'active'));
});

test('multilevel production freezes selected recipes, handles stale previews, batches and restores without intermediate inventory', async t => {
  const f = await fixture(t);
  const child = f.ok(await f.command('/boms', f.definition({ product_id: f.material, name: '半成品配方', base_quantity: 1,
    items: [{ product_id: f.second, quantity: 3, unit: '件', note: '' }] })));
  const root = f.ok(await f.command('/boms', f.definition({ name: '多层配方', base_quantity: 1,
    items: [{ product_id: f.material, ...parseBomQuantity('1/3'), usage_mode: 'explode', child_bom_id: child.id, unit: '件', note: '' }] })));
  const prepare = () => f.request('/production-orders/prepare', f.plan({ bom_id: root.id, bom_version: root.version, planned_quantity: 3, schema_version: 2 }));
  const plan = f.ok(await prepare()), before = f.inventory();
  const body = { ...f.plan({ bom_id: root.id, bom_version: root.version, planned_quantity: 3 }), schema_version: 2, structure_token: plan.structure_token };
  const changedChild = f.ok(await f.command(`/boms/${child.id}`, { ...child, version: child.version, items: [{ ...child.items[0], quantity: 6 }] }));
  assert.equal((await f.command('/production-orders', body)).status, 409, 'child changed without a root version change');
  body.structure_token = f.ok(await prepare()).structure_token;
  const request = { ...body, request_id: randomUUID() };
  let order = f.ok(await f.request('/production-orders', request));
  assert.equal(order.snapshot_format, 2); assert.equal(order.nodes.length, 2);
  assert.equal(order.items[0].planned_quantity, 6); assert.equal(order.items[0].base_quantity, null);
  f.ok(await f.command(`/boms/${child.id}`, { ...changedChild, version: changedChild.version, items: [{ ...changedChild.items[0], quantity: 9 }] }));
  assert.equal(f.ok(await f.request('/production-orders', request)).id, order.id, 'retry returns original success after recipe changed');
  order = f.ok(await f.command(`/production-orders/${order.id}`, { version: order.version, planned_quantity: 6, note: '', schema_version: 2 }));
  assert.equal(order.items[0].planned_quantity, 12, 'rescaling uses frozen child quantity 6');
  assert.equal((await f.command(`/production-orders/${order.id}/complete`, { version: order.version, completed_quantity: 1, items: [{ product_id: f.second, quantity: 2 }] })).status, 409);
  order = f.ok(await f.command(`/production-orders/${order.id}/complete`, { version: order.version, schema_version: 2, completed_quantity: 1, finish_order: false, items: [{ product_id: f.second, quantity: 2 }] }));
  assert.equal(order.items[0].standard_quantity, 2); assert.equal(order.items[0].variance_quantity, 0);
  order = f.ok(await f.command(`/production-orders/${order.id}/complete`, { version: order.version, schema_version: 2, completed_quantity: 2, finish_order: true, items: [{ product_id: f.second, quantity: 4 }] }));
  assert.equal(order.items[0].standard_quantity, 6); assert.equal(order.total_cost_cents, 600);
  assert.deepEqual(f.inventory().find(row => row.id === f.material), before.find(row => row.id === f.material), 'intermediate stock/value/version untouched');
  const backup = f.ok(await f.request('/backup'));
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  order = f.ok(await f.request(`/production-orders/${order.id}`));
  assert.equal(order.nodes[1].quantity, 6); assert.equal(order.items[0].standard_quantity, 6);
  for (const mutate of [
    data => { data.production_bom_nodes[0].child_bom_id = 99999; },
    data => { data.production_bom_nodes[1].quantity = 7; },
    data => { data.production_items.find(row => row.production_id === order.id).unit = '错误单位'; },
    data => { data.production_bom_nodes.pop(); },
    data => { data.production_items.find(row => row.production_id === order.id).base_quantity = 1; },
  ]) {
    const broken = structuredClone(backup); mutate(broken.data);
    assert.equal((await f.request('/backup/preview', { backup: broken })).status, 400);
  }
  order = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: order.version, schema_version: 2, reason: '回退验证' }));
  assert.equal(order.status, 'void');
  assert.deepEqual(f.inventory().map(({ id,stock,inventory_value_cents }) => [id,stock,inventory_value_cents]), before.map(({ id,stock,inventory_value_cents }) => [id,stock,inventory_value_cents]));
  const reversed = f.inventory();
  assert.equal((await f.command(`/production-orders/${order.id}/delete`, { version: order.version })).status, 409);
  f.ok(await f.command(`/production-orders/${order.id}/delete`, { version: order.version, schema_version: 2 }));
  for (const table of ['production_orders', 'production_items', 'production_scraps', 'production_bom_nodes', 'production_batches', 'production_batch_items', 'production_batch_scraps'])
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.deepEqual(f.inventory(), reversed);
  const currentRoot = f.ok(await f.request(`/boms/${root.id}`));
  f.ok(await f.command(`/boms/${root.id}/delete`, { version: currentRoot.version }));
  const currentChild = f.ok(await f.request(`/boms/${child.id}`));
  f.ok(await f.command(`/boms/${child.id}/delete`, { version: currentChild.version }));
});

test('reopening legacy unique-product and non-null material tables preserves IDs, foreign keys, versions and history', async t => {
  const { rebuildTable } = await import('../server/table-migration.js');
  const f = await fixture(t), order = await f.create(), before = f.inventory();
  rebuildTable(f.db, 'boms', sql => sql.replace(/\)\s*$/, ', UNIQUE(warehouse_id,product_id))'));
  rebuildTable(f.db, 'production_items', sql => sql.replace(/\b(base_quantity|base_quantity_fraction|loss_rate) (REAL|TEXT)(?! NOT NULL)/g, '$1 $2 NOT NULL'));
  migrateBom(f.db); migrateProduction(f.db); migrateBom(f.db); migrateProduction(f.db);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(f.ok(await f.request(`/production-orders/${order.id}`)).bom_id, f.bom.id);
  assert.equal(f.ok(await f.request(`/boms/${f.bom.id}`)).version, f.bom.version);
  const second = f.ok(await f.command('/boms', f.definition({ name: '迁移后第二配方' })));
  assert.notEqual(second.id, f.bom.id);
  assert.deepEqual(f.inventory(), before);
  const edited = f.ok(await f.command(`/production-orders/${order.id}`, { version: order.version, planned_quantity: 2, note: '迁移后编辑' }));
  assert.notEqual(edited.version, order.version);
});

test('multilevel orders retain supported root waste rules and do not infer allocations across repeated material paths', async t => {
  const f = await fixture(t), direct = await f.product('DIRECT'), wasteOut = await f.product('WASTE-OUT'), wasteIn = await f.product('WASTE-IN');
  f.db.prepare('UPDATE products SET stock=20,inventory_value_cents=2000 WHERE id=?').run(direct);
  const child = f.ok(await f.command('/boms', f.definition({ product_id: f.material, name: '无废料子配方', base_quantity: 1,
    items: [{ product_id: f.second, quantity: 1, unit: '件', note: '' }] })));
  const root = f.ok(await f.command('/boms', f.definition({ name: '根废料多层配方', base_quantity: 1,
    items: [{ product_id: f.material, quantity: 2, usage_mode: 'explode', child_bom_id: child.id, unit: '件', note: '' },
      { product_id: direct, quantity: 3, unit: '件', note: '' }],
    scraps: [{ product_id: wasteOut, method: 'output', source_product_id: null, ...parseBomQuantity('1/2'), unit: '件', note: '' },
      { product_id: wasteIn, method: 'input_ratio', source_product_id: direct, quantity: 10, unit: '件', note: '' }] })));
  const body = f.plan({ bom_id: root.id, bom_version: root.version, planned_quantity: 2, schema_version: 2 });
  const plan = f.ok(await f.request('/production-orders/prepare', body));
  assert.deepEqual(plan.scraps.map(row => row.planned_quantity), [1, 0.6]);
  let order = f.ok(await f.command('/production-orders', { ...body, structure_token: plan.structure_token }));
  f.ok(await f.command(`/boms/${child.id}`, { ...child, version: child.version,
    items: [...child.items, { product_id: direct, quantity: 1, unit: '件', note: '' }] }));
  const invalidLivePlan = await f.request('/production-orders/prepare', body);
  assert.equal(invalidLivePlan.status, 400); assert.match(invalidLivePlan.data.error, /不能同时出现在其他展开路径/);
  order = f.ok(await f.command(`/production-orders/${order.id}/complete`, { version: order.version, schema_version: 2, completed_quantity: 1,
    items: [{ product_id: f.second, quantity: 2 }, { product_id: direct, quantity: 4 }],
    scraps: [{ product_id: wasteOut, quantity: 0.5, disposition: 'stock' }, { product_id: wasteIn, quantity: 0.4, disposition: 'stock' }] }));
  assert.equal(order.total_cost_cents, 600); assert.deepEqual(order.scraps.map(row => row.expected_quantity), [0.5, 0.4]);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.request('/backup/preview', { backup }));
});
