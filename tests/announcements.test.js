import { readonlyPositionId } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const request = async (path, { cookie, method = 'GET', body, warehouse = 1 } = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const credentials = { username: 'owner', password: 'Strong-password-123' };
  const admin = (await request('/auth/setup', { method: 'POST', body: credentials })).cookie;
  const employee = (await request('/users', { method: 'POST', cookie: admin, body: { position_id: readonlyPositionId(db), username: 'reader', password: credentials.password } })).data;
  assert.ok(employee.id);
  const reader = (await request('/auth/login', { method: 'POST', body: { position_id: readonlyPositionId(db), username: 'reader', password: credentials.password } })).cookie;
  // Isolate team-announcement counts from the built-in release notice.
  const initial = await request('/announcements', { cookie: admin });
  for (const item of initial.data.announcements) {
    assert.equal((await request(`/announcements/${item.id}`, { method: 'DELETE', cookie: admin, body: { version: item.version } })).status, 200);
  }
  const create = async (title, pinned = false) => {
    const res = await request('/announcements', { method: 'POST', cookie: admin, body: { title, content: '第一行\n第二行', pinned } });
    assert.equal(res.status, 201);
    return res.data;
  };
  return { db, request, admin, reader, create };
}

test('announcement permissions require login and allow employees only to read and acknowledge', async t => {
  const { request, admin, reader, create } = await fixture(t);
  const item = await create('全员公告');
  for (const path of ['/announcements', '/announcements/unread-count', `/announcements/${item.id}`]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { cookie: reader })).status, 200);
  }
  for (const [method, path, body] of [
    ['POST', '/announcements', { title: '越权', content: '正文', pinned: false }],
    ['PUT', `/announcements/${item.id}`, { ...item, pinned: true }],
    ['DELETE', `/announcements/${item.id}`, { version: item.version }],
  ]) assert.equal((await request(path, { method, body, cookie: reader })).status, 403);
  assert.equal((await request(`/announcements/${item.id}`, { cookie: admin })).data.title, '全员公告');
});

test('read state is per account and content version, pinning preserves it, stale edits and receipts fail', async t => {
  const { db, request, admin, reader, create } = await fixture(t);
  const item = await create('盘点安排');
  const count = async cookie => (await request('/announcements/unread-count', { cookie })).data.count;
  assert.equal(await count(reader), 1);
  // Fetching details is read-only; only an explicit receipt changes the account state.
  await request(`/announcements/${item.id}`, { cookie: reader });
  assert.equal(await count(reader), 1);
  const read = version => request(`/announcements/${item.id}/read`, { method: 'POST', cookie: reader, body: { content_version: version } });
  assert.equal((await read(1)).status, 200);
  assert.equal((await read(1)).status, 200);
  assert.equal(await count(reader), 0);
  assert.equal(await count(admin), 1);
  let next = await request(`/announcements/${item.id}`, { method: 'PUT', cookie: admin, body: { ...item, pinned: true } });
  assert.equal(next.status, 200);
  assert.equal(next.data.content_version, 1);
  assert.equal(await count(reader), 0);
  assert.equal((await request(`/announcements/${item.id}`, { method: 'PUT', cookie: admin, body: { ...item, pinned: false } })).status, 409);
  assert.equal((await request(`/announcements/${item.id}`, { method: 'DELETE', cookie: admin, body: { version: item.version } })).status, 409);
  next = await request(`/announcements/${item.id}`, { method: 'PUT', cookie: admin, body: { ...next.data, pinned: true, content: '盘点时间已更新' } });
  assert.equal(next.data.content_version, 2);
  assert.equal(await count(reader), 1);
  assert.equal((await read(1)).status, 409);
  assert.equal((await read(2)).status, 200);
  // Any browser logged in as this account sees the receipt, regardless of selected warehouse.
  assert.equal((await request('/announcements/unread-count', { cookie: reader, warehouse: 999 })).data.count, 0);
  assert.equal((await request(`/announcements/${item.id}`, { method: 'DELETE', cookie: admin, body: { version: next.data.version } })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM announcement_reads').get().n, 0);
  assert.equal((await request(`/announcements/${item.id}`, { cookie: reader })).status, 404);
  assert.equal(await count(admin), 0);
});

test('announcement validation, unread filtering, pagination and pinned ordering', async t => {
  const { request, admin, reader, create } = await fixture(t);
  for (const body of [null, {}, { title: ' ', content: '正文', pinned: false }, { title: '字'.repeat(101), content: '正文', pinned: false },
    { title: '标题', content: '字'.repeat(10001), pinned: false }, { title: '标题', content: ' ', pinned: false }, { title: '标题', content: '正文', pinned: 1 }]) {
    assert.equal((await request('/announcements', { method: 'POST', cookie: admin, body })).status, 400);
  }
  const pinned = await create('置顶公告', true);
  const other = await create('普通公告');
  const first = (await request('/announcements?limit=1', { cookie: reader })).data;
  assert.equal(first.announcements[0].id, pinned.id);
  assert.equal(first.total, 2);
  assert.equal(first.has_more, true);
  assert.equal(first.announcements[0].content, undefined);
  const second = (await request('/announcements?offset=1&limit=1', { cookie: reader })).data;
  assert.equal(second.announcements[0].id, other.id);
  assert.equal(second.has_more, false);
  await request(`/announcements/${pinned.id}/read`, { method: 'POST', cookie: reader, body: { content_version: 1 } });
  const unread = (await request('/announcements?unread=true', { cookie: reader })).data;
  assert.equal(unread.total, 1);
  assert.equal(unread.announcements[0].id, other.id);
  for (const suffix of ['?limit=101', '?limit=0', '?limit=1.5', '?limit=1&limit=2', '?offset=-1', '?offset=9007199254740992', '?unread=1', '/invalid', '/9007199254740992']) {
    assert.equal((await request(`/announcements${suffix}`, { cookie: admin })).status, 400);
  }
});
