import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { productExportHeaders, sheetName, warehouseSheet, exportFileName } from '../src/product-export.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, warehouseId = 1) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouseId), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = async (body, warehouseId = 1) => {
    const result = await request('/products', { name: '物料', barcode: 'EXP-001', category: '日用', unit: '件', cost: 10, price: 20, threshold: 5, ...body }, warehouseId);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  };
  return { db, request, product };
}

test('export endpoint returns enabled products of the requested warehouse', async t => {
  const f = await fixture(t);
  const other = (await f.request('/warehouses', { name: '分仓', reuse_catalog: false })).data.id;
  await f.product({ name: '螺丝', barcode: 'EXP-001', specification: 'M3', note: '常用' });
  await f.product({ name: '分仓专用', barcode: 'EXP-002', cost: 3, price: 6 }, other);
  const disabled = await f.product({ name: '已停用', barcode: 'EXP-003' });
  await f.request(`/products/${disabled.id}/status`, { active: 0 }, 1);

  const main = (await f.request('/products/export')).data;
  assert.equal(main.warehouse.id, 1);
  assert.deepEqual(main.products.map(p => p.barcode), ['EXP-001']);
  assert.equal(main.products[0].specification, 'M3');
  assert.equal(main.products[0].note, '常用');

  const second = (await f.request('/products/export', undefined, other)).data;
  assert.deepEqual(second.products.map(p => p.barcode), ['EXP-002']);
});

test('warehouseSheet builds import-compatible rows in the fixed column order', () => {
  const sheet = warehouseSheet({ name: '主仓库' }, [{
    name: '螺丝', barcode: 'EXP-001', category: '五金 / 紧固件', unit: '件', cost: 10, price: 20,
    threshold: 5, stock: 3, specification: 'M3', note: '常用', active: 1,
  }]);
  assert.equal(sheet.stickyRowsCount, 1);
  assert.deepEqual(sheet.data[0], productExportHeaders);
  assert.deepEqual(sheet.data[1], ['螺丝', 'EXP-001', '五金 / 紧固件', '件', 10, 20, 5, 3, 'M3', '常用', '启用']);
  assert.equal(sheet.data.length, 2);
});

test('sheet names are capped at 31 chars and de-duplicated', () => {
  const used = new Set();
  assert.equal(sheetName('主仓库', used), '主仓库');
  assert.equal(sheetName('主仓库', used), '主仓库 (2)');
  assert.equal(sheetName('a'.repeat(40), used).length, 31);
});

test('export filename uses the local date', () => {
  assert.equal(exportFileName(new Date(2026, 9, 16)), '77ERP-物料导出-20261016.xlsx');
});
