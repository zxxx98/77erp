import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBomQuantity, bomRequiredQuantity, validateBomLossRate } from '../shared/bom.js';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { bomCSV } from '../src/bom-csv.js';
import { parseCSV } from '../src/data-files.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId || 1),
        ...((options.cookie === undefined ? cookie : options.cookie) ? { Cookie: options.cookie === undefined ? cookie : options.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', { username: 'bomadmin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = async (barcode, warehouseId = 1, extra = {}) => {
    const result = await request('/products', { name: `物料 ${barcode}`, barcode, category: 'BOM', unit: '个', cost: 1, price: 2, threshold: 0, ...extra }, { warehouseId });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.id;
  };
  const parent = await product('FINISHED'), material = await product('MATERIAL');
  const definition = (extra = {}) => ({ name: '测试BOM', product_id: parent, base_quantity: 1, base_unit: '个', note: '', enabled: 1,
    items: [{ product_id: material, quantity: 1.25, unit: '个', note: '' }], ...extra });
  const command = (path, body, options) => request(path, { request_id: randomUUID(), ...body }, options);
  const create = async (extra = {}) => {
    const result = await command('/boms', definition(extra));
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
  };
  return { db, request, product, parent, material, definition, command, create };
}

test('BOM maintenance is idempotent, warehouse-scoped, searchable and does not change stock, value or orders', async t => {
  const f = await fixture(t), before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  const revision = (await f.request('/workspace')).data.revision;
  const body = { ...f.definition({ name: '配方%_一', base_quantity: 10 }), request_id: randomUUID() };
  const saved = await f.request('/boms', body);
  assert.equal(saved.status, 200);
  assert.deepEqual((await f.request('/boms', body)).data, saved.data);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n, 1);
  const bom = saved.data;
  assert.ok(bom.version > 0);
  assert.equal(bom.created_by_name, 'bomadmin');
  assert.equal(bom.items[0].product.name, '物料 MATERIAL');
  assert.equal(JSON.stringify(bom).includes('inventory_value_cents'), false);
  assert.equal((await f.command('/boms', f.definition({ name: bom.name }))).status, 400, 'same product recipe names are unique');
  assert.notEqual((await f.request('/workspace')).data.revision, revision);
  for (const q of ['%25', '_', 'FINISHED', '配方']) {
    const list = (await f.request('/boms?q=' + q)).data;
    assert.equal(list.total, 1); assert.equal(list.boms[0].id, bom.id);
  }
  const other = (await f.request('/warehouses', { name: 'BOM分仓' })).data.id;
  assert.equal((await f.request('/boms', undefined, { warehouseId: other })).data.total, 0);
  assert.equal((await f.request(`/boms/${bom.id}`, undefined, { warehouseId: other })).status, 404);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 }, { warehouseId: other })).status, 404);
  const updated = await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, name: '新配方', items: [{ product_id: f.material, quantity: 2, unit: '个', note: '按包备料' }] }));
  assert.equal(updated.status, 200);
  assert.notEqual(updated.data.version, bom.version);
  assert.equal(updated.data.items[0].quantity, 2);
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM stock_adjustments').get().n, 0);
});

