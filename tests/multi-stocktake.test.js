import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { multiStocktakeCSV } from '../src/multi-stocktake-csv.js';
import { parseCSV } from '../src/data-files.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, warehouseId = 1, auth = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouseId), ...(auth && cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouse = async name => (await request('/warehouses', { name })).data.id;
  const product = async (barcode, warehouseId = 1, extra = {}) => {
    const result = await request('/products', { name: `商品 ${barcode}`, barcode, category: '日用', unit: '个', cost: 1, price: 2, threshold: 0, ...extra }, warehouseId);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.id;
  };
  return { db, request, warehouse, product };
}

test('product search is scoped, empty by default, literal, paginated and includes inactive goods without costs', async t => {
  const f = await fixture(t), other = await f.warehouse('分仓');
  const special = await f.product('A_001', 1, { name: '特殊%商品' });
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(special);
  await f.product('REMOTE', other, { name: '分仓独有' });
  for (let n = 0; n < 32; n++) await f.product(`P-${String(n).padStart(3, '0')}`, 1, { name: '批量匹配商品' });
  for (const query of ['', '?q=', '?q=%20%20%20']) {
    const result = await f.request('/stocktakes/multi/products' + query);
    assert.deepEqual(result.data, { products: [], has_more: false });
  }
  const result = await f.request('/stocktakes/multi/products?q=批量');
  assert.equal(result.data.products.length, 30);
  assert.equal(result.data.has_more, true);
  const next = await f.request('/stocktakes/multi/products?q=批量&offset=30');
  assert.equal(next.data.products.length, 2);
  assert.equal(next.data.has_more, false);
  assert.equal(new Set([...result.data.products, ...next.data.products].map(p => p.id)).size, 32);
  assert.deepEqual((await f.request('/stocktakes/multi/products?q=REMOTE')).data.products, []);
  for (const query of ['%25', '_', 'A_001']) {
    const found = (await f.request(`/stocktakes/multi/products?q=${query}`)).data.products;
    assert.equal(found.length, 1);
    assert.equal(found[0].id, special);
    assert.equal(found[0].active, 0);
    assert.ok(!Object.hasOwn(found[0], 'cost'));
    assert.ok(!Object.hasOwn(found[0], 'inventory_value_cents'));
  }
  for (const query of ['?q=' + 'x'.repeat(101), '?q=a&q=b', '?q=a&offset=-1', '?q=a&offset=0.5', '?q=a&offset=9007199254740992'])
    assert.equal((await f.request('/stocktakes/multi/products' + query)).status, 400);
  assert.equal((await f.request('/stocktakes/multi/products?q=a', undefined, 1, false)).status, 401);
});

test('comparison prioritizes sync links, falls back to matching codes, distinguishes missing/zero/units and never mutates inventory', async t => {
  const f = await fixture(t);
  const synced = await f.warehouse('同步仓'), fallback = await f.warehouse('独立仓'), missing = await f.warehouse('空仓'), differentUnit = await f.warehouse('箱仓');
  const main = await f.product('A001', 1, { sync_warehouse_ids: [synced] });
  const linked = f.db.prepare('SELECT id FROM products WHERE warehouse_id=?').get(synced).id;
  f.db.prepare('UPDATE products SET barcode=?,stock=? WHERE id=?').run('UPDATED-LABEL', 80.023456, linked);
  const collision = await f.product('A001', synced);
  f.db.prepare('UPDATE products SET stock=? WHERE id=?').run(999, collision);
  const codeMatch = await f.product('A001', fallback);
  const boxed = await f.product('A001', differentUnit, { unit: '箱' });
  f.db.prepare('UPDATE products SET stock=? WHERE id=?').run(100.123456, main);
  f.db.prepare('UPDATE products SET stock=? WHERE id=?').run(0, codeMatch);
  f.db.prepare('UPDATE products SET stock=? WHERE id=?').run(2, boxed);
  const before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  const result = await f.request('/stocktakes/multi/compare', { warehouse_ids: [missing, synced, 1, fallback, differentUnit], product_ids: [main] });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.warehouses.map(w => w.id), [1, missing, synced, fallback, differentUnit]);
  const row = result.data.rows[0];
  assert.deepEqual(row.cells.map(c => c.quantity), [100.123456, null, 80.023456, 0, 2]);
  assert.deepEqual(row.cells.map(c => c.difference), [0, null, -20.1, -100.123456, null]);
  assert.deepEqual(row.cells.map(c => c.status), ['matched', 'missing', 'matched', 'matched', 'unit_mismatch']);
  assert.equal(row.cells[4].unit, '箱');
  assert.ok(!Object.hasOwn(row, 'inventory_value_cents'));
  assert.ok(!Object.hasOwn(row, 'sync_key'));
  assert.ok(!Number.isNaN(Date.parse(result.data.captured_at)));
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_adjustments').get().n, 0);
  // The baseline is the selected warehouse, not necessarily warehouse 1.
  const reverse = await f.request('/stocktakes/multi/compare', { warehouse_ids: [1, synced], product_ids: [linked] }, synced);
  assert.equal(reverse.data.warehouses[0].id, synced);
  assert.equal(reverse.data.rows[0].cells[1].difference, 20.1);
});

