import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { bomRequiredQuantity } from '../shared/bom.js';
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
  const definition = (extra = {}) => ({ name: '测试用料清单', product_id: parent, base_quantity: 1, base_unit: '个', note: '', enabled: 1,
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
  assert.equal((await f.command('/boms', f.definition())).status, 400, 'one BOM per finished product');
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
  assert.deepEqual(result.data.rows.map(row => row.required), [0.333334, 0.1]);
  assert.deepEqual(result.data.rows.map(row => row.shortage), [0.033334, 0]);
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
  assert.equal(bomRequiredQuantity(0.000001, 0.000001, 99999999), 0.000001);
  assert.equal(bomRequiredQuantity(99999999, 99999999, 99999999), 99999999);
  assert.throws(() => bomRequiredQuantity(99999999, 2, 1), /上限/);
});

test('referenced goods cannot be deleted, unit or lifecycle changes require review, and warehouse deletion/reset clears BOMs', async t => {
  const f = await fixture(t), bom = await f.create();
  for (const id of [f.parent, f.material]) {
    const result = await f.request(`/products/${id}`, {}, { method: 'DELETE' });
    assert.equal(result.status, 400); assert.match(result.data.error, /用料清单/);
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

test('BOM backup restores all relations, rejects tampering, refreshes edit versions and accepts older backups', async t => {
  const f = await fixture(t), bom = await f.create();
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 23);
  assert.equal(backup.data.boms.length, 1);
  for (const tamper of [
    value => { value.data.bom_items = []; },
    value => { value.data.bom_items[0].product_id = f.parent; },
    value => { value.data.boms[0].base_quantity = 0; },
    value => { value.data.boms[0].warehouse_id = 999; },
    value => { value.data.bom_items[0].position = -1; },
    value => { value.data.boms[0].version = '1'; },
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
  const user = (await f.request('/users', { username: 'bomstaff', password: 'Test-staff-123' })).data.id;
  const staff = (await f.request('/auth/login', { username: 'bomstaff', password: 'Test-staff-123' }, { cookie: null })).cookie;
  assert.equal((await f.request('/boms', undefined, { cookie: staff })).status, 403);
  const version = f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(user).permissions_version;
  assert.equal((await f.request(`/users/${user}/permissions`, { version, permissions: ['bom'] }, { method: 'PUT' })).status, 200);
  const options = { cookie: staff };
  const detail = await f.request(`/boms/${bom.id}`, undefined, options);
  assert.equal(detail.status, 200); assert.equal(Object.hasOwn(detail.data.product, 'inventory_value_cents'), false);
  assert.equal((await f.request(`/boms/${bom.id}/calculate`, { production_quantity: 3 }, options)).status, 200);
  assert.equal((await f.command(`/boms/${bom.id}`, f.definition({ version: bom.version }), options)).status, 200);
  assert.equal((await f.command('/stock/reduce', { product_id: f.material, quantity: 1, reason: '不应获权' }, options)).status, 403);
  assert.equal((await f.request('/products', { name: '不应获权' }, options)).status, 403);
});

test('BOM CSV exports the exact snapshot, retains fractional quantities and protects text cells from spreadsheet formulas', () => {
  const snapshot = { name: '=配方', product: { name: '桌子', barcode: '001', unit: '张' }, warehouse: { name: '主仓' },
    production_quantity: 10, base_quantity: 1, captured_at: '2026-10-23T10:00:00.000Z', rows: [
      { name: '+螺丝', barcode: 'A,"001"', specification: '@规格', unit: '颗', quantity: 0.3, required: 3, stock: 2.123456, shortage: 0.876544, note: '-备注' },
    ] };
  const csv = bomCSV(snapshot), rows = parseCSV(csv);
  assert.equal(csv[0], '\ufeff');
  assert.equal(rows[0][1], "'=配方");
  assert.deepEqual(rows[5], ["'+螺丝", 'A,"001"', "'@规格", '颗', '0.3', '3', '2.123456', '0.876544', "'-备注"]);
  assert.ok(rows.at(-1)[1].includes('未预留或扣减'));
});