test('structure metadata uses current material types while production recipe snapshots and tokens stay frozen', async t => {
  const f = await fixture(t);
  const raw = await f.product('RAW', 1, { production_type: '原料' });
  const unset = await f.product('UNSET');
  f.db.prepare('UPDATE products SET production_type=? WHERE id=?').run('半成品', f.material);
  const child = await f.create({ name: '子配方', product_id: f.material,
    items: [{ product_id: raw, quantity: 3, unit: '个', note: '' }] });
  const root = await f.create({ items: [
    { product_id: f.material, quantity: 2, unit: '个', note: '', usage_mode: 'explode', child_bom_id: child.id },
    { product_id: raw, quantity: 1, unit: '个', note: '' },
    { product_id: unset, quantity: 1, unit: '个', note: '' },
  ] });
  const calculate = async () => {
    const result = await f.request(`/boms/${root.id}/calculate`, { schema_version: 2, production_quantity: 2 });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
  };
  const plan = await calculate();
  assert.deepEqual(plan.nodes.map(n => [n.path, n.current_production_type]), [['1', '半成品'], ['1.1', '原料'], ['2', '原料'], ['3', '']]);
  const saved = await f.command('/production-orders', { schema_version: 2, stage_schema_version: 1,
    bom_id: root.id, bom_version: root.version, planned_quantity: 2, structure_token: plan.structure_token, note: '' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const stored = () => f.db.prepare('SELECT * FROM production_bom_nodes WHERE production_id=? ORDER BY position').all(saved.data.id);
  const frozen = stored();
  assert.ok(frozen.every(node => !Object.hasOwn(node, 'current_production_type')));
  f.db.prepare('UPDATE products SET production_type=? WHERE id=?').run('成品', raw);
  f.db.prepare('UPDATE products SET production_type=?,active=0 WHERE id=?').run('', f.material);
  const detail = (await f.request(`/production-orders/${saved.data.id}`)).data;
  assert.deepEqual(detail.nodes.map(n => [n.path, n.current_production_type]), [['1', ''], ['1.1', '成品'], ['2', '成品'], ['3', '']]);
  assert.deepEqual(stored(), frozen);
  assert.equal(detail.nodes[1].quantity, 3);
  f.db.prepare('UPDATE products SET active=1 WHERE id=?').run(f.material);
  const refreshed = await calculate();
  assert.equal(refreshed.structure_token, plan.structure_token, 'display-only type changes must not invalidate the recipe');
  assert.deepEqual(refreshed.rows, plan.rows);
  const prepared = await f.request('/production-orders/prepare', { schema_version: 2,
    bom_id: root.id, bom_version: root.version, planned_quantity: 2 });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  assert.equal(prepared.data.nodes[1].current_production_type, '成品');
  const backup = (await f.request('/backup')).data;
  const preview = await f.request('/backup/preview', { backup });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
});

test('standard loss uses gross-input percentages and combines exact fractions before a single upward rounding', () => {
  assert.equal(bomRequiredQuantity(90, 1, 1, '', 10), 100);
  assert.equal(bomRequiredQuantity(100, 1, 1, '', 5), 105.2632);
  assert.equal(bomRequiredQuantity(0.3334, 3, 1, '1/3', 20), 1.25);
  assert.equal(bomRequiredQuantity(0.3334, 3, 2, '1/3', 20), 0.625);
  assert.equal(bomRequiredQuantity(0.000001, 1, 1, '', 99.999999), 100);
  assert.equal(bomRequiredQuantity(0.000001, 1, 1, '', 0.000001), 0.0001);
  assert.throws(() => bomRequiredQuantity(1, 1, 1, '', 99.999999), /上限/);
  for (const rate of [-1, 100, 101, 0.0000001, '10', null, NaN, Infinity]) {
    assert.throws(() => validateBomLossRate(rate), /标准损耗率/);
    assert.throws(() => bomRequiredQuantity(1, 1, 1, '', rate), /标准损耗率/);
  }
});

test('loss rates belong to individual BOM materials, preserve older-client edits and scale scrap from gross demand', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP');
  const bom = await f.create({ items: [{ product_id: f.material, quantity: 90, loss_rate: 10, unit: '个', note: '' }],
    scraps: [{ product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 6, unit: '个', note: '' }] });
  const secondParent = await f.product('OTHER-FINISHED');
  const other = await f.create({ product_id: secondParent, items: [{ product_id: f.material, quantity: 90, loss_rate: 25, unit: '个', note: '' }] });
  assert.equal(other.items[0].loss_rate, 25); assert.equal(bom.items[0].loss_rate, 10);
  const plan = (await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).data;
  assert.equal(plan.rows[0].required, 100); assert.equal(plan.rows[0].shortage, 100);
  assert.equal(plan.rows[0].loss_rate, 10); assert.equal(plan.scraps[0].planned_quantity, 6);
  const csv = parseCSV(bomCSV(plan)); assert.equal(csv[4][9], '标准损耗率（%）'); assert.equal(csv[5][9], '10');
  const edited = await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version }));
  assert.equal(edited.status, 200); assert.equal(edited.data.items[0].loss_rate, 10, 'omitted rates retain the saved allowance');
  for (const loss_rate of [-1, 100, 0.0000001, '10', null]) {
    const response = await f.command(`/boms/${bom.id}`, f.definition({ version: edited.data.version,
      items: [{ ...f.definition().items[0], loss_rate }] }));
    assert.equal(response.status, 400); assert.match(response.data.error, /标准损耗率/);
  }
  const reset = await f.command(`/boms/${bom.id}`, f.definition({ version: edited.data.version,
    items: [{ ...f.definition().items[0], loss_rate: 0 }] }));
  assert.equal(reset.status, 200); assert.equal(reset.data.items[0].loss_rate, 0);
});