test('comparison rejects invalid inputs and cross-warehouse anchors, and preserves requested row order', async t => {
  const f = await fixture(t), other = await f.warehouse('分仓');
  const first = await f.product('FIRST'), second = await f.product('SECOND'), remote = await f.product('REMOTE', other);
  const body = { warehouse_ids: [1, other], product_ids: [second, first] };
  const result = await f.request('/stocktakes/multi/compare', body);
  assert.deepEqual(result.data.rows.map(row => row.product_id), [second, first]);
  for (const bad of [null, {}, { ...body, warehouse_ids: [] }, { ...body, warehouse_ids: [other] },
    { ...body, warehouse_ids: [1, 1] }, { ...body, warehouse_ids: ['1'] }, { ...body, warehouse_ids: [1, 999] },
    { ...body, product_ids: [] }, { ...body, product_ids: [first, first] }, { ...body, product_ids: [remote] },
    { ...body, product_ids: [999] }, { ...body, product_ids: ['1'] },
    { ...body, product_ids: Array.from({ length: 1001 }, (_, i) => i + 1) }])
    assert.equal((await f.request('/stocktakes/multi/compare', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await f.request('/stocktakes/multi/compare', body, 1, false)).status, 401);
  assert.equal((await f.request('/stocktakes/multi/compare', body)).status, 200, 'bad requests do not leave an open transaction');
});

test('CSV exports the same snapshot, quotes text, preserves fractional and negative numbers, and prevents text formulas', () => {
  const snapshot = { warehouses: [{ id: 2, name: '当前仓' }, { id: 1, name: '其他仓' }, { id: 3, name: '空仓' }], rows: [
    { name: '=SUM(1,2)', barcode: 'A,"001"', unit: '个', cells: [
      { quantity: 100.123456, status: 'matched', difference: 0 },
      { quantity: 80.023456, status: 'matched', difference: -20.1 },
      { quantity: null, status: 'missing', difference: null },
    ] },
    { name: '普通商品', barcode: 'A002', unit: '个', cells: [
      { quantity: 0, status: 'matched', difference: 0 },
      { quantity: 2, unit: '箱', status: 'unit_mismatch', difference: null },
      { quantity: 0.000001, status: 'matched', difference: 0.000001 },
    ] },
  ] };
  const csv = multiStocktakeCSV(snapshot);
  assert.equal(csv[0], '\ufeff');
  const rows = parseCSV(csv);
  assert.deepEqual(rows[0], ['商品名称', '编号', '单位', '当前仓数量', '其他仓数量', '其他仓差值', '空仓数量', '空仓差值']);
  assert.deepEqual(rows[1], ["'=SUM(1,2)", 'A,"001"', '个', '100.123456', '80.023456', '-20.1', '未建档', '']);
  assert.deepEqual(rows[2], ['普通商品', 'A002', '个', '0', '2 箱（单位不同）', '', '0.000001', '0.000001']);
});
