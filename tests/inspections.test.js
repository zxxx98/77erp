import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { inspectionToday, nextInspectionDate } from '../shared/inspection.js';

const fields = ['inspection_date', 'inspection_interval', 'inspection_unit', 'last_inspected_on'];
const product = { name: '待校验量具', category: '量具', unit: '件', cost: 10, price: 20, threshold: 0 };
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1, session = cookie) => {
    // API clients send arrays; raw SQLite fixtures store this field as JSON.
    if (method === 'PUT' && /^\/products\/\d+$/.test(path) && typeof body?.customer_part_numbers === 'string') body = { ...body, customer_part_numbers: JSON.parse(body.customer_part_numbers) };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-password-123' })).cookie;
  await request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const create = async (extra = {}, warehouse = 1) => {
    const response = await request('/products', 'POST', { ...product, ...extra }, warehouse);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return db.prepare('SELECT * FROM products WHERE id=?').get(response.data.id);
  };
  const current = id => db.prepare('SELECT * FROM products WHERE id=?').get(id);
  return { db, request, create, current };
}

test('inspection schedules are optional, validated, preserved by legacy edits, and can be cleared', async t => {
  const f = await fixture(t);
  const plain = await f.create();
  assert.equal(plain.inspection_date, '');
  assert.equal(plain.inspection_interval, 0);
  const configured = await f.create({ inspection_date: '2026-02-28', inspection_interval: 6, inspection_unit: 'month' });
  const legacy = { ...configured, name: '旧客户端修改名称' };
  fields.forEach(key => delete legacy[key]);
  assert.equal((await f.request(`/products/${configured.id}`, 'PUT', legacy)).status, 200);
  assert.equal(f.current(configured.id).inspection_date, '2026-02-28');
  assert.equal(f.current(configured.id).inspection_interval, 6);
  for (const extra of [
    { inspection_date: '2026-02-30' }, { inspection_date: null }, { inspection_date: '0000-01-01' },
    { inspection_interval: 1 }, { inspection_date: '2026-12-01', inspection_interval: -1 },
    { inspection_date: '2026-12-01', inspection_interval: 1.5 },
    { inspection_date: '2026-12-01', inspection_interval: '12' },
    { inspection_date: '2026-12-01', inspection_interval: 1000 }, { inspection_unit: '__proto__' },
  ]) assert.equal((await f.request('/products', 'POST', { ...product, ...extra })).status, 400);
  const before = f.current(configured.id);
  assert.equal((await f.request(`/products/${configured.id}`, 'PUT', { ...before, inspection_date: '', inspection_interval: 0 })).status, 200);
  assert.equal(f.current(configured.id).inspection_date, '');
  assert.ok(f.current(configured.id).version > before.version);
});

test('due lists include today and overdue dates, paginate in date order, and exclude inactive, future and other warehouses', async t => {
  const f = await fixture(t), today = inspectionToday();
  const warehouse = (await f.request('/warehouses', 'POST', { name: '校验分仓' })).data.id;
  const oldest = await f.create({ inspection_date: '2000-01-01' });
  const dueToday = await f.create({ inspection_date: today });
  await f.create();
  await f.create({ inspection_date: '9999-12-31' });
  const inactive = await f.create({ inspection_date: '1999-01-01' });
  await f.request(`/products/${inactive.id}/status`, 'POST', { active: 0 });
  const elsewhere = await f.create({ inspection_date: '1998-01-01' }, warehouse);
  const first = (await f.request('/products?inspection=due&limit=1')).data;
  assert.equal(first.total, 2);
  assert.equal(first.products[0].id, oldest.id);
  assert.equal(first.has_more, true);
  const second = (await f.request(`/products?inspection=due&limit=1&offset=${first.next_offset}`)).data;
  assert.equal(second.products[0].id, dueToday.id);
  assert.equal(second.has_more, false);
  assert.deepEqual((await f.request('/products?inspection=due', 'GET', undefined, warehouse)).data.products.map(p => p.id), [elsewhere.id]);
});