test('external loss keeps exact fractions, rounds only final demand and rejects invalid methods', () => {
  assert.equal(bomRequiredQuantity(90, 1, 1, '', 10, 'external'), 99);
  assert.equal(bomRequiredQuantity(100, 1, 1, '', 5, 'external'), 105);
  assert.equal(bomRequiredQuantity(0.3334, 3, 1, '1/3', 20, 'external'), 1.2);
  assert.equal(bomRequiredQuantity(0.3334, 3, 2, '1/3', 20, 'external'), 0.6);
  assert.equal(bomRequiredQuantity(0.000001, 1, 1, '', 0.000001, 'external'), 0.0001);
  assert.equal(bomRequiredQuantity(90, 1, 1, '', 0, 'external'), 90);
  assert.throws(() => bomRequiredQuantity(99999999, 1, 1, '', 1, 'external'), /上限/);
  for (const method of ['', null, 0, 'other', 'constructor'])
    assert.throws(() => bomRequiredQuantity(1, 1, 1, '', 10, method), /计算方式/);
});

test('BOM loss method controls demand and scrap, survives older clients and invalidates stale calculations', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP');
  const bom = await f.create({ loss_method: 'external', items: [{ product_id: f.material, quantity: 90, loss_rate: 10, unit: '个', note: '' }],
    scraps: [{ product_id: scrap, method: 'input_ratio', source_product_id: f.material, quantity: 6, unit: '个', note: '' }] });
  assert.equal(bom.loss_method, 'external');
  const plan = (await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).data;
  assert.equal(plan.loss_method, 'external'); assert.equal(plan.rows[0].required, 99); assert.equal(plan.rows[0].shortage, 99);
  assert.equal(plan.scraps[0].planned_quantity, 5.94);
  const csv = parseCSV(bomCSV(plan)); assert.equal(csv[3][5], '外包法');
  assert.match(csv.at(-1)[1], /净用量 ×（1＋损耗率）/);
  const edited = await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version }));
  assert.equal(edited.status, 200); assert.equal(edited.data.loss_method, 'external');
  for (const loss_method of ['', null, 1, 'other']) {
    const invalid = await f.command(`/boms/${bom.id}`, { ...edited.data, loss_method });
    assert.equal(invalid.status, 400); assert.match(invalid.data.error, /计算方式/);
  }
  const switched = await f.command(`/boms/${bom.id}`, { ...edited.data, loss_method: 'internal' });
  assert.equal(switched.status, 200); assert.equal(switched.data.loss_method, 'internal');
  assert.notEqual(switched.data.version, edited.data.version);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1, version: edited.data.version })).status, 409);
  const recalculated = (await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).data;
  assert.equal(recalculated.rows[0].required, 1.3889);
});

test('BOM rejects malformed, duplicate, self, inactive, unit-mismatched and cross-warehouse materials atomically', async t => {
  const f = await fixture(t);
  const other = (await f.request('/warehouses', { name: '外仓' })).data.id;
  const remote = await f.product('REMOTE', other), inactive = await f.product('INACTIVE');
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(inactive);
  for (const extra of [
    { product_id: '1' }, { name: '' }, { name: 'a'.repeat(101) }, { base_quantity: 0 }, { base_quantity: 0.0000001 },
    { base_quantity: 100000000 }, { base_unit: '箱' }, { product_id: remote }, { product_id: inactive }, { enabled: true }, { note: 'a'.repeat(501) },
    { items: [] }, { items: null }, { items: Array(101).fill(f.definition().items[0]) },
    { items: [f.definition().items[0], f.definition().items[0]] },
    ...[f.parent, remote, inactive, 999].map(product_id => ({ items: [{ product_id, quantity: 1, unit: '个', note: '' }] })),
    ...[0, -1, 0.0000001, '1', null].map(quantity => ({ items: [{ product_id: f.material, quantity, unit: '个', note: '' }] })),
    { items: [{ product_id: f.material, quantity: 1, unit: '箱', note: '' }] },
  ]) {
    const response = await f.command('/boms', f.definition(extra));
    assert.ok([400, 409].includes(response.status), JSON.stringify(extra));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n, 0);
    assert.equal(f.db.isTransaction, false);
  }
  const bom = await f.create();
  assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, items: [] }))).status, 400);
  assert.deepEqual((await f.request(`/boms/${bom.id}`)).data, bom, 'bad edit retains header, version and all rows');
  for (const query of ['?q=a&q=b', '?q=' + 'a'.repeat(101), '?status=bad', '?offset=-1', '?offset=0.5', '?limit=101', '?product_id=x', '?product_id=0'])
    assert.equal((await f.request('/boms' + query)).status, 400, query);
});

