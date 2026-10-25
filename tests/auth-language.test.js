import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const request = async (path, { method = 'GET', body, cookie, language } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(language ? { 'Accept-Language': language } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const credentials = { username: 'owner', password: 'Strong-password-123' };
  const owner = await request('/auth/setup', { method: 'POST', body: credentials });
  return { db, request, owner, credentials };
}

test('language is nullable, strictly validated, private to the authenticated account and durable across login', async t => {
  const { db, request, owner, credentials } = await fixture(t);
  assert.equal(owner.data.language, null);
  assert.equal((await request('/auth/language', { method: 'PATCH', body: { language: 'en' } })).status, 401);
  for (const language of [null, '', 'EN', 'en-US', 'fr', 1, ['vi']]) {
    assert.equal((await request('/auth/language', { method: 'PATCH', cookie: owner.cookie, body: { language } })).status, 400);
  }
  for (const language of ['en', 'vi', 'zh-CN']) {
    const saved = await request('/auth/language', { method: 'PATCH', cookie: owner.cookie, body: { language, user_id: owner.data.id } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data, { language });
    assert.equal((await request('/auth/status', { cookie: owner.cookie })).data.language, language);
  }
  await request('/auth/language', { method: 'PATCH', cookie: owner.cookie, body: { language: 'vi' } });
  const other = await request('/users', { method: 'POST', cookie: owner.cookie, body: { username: 'other', password: credentials.password, role: 'admin' } });
  assert.equal(other.status, 201);
  assert.equal(db.prepare('SELECT language FROM users WHERE id=?').get(other.data.id).language, null);
  const switched = await request('/auth/login', { method: 'POST', body: { ...credentials, username: 'other' } });
  const staleTab = await request('/auth/language', { method: 'PATCH', cookie: switched.cookie, body: { language: 'en', user_id: owner.data.id } });
  assert.equal(staleTab.status, 409);
  assert.equal(staleTab.data.code, 'ACCOUNT_CHANGED');
  assert.equal(db.prepare('SELECT language FROM users WHERE id=?').get(other.data.id).language, null);
  const login = await request('/auth/login', { method: 'POST', body: credentials });
  assert.equal(login.data.language, 'vi');
  const invalidWarehouse = await request('/products?warehouse_id=99999', { cookie: login.cookie, language: 'en' });
  assert.equal(invalidWarehouse.data.code, 'WAREHOUSE_NOT_FOUND');
  assert.equal(invalidWarehouse.data.error, '仓库不存在，请重新选择仓库。');
  assert.equal(invalidWarehouse.data.message, 'Warehouse not found. Please select a warehouse again.');
  const preferred = await request('/products?warehouse_id=99999', { cookie: login.cookie });
  assert.equal(preferred.data.message, 'Không tìm thấy kho. Vui lòng chọn lại kho.');
  const explicit = await request('/products?warehouse_id=99999&language=zh-CN', { cookie: login.cookie, language: 'en' });
  assert.equal(explicit.data.message, explicit.data.error);
});

test('production-only accounts can change their own language without warehouse or administration permission', async t => {
  const { db, request, owner, credentials } = await fixture(t);
  const position = db.prepare("INSERT INTO positions(name,permissions,access_mode,created_at,updated_at) VALUES ('Language test','[]','production_only',?,?)").run(new Date().toISOString(), new Date().toISOString());
  const created = await request('/users', { method: 'POST', cookie: owner.cookie, body: { username: 'worker', password: credentials.password, position_id: Number(position.lastInsertRowid) } });
  assert.equal(created.status, 201);
  const login = await request('/auth/login', { method: 'POST', body: { username: 'worker', password: credentials.password } });
  const saved = await request('/auth/language?warehouse_id=999', { method: 'PATCH', cookie: login.cookie, body: { language: 'en' } });
  assert.equal(saved.status, 200);
  assert.equal(db.prepare('SELECT language FROM users WHERE id=?').get(created.data.id).language, 'en');
  assert.equal(db.prepare('SELECT language FROM users WHERE id=1').get().language, null);
});

test('production and BOM API validation returns translated display text and keeps legacy Chinese contracts', async t => {
  const { request, owner } = await fixture(t);
  for (const language of ['en', 'vi']) {
    for (const path of ['/boms', '/production-orders/prepare']) {
      const response = await request(path, { method: 'POST', cookie: owner.cookie, language, body: {} });
      assert.equal(response.status, 400, path);
      assert.match(response.data.code, /^VALIDATION_/);
      assert.ok(/[\u3400-\u9fff]/.test(response.data.error));
      assert.ok(!/[\u3400-\u9fff]/.test(response.data.message), response.data.message);
      assert.deepEqual(response.data.params, {});
    }
  }
});
