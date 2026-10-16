import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { validateStockExpression, evaluateStockExpression, describeStockExpression } from '../shared/stock-compare.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, warehouseId = 1, method) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouseId), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', { username: 'admin', password: 'Test-admin-123' })).cookie;
  await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouses = async (name) => (await request('/warehouses', { name })).data.id;
  const settings = async (body) => request('/settings', { business_name: '七七商贸', warehouse_name: '主仓库', ...body }, 1, 'PUT');
  return { request, warehouses, settings };
}

test('validateStockExpression rejects invalid operators, duplicates and unknown warehouses', () => {
  const ids = [1, 2, 3];
  assert.deepEqual(validateStockExpression({ left: 1, terms: [{ warehouse_id: 2, op: '-' }] }, ids), { left: 1, terms: [{ warehouse_id: 2, op: '-' }] });
  assert.equal(validateStockExpression(null, ids), null);
  assert.throws(() => validateStockExpression({ left: 9, terms: [] }, ids), /起始仓库/);
  assert.throws(() => validateStockExpression({ left: 1, terms: [{ warehouse_id: 4, op: '+' }] }, ids), /不存在/);
  assert.throws(() => validateStockExpression({ left: 1, terms: [{ warehouse_id: 2, op: '*' }] }, ids), /运算符/);
  assert.throws(() => validateStockExpression({ left: 1, terms: [{ warehouse_id: 1, op: '+' }] }, ids), /重复/);
  assert.throws(() => validateStockExpression({ left: 1, terms: [{ warehouse_id: 2, op: '+' }, { warehouse_id: 2, op: '-' }] }, ids), /重复/);
});

test('evaluateStockExpression starts from the left warehouse and applies signed terms', () => {
  const expression = { left: 1, terms: [{ warehouse_id: 2, op: '+' }, { warehouse_id: 3, op: '-' }] };
  assert.equal(evaluateStockExpression(expression, { 1: 10, 2: 4, 3: 6 }), 8);
  assert.equal(evaluateStockExpression(expression, { 1: 10 }), 10);
  assert.equal(evaluateStockExpression(null, { 1: 10 }), null);
});

test('describeStockExpression renders a readable expression', () => {
  const names = { 1: '主仓库', 2: '分仓甲', 3: '分仓乙' };
  assert.equal(describeStockExpression({ left: 1, terms: [{ warehouse_id: 2, op: '+' }, { warehouse_id: 3, op: '-' }] }, names), '主仓库 + 分仓甲 − 分仓乙');
  assert.equal(describeStockExpression(null, names), '');
});

test('settings persist the global stock expression and expose it in the workspace payload', async (t) => {
  const f = await fixture(t);
  const a = await f.warehouses('分仓甲');
  const b = await f.warehouses('分仓乙');

  let data = (await f.request('/data')).data;
  assert.equal(data.settings.stock_expression, null);

  const save = await f.settings({ stock_expression: { left: 1, terms: [{ warehouse_id: a, op: '+' }, { warehouse_id: b, op: '-' }] } });
  assert.equal(save.status, 200, JSON.stringify(save.data));

  data = (await f.request('/data')).data;
  assert.deepEqual(data.settings.stock_expression, { left: 1, terms: [{ warehouse_id: a, op: '+' }, { warehouse_id: b, op: '-' }] });

  await f.settings({ stock_expression: null });
  assert.equal((await f.request('/data')).data.settings.stock_expression, null);
});

test('settings reject an expression referencing a missing warehouse', async (t) => {
  const f = await fixture(t);
  const save = await f.settings({ stock_expression: { left: 1, terms: [{ warehouse_id: 999, op: '+' }] } });
  assert.equal(save.status, 400);
  assert.match(save.data.error, /不存在/);
});

test('deleting a warehouse prunes it from the comparison expression', async (t) => {
  const f = await fixture(t);
  const a = await f.warehouses('分仓甲');
  const b = await f.warehouses('分仓乙');
  await f.settings({ stock_expression: { left: 1, terms: [{ warehouse_id: a, op: '+' }, { warehouse_id: b, op: '-' }] } });

  await f.request(`/warehouses/${a}`, {}, 1, 'DELETE');
  assert.deepEqual((await f.request('/data')).data.settings.stock_expression, { left: 1, terms: [{ warehouse_id: b, op: '-' }] });

  await f.request(`/warehouses/${b}`, {}, 1, 'DELETE');
  assert.deepEqual((await f.request('/data')).data.settings.stock_expression, { left: 1, terms: [] });
});

test('deleting the left warehouse clears the comparison expression', async (t) => {
  const f = await fixture(t);
  const a = await f.warehouses('分仓甲');
  await f.settings({ stock_expression: { left: a, terms: [{ warehouse_id: 1, op: '+' }] } });

  await f.request(`/warehouses/${a}`, {}, 1, 'DELETE');
  assert.equal((await f.request('/data')).data.settings.stock_expression, null);
});