test('version checks retain concurrent edits, status and restore invalidate old editors and retries do not duplicate saves', async t => {
  const f = await fixture(t), bom = await f.create();
  const update = { ...f.definition({ version: bom.version, name: '编辑甲' }), request_id: randomUUID() };
  const first = await f.request(`/boms/${bom.id}`, update);
  assert.equal(first.status, 200);
  assert.deepEqual((await f.request(`/boms/${bom.id}`, update)).data, first.data);
  assert.equal((await f.request(`/boms/${bom.id}`, { ...update, name: '改写同一请求' })).status, 400);
  assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, name: '编辑乙' }))).status, 409);
  assert.equal((await f.command(`/boms/${bom.id}/status`, { version: bom.version, enabled: 0 })).status, 409);
  const disabled = await f.command(`/boms/${bom.id}/status`, { version: first.data.version, enabled: 0 });
  assert.equal(disabled.status, 200);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).status, 400);
  assert.equal((await f.request('/boms?status=disabled')).data.total, 1);
  const enabled = await f.command(`/boms/${bom.id}/status`, { version: disabled.data.version, enabled: 1 });
  assert.equal(enabled.status, 200);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1, version: first.data.version })).status, 409);
});

test('single-level calculation scales batches exactly, rounds demand upward and retains the inventory snapshot', async t => {
  const f = await fixture(t), second = await f.product('SECOND');
  f.db.prepare('UPDATE products SET stock=0.3 WHERE id=?').run(f.material);
  f.db.prepare('UPDATE products SET stock=99 WHERE id=?').run(second);
  // This material has its own BOM, but its ingredients must not be recursively expanded.
  await f.create({ product_id: f.material, name: '半成品配方', items: [{ product_id: second, quantity: 99, unit: '个', note: '' }] });
  const bom = await f.create({ base_quantity: 3, items: [{ product_id: f.material, quantity: 1, unit: '个', note: '小数用量' }, { product_id: second, quantity: 0.3, unit: '个', note: '' }] });
  const before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  const result = await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1, version: bom.version });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.rows.map(row => row.required), [0.3334, 0.1]);
  assert.deepEqual(result.data.rows.map(row => row.shortage), [0.0334, 0]);
  assert.equal(result.data.warehouse.name, '主仓库');
  assert.ok(Number.isFinite(Date.parse(result.data.captured_at)));
  assert.equal(JSON.stringify(result.data).includes('cost'), false);
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), before);
  f.db.prepare('UPDATE products SET stock=100 WHERE id=?').run(f.material);
  assert.equal(result.data.rows[0].stock, 0.3);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).data.rows[0].shortage, 0);
  for (const production_quantity of [0, -1, '1', 0.0000001, 100000000, null])
    assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity })).status, 400);
  assert.equal(bomRequiredQuantity(0.1, 0.3, 0.1), 0.3);
  assert.equal(bomRequiredQuantity(0.000001, 0.000001, 99999999), 0.0001);
  assert.equal(bomRequiredQuantity(99999999, 99999999, 99999999), 99999999);
  assert.throws(() => bomRequiredQuantity(99999999, 2, 1), /上限/);
});