test('completing periodic inspection renews from today without changing stock or finances, and stale requests cannot renew twice', async t => {
  const f = await fixture(t), today = inspectionToday();
  const p = await f.create({ inspection_date: '2000-01-01', inspection_interval: 6, inspection_unit: 'month' });
  const revision = (await f.request('/updates')).data.revision;
  const beforeDashboard = (await f.request('/dashboard')).data;
  const result = await f.request(`/products/${p.id}/inspect`, 'POST', { version: p.version });
  assert.equal(result.status, 200);
  const saved = f.current(p.id);
  assert.equal(saved.inspection_date, nextInspectionDate(today, 6, 'month'));
  assert.equal(saved.last_inspected_on, today);
  assert.ok(saved.version > p.version);
  assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', { version: p.version })).status, 409);
  assert.equal((await f.request(`/products/${p.id}`, 'PUT', p)).status, 409);
  assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', { version: saved.version })).status, 400);
  assert.equal((await f.request('/products?inspection=due')).data.total, 0);
  assert.deepEqual((await f.request('/dashboard')).data, beforeDashboard);
  assert.notEqual((await f.request('/updates')).data.revision, revision);
});

test('one-off inspection requires a manually entered future date; permissions and warehouse scope apply', async t => {
  const f = await fixture(t), p = await f.create({ inspection_date: '2000-01-01' });
  for (const next_date of [undefined, '', '2026-02-30', inspectionToday(), '2001-01-01']) {
    assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', { version: p.version, next_date })).status, 400);
    assert.deepEqual(f.current(p.id), p);
  }
  const warehouse = (await f.request('/warehouses', 'POST', { name: '其他仓库' })).data.id;
  assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', { version: p.version, next_date: '2099-01-01' }, warehouse)).status, 400);
  const employee = await f.request('/users', 'POST', { position_id: readonlyPositionId(f.db), username: 'staff', employee_no: 'staff', password: 'Test-password-123', role: 'employee' });
  const session = (await f.request('/auth/login', 'POST', { username: 'staff', password: 'Test-password-123' }, 1, null)).cookie;
  const body = { version: p.version, next_date: '2099-01-01' };
  assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', body, 1, session)).status, 403);
  await grantPosition(f.db, (path, body, method) => f.request(path, method, body), employee.data.id, ['products']);
  assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', body, 1, session)).status, 200);
  assert.equal(f.current(p.id).inspection_date, body.next_date);
  assert.equal(f.current(p.id).last_inspected_on, inspectionToday());
});

test('backdated inspections validate actual dates and renew configured periods from the selected date even when still overdue', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-05T12:00:00Z') });
  const f = await fixture(t);
  for (const [inspected_on, inspection_interval, inspection_unit, expected] of [
    ['2030-01-31', 1, 'month', '2030-02-28'],
    ['2028-02-29', 1, 'year', '2029-02-28'],
    ['2030-03-02', 7, 'day', '2030-03-09'],
  ]) {
    const p = await f.create({ inspection_date: '2000-01-01', inspection_interval, inspection_unit });
    for (const invalid of ['', null, 20300301, '2030-02-30', '0000-01-01', '2030-03-06']) {
      const rejected = await f.request(`/products/${p.id}/inspect`, 'POST', { version: p.version, inspected_on: invalid });
      assert.equal(rejected.status, 400);
      assert.match(rejected.data.error, /实际校验日期/);
      assert.deepEqual(f.current(p.id), p);
    }
    const body = { version: p.version, inspected_on };
    const result = await f.request(`/products/${p.id}/inspect`, 'POST', body);
    assert.equal(result.status, 200);
    assert.equal(result.data.last_inspected_on, inspected_on);
    assert.equal(result.data.inspection_date, expected);
    const saved = f.current(p.id);
    assert.deepEqual({ ...saved }, { ...p, version: saved.version, last_inspected_on: inspected_on, inspection_date: expected });
    assert.ok(saved.version > p.version);
    assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', body)).status, 409);
    const due = (await f.request('/products?inspection=due')).data.products;
    assert.equal(due.some(row => row.id === p.id), expected <= inspectionToday());
  }
});

test('manual backdated inspection requires the next date to follow the actual date and can remain overdue', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-05T12:00:00Z') });
  const f = await fixture(t), p = await f.create({ inspection_date: '2000-01-01' });
  const body = { version: p.version, inspected_on: '2030-02-01' };
  for (const next_date of ['', '2030-01-31', '2030-02-01', '2030-02-30']) {
    assert.equal((await f.request(`/products/${p.id}/inspect`, 'POST', { ...body, next_date })).status, 400);
    assert.deepEqual(f.current(p.id), p);
  }
  const result = await f.request(`/products/${p.id}/inspect`, 'POST', { ...body, next_date: '2030-03-01' });
  assert.equal(result.status, 200);
  assert.equal(f.current(p.id).last_inspected_on, body.inspected_on);
  assert.equal(f.current(p.id).inspection_date, '2030-03-01');
  assert.equal((await f.request('/products?inspection=due')).data.total, 1);
});