test('referenced goods cannot be deleted, unit or lifecycle changes require review, and warehouse deletion/reset clears BOMs', async t => {
  const f = await fixture(t), bom = await f.create();
  for (const id of [f.parent, f.material]) {
    const result = await f.request(`/products/${id}`, {}, { method: 'DELETE' });
    assert.equal(result.status, 400); assert.match(result.data.error, /BOM/);
  }
  f.db.prepare('UPDATE products SET unit=? WHERE id=?').run('千克', f.material);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).status, 409);
  const reviewed = await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version, items: [{ product_id: f.material, quantity: 0.25, unit: '千克', note: '' }] }));
  assert.equal(reviewed.status, 200);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).status, 200);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.material);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 1 })).status, 400);
  assert.equal((await f.request(`/boms/${bom.id}`)).status, 200, 'inactive goods remain visible in saved recipes');
  const warehouseId = (await f.request('/warehouses', { name: '可删除仓' })).data.id;
  const parent = await f.product('FINISHED', warehouseId), material = await f.product('MATERIAL', warehouseId);
  assert.equal((await f.command('/boms', f.definition({ product_id: parent, items: [{ product_id: material, quantity: 1, unit: '个', note: '' }] }), { warehouseId })).status, 200);
  assert.equal((await f.request(`/warehouses/${warehouseId}`, {}, { method: 'DELETE' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n, 1);
  assert.equal((await f.request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bom_items').get().n, 0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('BOM fractions retain exact ratios through scaling and reject invalid or inconsistent quantities', async t => {
  for (const raw of ['1/0', '0/40', '-1/40', '1/-40', '1/2/3', '1.5/40', '1/100000000', '100000000/1', '1+2', '=1/40'])
    assert.throws(() => parseBomQuantity(raw), undefined, raw);
  assert.deepEqual(parseBomQuantity(' 01 / 040 '), { quantity: 0.025, quantity_fraction: '1/40' });
  assert.deepEqual(parseBomQuantity('0.025'), { quantity: 0.025, quantity_fraction: '' });
  const third = parseBomQuantity('1/3');
  assert.equal(bomRequiredQuantity(third.quantity, 3, 1, third.quantity_fraction), 1);
  assert.equal(bomRequiredQuantity(third.quantity, 1, 1, third.quantity_fraction), 0.3334);
  assert.equal(bomRequiredQuantity(third.quantity, 3, 2, third.quantity_fraction), 0.5);
  assert.equal(bomRequiredQuantity(0.000001, 99999999, 1, '1/99999999'), 1);
  const f = await fixture(t);
  const bom = await f.create({ items: [{ product_id: f.material, ...parseBomQuantity('1/40'), unit: '个', note: '每箱 40 件' }] });
  assert.equal(bom.items[0].quantity_fraction, '1/40');
  for (const [production_quantity, expected] of [[1, 0.025], [40, 1], [80, 2], [41, 1.025]]) {
    const result = await f.request(`/boms/${bom.id}/calculate`, { production_quantity });
    assert.equal(result.status, 200); assert.equal(result.data.rows[0].required, expected);
    assert.equal(result.data.rows[0].quantity_fraction, '1/40');
  }
  for (const quantity_fraction of ['1/0', '1/3', null, 40, '0.025', '=1/40']) {
    const response = await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version,
      items: [{ product_id: f.material, quantity: 0.025, quantity_fraction, unit: '个', note: '' }] }));
    assert.equal(response.status, 400, String(quantity_fraction));
  }
  assert.equal((await f.request(`/boms/${bom.id}`)).data.items[0].quantity_fraction, '1/40');
});

test('BOM backup restores all relations, rejects tampering, refreshes edit versions and accepts older backups', async t => {
  const f = await fixture(t), bom = await f.create();
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 43);
  assert.equal(backup.data.boms.length, 1);
  for (const tamper of [
    value => { value.data.bom_items = []; },
    value => { value.data.bom_items[0].product_id = f.parent; },
    value => { value.data.boms[0].base_quantity = 0; },
    value => { value.data.boms[0].warehouse_id = 999; },
    value => { value.data.bom_items[0].position = -1; },
    value => { value.data.boms[0].version = '1'; },
    value => { value.data.bom_items[0].quantity_fraction = '1/40'; },
    value => { value.data.bom_items[0].quantity_fraction = null; },
  ]) {
    const bad = structuredClone(backup); tamper(bad);
    assert.equal((await f.request('/backup/preview', { backup: bad })).status, 400);
  }
  const preview = await f.request('/backup/preview', { backup });
  assert.equal(preview.data.boms, 1);
  const restore = await f.command('/backup/restore', { backup, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' });
  assert.equal(restore.status, 200, JSON.stringify(restore.data));
  const restored = (await f.request(`/boms/${bom.id}`)).data;
  assert.notEqual(restored.version, bom.version);
  assert.equal(restored.items[0].product_id, f.material);
  const legacy = structuredClone(backup); legacy.version = 24;
  for (const row of legacy.data.bom_items) delete row.quantity_fraction;
  const legacyPreview = await f.request('/backup/preview', { backup: legacy });
  assert.equal(legacyPreview.status, 200);
  assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version }))).status, 409);
  // Preview must also detect changes to a BOM, even if inventory did not change.
  const secondPreview = (await f.request('/backup/preview', { backup })).data;
  await f.command(`/boms/${bom.id}/status`, { version: restored.version, enabled: 0 });
  assert.equal((await f.command('/backup/restore', { backup, ...secondPreview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 400);
  const old = structuredClone(backup); old.version = 22; delete old.data.boms; delete old.data.bom_items;
  const oldPreview = await f.request('/backup/preview', { backup: old });
  assert.equal(oldPreview.status, 200); assert.equal(oldPreview.data.boms, 0);
  assert.equal((await f.command('/backup/restore', { backup: old, ...oldPreview.data, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n, 0);
});

test('BOM permission independently gates all endpoints without granting inventory writes or revealing financial values', async t => {
  const f = await fixture(t), bom = await f.create();
  assert.equal((await f.request('/boms', undefined, { cookie: null })).status, 401);
  const user = (await f.request('/users', { position_id: readonlyPositionId(f.db), username: 'bomstaff', employee_no: 'bomstaff', password: 'Test-staff-123' })).data.id;
  const staff = (await f.request('/auth/login', { username: 'bomstaff', password: 'Test-staff-123' }, { cookie: null })).cookie;
  assert.equal((await f.request('/boms', undefined, { cookie: staff })).status, 403);
  assert.equal((await f.command(`/boms/${bom.id}/delete`, { version: bom.version }, { cookie: staff })).status, 403);
  const version = f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(user).permissions_version;
  assert.equal((await grantPosition(f.db, (path, body, method) => f.request(path, body, { method }), user, ['bom'])).status, 200);
  const options = { cookie: staff };
  const detail = await f.request(`/boms/${bom.id}`, undefined, options);
  assert.equal(detail.status, 200); assert.equal(Object.hasOwn(detail.data.product, 'inventory_value_cents'), false);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 3 }, options)).status, 200);
  assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version }), options)).status, 200);
  assert.equal((await f.command('/stock/reduce', { product_id: f.material, quantity: 1, reason: '不应获权' }, options)).status, 403);
  assert.equal((await f.request('/products', { name: '不应获权' }, options)).status, 403);
  const current = (await f.request(`/boms/${bom.id}`, undefined, options)).data;
  assert.equal((await f.command(`/boms/${bom.id}/delete`, { version: current.version }, options)).status, 200);
});

test('BOM deletion is versioned, isolated, idempotent and removes rules without changing goods', async t => {
  const f = await fixture(t), scrap = await f.product('SCRAP');
  const bom = await f.create({ scraps: [{ product_id: scrap, method: 'output', source_product_id: null, quantity: 1, unit: '个', note: '' }] });
  const path = `/boms/${bom.id}/delete`, body = { version: bom.version, request_id: randomUUID() };
  const before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  const revision = (await f.request('/workspace')).data.revision;
  assert.equal((await f.request(path, body, { cookie: null })).status, 401);
  const other = (await f.request('/warehouses', { name: '删除隔离仓库' })).data.id;
  assert.equal((await f.command(path, { version: bom.version }, { warehouseId: other })).status, 404);
  assert.equal((await f.command(path, {})).status, 409);
  assert.equal((await f.command(path, { version: String(bom.version) })).status, 409);
  const edited = await f.command(`/boms/${bom.id}/status`, { version: bom.version, enabled: 0 });
  assert.equal((await f.request(path, body)).status, 409);
  assert.deepEqual((await f.request(`/boms/${bom.id}`)).data, edited.data);
  body.version = edited.data.version;
  const deleted = await f.request(path, body);
  assert.equal(deleted.status, 200); assert.deepEqual(deleted.data, { ok: true });
  assert.deepEqual((await f.request(path, body)).data, deleted.data);
  assert.equal((await f.command(path, { version: body.version })).status, 404);
  for (const table of ['boms', 'bom_items', 'bom_scraps']) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), before);
  assert.notDeepEqual((await f.request('/workspace')).data.revision, revision);
  const recreated = await f.create();
  assert.ok(recreated.version > body.version);
  assert.equal((await f.command(`/boms/${recreated.id}/delete`, { version: body.version })).status, 409);
  assert.equal((await f.request('/backup')).data.data.boms.length, 1);
});