test('calendar periods clamp month ends and leap days without overflowing into the next month', () => {
  assert.equal(nextInspectionDate('2028-02-28', 1, 'day'), '2028-02-29');
  assert.equal(nextInspectionDate('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(nextInspectionDate('2028-01-31', 1, 'month'), '2028-02-29');
  assert.equal(nextInspectionDate('2028-02-29', 1, 'year'), '2029-02-28');
  assert.equal(nextInspectionDate('2026-12-31', 2, 'month'), '2027-02-28');
});

test('crossing the due day signals a manual refresh even when nobody writes to the database', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-06-01T23:59:00Z') });
  const f = await fixture(t), p = await f.create({ inspection_date: '2030-06-02' });
  const revision = (await f.request('/updates')).data.revision;
  assert.equal((await f.request('/products?inspection=due')).data.total, 0);
  t.mock.timers.setTime(new Date('2030-06-02T00:01:00Z').getTime());
  assert.notEqual((await f.request('/updates')).data.revision, revision);
  assert.deepEqual((await f.request('/products?inspection=due')).data.products.map(row => row.id), [p.id]);
  assert.deepEqual(f.current(p.id), p);
});

test('inspection settings survive backup/restore and imports; older backups default to no inspection', async t => {
  const f = await fixture(t), p = await f.create({ inspection_date: '2000-01-01', inspection_interval: 1, inspection_unit: 'year' });
  await f.request(`/products/${p.id}/inspect`, 'POST', { version: p.version });
  const saved = f.current(p.id);
  const backup = (await f.request('/backup')).data;
  const restore = async value => {
    const preview = await f.request('/backup/preview', 'POST', { backup: value });
    if (preview.status !== 200) return preview;
    return f.request('/backup/restore', 'POST', { backup: value, ...preview.data, request_id: randomUUID(), confirmation: 'RESTORE_BUSINESS_DATA' });
  };
  assert.equal(backup.version, 41);
  assert.equal((await restore(backup)).status, 200);
  for (const key of fields) assert.equal(f.current(p.id)[key], saved[key]);
  const bad = structuredClone(backup);
  bad.data.products[0].last_inspected_on = '2026-02-30';
  assert.equal((await restore(bad)).status, 400);
  const legacy = structuredClone(backup);
  legacy.version = 14;
  legacy.data.products.forEach(row => fields.forEach(key => delete row[key]));
  assert.equal((await restore(legacy)).status, 200);
  assert.equal(f.current(p.id).inspection_date, '');
  const rows = [{ ...product, barcode: 'INSPECT-IMPORT', stock: 0, inspection_date: '2030-01-01', inspection_interval: 30, inspection_unit: 'day' }];
  const preview = await f.request('/products/import/preview', 'POST', { rows });
  assert.equal(preview.status, 200);
  assert.equal((await f.request('/products/import', 'POST', { rows, token: preview.data.token, request_id: randomUUID() })).status, 200);
  const imported = f.db.prepare('SELECT * FROM products WHERE barcode=?').get('INSPECT-IMPORT');
  assert.equal(imported.inspection_interval, 30);
  assert.equal(imported.inspection_date, '2030-01-01');
});

test('startup upgrades old product tables and their version triggers while preserving existing records', () => {
  const dir = mkdtempSync(join(tmpdir(), '77erp-inspection-'));
  const path = join(dir, 'legacy.sqlite');
  try {
    let { db } = createApp(path);
    const before = db.prepare('SELECT id,name,stock FROM products ORDER BY id').all();
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'data_revision_*'").all()) db.exec(`DROP TRIGGER ${name}`);
    db.exec('DROP TRIGGER product_version_update');
    fields.forEach(key => db.exec(`ALTER TABLE products DROP COLUMN ${key}`));
    db.close();
    ({ db } = createApp(path));
    assert.deepEqual(db.prepare('SELECT id,name,stock FROM products ORDER BY id').all(), before);
    const p = db.prepare('SELECT * FROM products ORDER BY id LIMIT 1').get();
    assert.equal(p.inspection_date, '');
    db.prepare('UPDATE products SET inspection_date=? WHERE id=?').run('2030-01-01', p.id);
    assert.ok(db.prepare('SELECT version FROM products WHERE id=?').get(p.id).version > p.version);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