test('BOM deletion preserves parent links and production snapshots including void orders', async t => {
  const f = await fixture(t), raw = await f.product('RAW');
  const child = await f.create({ name: '下级配方', product_id: f.material, items: [{ product_id: raw, quantity: 1, unit: '个', note: '' }] });
  const root = await f.create({ items: [{ product_id: f.material, quantity: 1, unit: '个', note: '', usage_mode: 'explode', child_bom_id: child.id }] });
  const remove = bom => f.command(`/boms/${bom.id}/delete`, { version: bom.version });
  const blocked = await remove(child);
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /上级BOM/);
  const plan = (await f.request(`/boms/${root.id}/calculate`, { production_quantity: 1, schema_version: 2 })).data;
  const order = await f.command('/production-orders', { bom_id: root.id, bom_version: root.version, planned_quantity: 1, note: '', schema_version: 2, stage_schema_version: 1, structure_token: plan.structure_token });
  assert.equal(order.status, 200);
  const edited = await f.command(`/boms/${root.id}`, f.definition({ version: root.version,
    items: [{ product_id: f.material, quantity: 1, unit: '个', note: '', usage_mode: 'stock', child_bom_id: null }] }));
  assert.equal(edited.status, 200);
  for (const bom of [child, edited.data]) {
    const result = await remove(bom);
    assert.equal(result.status, 409); assert.match(result.data.error, /生产单/);
    assert.deepEqual((await f.request(`/boms/${bom.id}`)).data, bom);
  }
  const voided = await f.command(`/production-orders/${order.data.id}/void`, { version: order.data.version, schema_version: 2, stage_schema_version: 1, reason: '取消生产' });
  assert.equal(voided.status, 200);
  assert.equal((await remove(child)).status, 409);
  assert.equal((await remove(edited.data)).status, 409);
  const loaded = (await f.request(`/production-orders/${order.data.id}`)).data;
  assert.deepEqual(loaded, { ...voided.data, captured_at: loaded.captured_at });
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('BOM CSV exports the exact snapshot, retains fractional quantities and protects text cells from spreadsheet formulas', () => {
  const snapshot = { name: '=配方', product: { name: '桌子', barcode: '001', unit: '张' }, warehouse: { name: '主仓' },
    production_quantity: 10, base_quantity: 1, captured_at: '2026-10-23T10:00:00.000Z', rows: [
      { name: '+螺丝', barcode: 'A,"001"', specification: '@规格', unit: '颗', quantity: 0.3, required: 3, stock: 2.123456, shortage: 0.876544, note: '-备注' },
    ] };
  const csv = bomCSV(snapshot), rows = parseCSV(csv);
  assert.equal(csv[0], '\ufeff');
  assert.equal(rows[0][1], "'=配方");
  assert.deepEqual(rows[5], ["'+螺丝", 'A,"001"', "'@规格", '颗', '0.3', '3', '2.123456', '0.876544', "'-备注", '0']);
  snapshot.rows[0].quantity = 0.3334; snapshot.rows[0].quantity_fraction = '1/3';
  assert.equal(parseCSV(bomCSV(snapshot))[5][4], '1/3（约 0.3334）');
  assert.ok(rows.at(-1)[1].includes('未预留或扣减'));
  snapshot.rows[0].product_id = 20;
  snapshot.scraps = [
    { name: '=废料', barcode: 'S-1', specification: '', unit: 'kg', method: 'output', source_product_id: null, quantity: 0.3334, quantity_fraction: '1/3', planned_quantity: 3.333334, note: '@说明' },
    { name: '废料乙', barcode: 'S-2', specification: '', unit: '颗', method: 'input_ratio', source_product_id: 20, quantity: 5, quantity_fraction: '', planned_quantity: 0.15, note: '' },
  ];
  const exported = parseCSV(bomCSV(snapshot));
  assert.equal(exported[6][0], '预计废料名称');
  assert.equal(exported[7][0], "'=废料"); assert.equal(exported[7][5], '1/3（约 0.3334）'); assert.equal(exported[7][8], "'@说明");
  assert.equal(exported[8][5], '5%'); assert.equal(exported[8][6], 'A,"001"'); assert.equal(exported[8][7], '0.15');

});

test('multiple named recipes per product bind explicit child IDs and preserve older-client edits', async t => {
  const f = await fixture(t), raw = await f.product('RAW');
  const child = await f.create({ product_id: f.material, name: '半成品标准', items: [{ product_id: raw, quantity: 3, unit: '个', note: '' }] });
  const alternate = await f.create({ product_id: f.material, name: '半成品替代', items: [{ product_id: raw, quantity: 6, unit: '个', note: '' }] });
  const root = await f.create({ items: [{ product_id: f.material, ...parseBomQuantity('1/3'), unit: '个', note: '', usage_mode: 'explode', child_bom_id: child.id }] });
  const otherRoot = await f.create({ name: '另一成品配方', items: [{ product_id: f.material, quantity: 1, unit: '个', note: '', usage_mode: 'explode', child_bom_id: alternate.id }] });
  const calculate = id => f.request(`/boms/${id}/calculate`, { production_quantity: 1, schema_version: 2 });
  const plan = (await calculate(root.id)).data;
  assert.deepEqual(plan.rows.map(row => [row.product_id, row.required, row.quantity, row.loss_rate]), [[raw, 1, null, null]]);
  assert.equal(plan.nodes[0].child_bom_id, child.id); assert.equal(plan.nodes[1].bom_id, child.id);
  assert.equal((await calculate(otherRoot.id)).data.rows[0].required, 6);
  assert.equal((await f.request(`/boms/${root.id}/calculate`, { production_quantity: 1 })).status, 409);
  assert.equal((await f.request(`/boms?product_id=${f.material}`)).data.total, 2);
  assert.equal((await f.command('/boms', f.definition({ name: ' 半成品标准 ', product_id: f.material, items: child.items }))).status, 400);
  await f.command(`/boms/${alternate.id}`, { ...alternate, version: alternate.version, name: '未选配方改名', items: alternate.items });
  assert.equal((await calculate(root.id)).data.structure_token, plan.structure_token);
  const oldEdit = await f.command(`/boms/${root.id}`, { ...f.definition(), version: root.version });
  assert.equal(oldEdit.status, 200, JSON.stringify(oldEdit.data));
  assert.equal(oldEdit.data.items[0].usage_mode, 'explode'); assert.equal(oldEdit.data.items[0].child_bom_id, child.id);
  const invalid = await f.command(`/boms/${child.id}`, { ...child, version: child.version, product_id: f.parent });
  assert.equal(invalid.status, 400, 'selected child cannot change product');
});

test('multilevel demand retains exact fractions, aggregates shared leaves once and ignores intermediate stock', async t => {
  const f = await fixture(t), branch = await f.product('BRANCH'), raw = await f.product('RAW');
  const child = await f.create({ product_id: f.material, items: [{ product_id: raw, ...parseBomQuantity('1/3'), unit: '个', note: '' }] });
  const second = await f.create({ product_id: branch, items: [{ product_id: raw, ...parseBomQuantity('1/3'), unit: '个', note: '' }] });
  const root = await f.create({ items: [f.material, branch].map((product_id, index) => ({ product_id, quantity: 1, unit: '个', note: '', usage_mode: 'explode', child_bom_id: [child.id, second.id][index] })) });
  f.db.prepare('UPDATE products SET stock=100 WHERE id=?').run(f.material);
  f.db.prepare('UPDATE products SET stock=0.3 WHERE id=?').run(raw);
  const result = await f.request(`/boms/${root.id}/calculate`, { production_quantity: 1, schema_version: 2 });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.rows.length, 1); assert.equal(result.data.rows[0].required, 0.6667); assert.equal(result.data.rows[0].shortage, 0.3667);
  assert.deepEqual(result.data.rows[0].sources, ['1.1', '2.1']);
  const changed = await f.command(`/boms/${child.id}`, { ...child, version: child.version, loss_method: 'external', items: [{ ...child.items[0], loss_rate: 10 }] });
  assert.equal(changed.status, 200);
  const next = (await f.request(`/boms/${root.id}/calculate`, { production_quantity: 1, schema_version: 2 })).data;
  assert.equal(next.rows[0].required, 0.7); assert.notEqual(next.structure_token, result.data.structure_token);
});

test('selected BOM graph rejects cycles, wrong child identity and unsupported scrap without partial writes', async t => {
  const f = await fixture(t), raw = await f.product('RAW'), waste = await f.product('WASTE');
  const child = await f.create({ product_id: f.material, items: [{ product_id: raw, quantity: 1, unit: '个', note: '' }] });
  const root = await f.create({ items: [{ product_id: f.material, quantity: 1, unit: '个', note: '', usage_mode: 'explode', child_bom_id: child.id }] });
  const cycle = await f.command(`/boms/${child.id}`, { ...child, version: child.version,
    items: [{ product_id: f.parent, quantity: 1, unit: '个', note: '', usage_mode: 'explode', child_bom_id: root.id }] });
  assert.equal(cycle.status, 400); assert.match(cycle.data.error, /循环/);
  assert.equal((await f.request(`/boms/${child.id}`)).data.version, child.version);
  const wrong = await f.command(`/boms/${root.id}`, { ...root, items: [{ ...root.items[0], child_bom_id: root.id }], version: root.version });
  assert.equal(wrong.status, 400);
  const scrapChild = await f.create({ product_id: f.material, name: '含废料配方', items: child.items,
    scraps: [{ product_id: waste, method: 'output', source_product_id: null, quantity: 1, unit: '个', note: '' }] });
  const scrapRoot = await f.command(`/boms/${root.id}`, { ...root, version: root.version, items: [{ ...root.items[0], child_bom_id: scrapChild.id }] });
  assert.equal(scrapRoot.status, 400); assert.match(scrapRoot.data.error, /废料/);
  await f.command(`/boms/${child.id}/status`, { version: child.version, enabled: 0 });
  const stopped = await f.request(`/boms/${root.id}/calculate`, { production_quantity: 1, schema_version: 2 });
  assert.equal(stopped.status, 400); assert.match(stopped.data.error, /已停用/);
  const disabledSelection = await f.command('/boms', f.definition({ name: '不允许新选停用配方', items: root.items }));
  assert.equal(disabledSelection.status, 400); assert.match(disabledSelection.data.error, /已停用/);
  const stockRoot = await f.create({ name: '直接领用配方', items: [{ product_id: f.material, quantity: 1, unit: '个', note: '' }] });
  assert.equal((await f.request(`/boms/${stockRoot.id}/calculate`, { production_quantity: 1 })).status, 200);
});
