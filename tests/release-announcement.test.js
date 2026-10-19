import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

async function fixture(t, dbPath) {
  const { app, db } = createApp(dbPath);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const close = async () => { await new Promise(resolve => server.close(resolve)); db.close(); };
  t.after(close);
  let cookie;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  };
  return { db, request };
}

const credentials = { username: 'owner', password: 'Strong-password-123' };

test('first setup publishes the release once, with normal per-account read state', async t => {
  const { db, request } = await fixture(t, ':memory:');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM announcements').get().n, 0);
  await request('/auth/setup', 'POST', credentials);
  const list = await request('/announcements');
  assert.equal(list.total, 1);
  assert.equal(list.unread_count, 1);
  const item = await request(`/announcements/${list.announcements[0].id}`);
  assert.match(item.title, /1\.14\.5 更新公告/);
  assert.equal(item.created_by_name, '系统更新');
  assert.match(item.content, /公告中心/);
  assert.match(item.content, /桌面操作体验/);
  assert.match(item.content, /移动 Web \/ PWA/);
  await request(`/announcements/${item.id}/read`, 'POST', { content_version: item.content_version });
  assert.equal((await request('/announcements/unread-count')).count, 0);
  assert.equal((await request('/announcements')).total, 1);
});

test('upgrade publishes once and restarts preserve edits, read receipts and deletion', async t => {
  const directory = mkdtempSync(join(tmpdir(), '77erp-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'app.sqlite');
  // An installed database has accounts but has not yet published this release.
  await t.test('existing installation', async t => {
    const { request } = await fixture(t, dbPath);
    await request('/auth/setup', 'POST', credentials);
  });
  let item;
  await t.test('upgrade', async t => {
    const { request } = await fixture(t, dbPath);
    await request('/auth/login', 'POST', credentials);
    const list = await request('/announcements');
    assert.equal(list.total, 1);
    item = await request(`/announcements/${list.announcements[0].id}`);
    item = await request(`/announcements/${item.id}`, 'PUT', { ...item, title: '管理员补充的更新说明', pinned: true });
    await request(`/announcements/${item.id}/read`, 'POST', { content_version: item.content_version });
  });
  await t.test('restart preserves the edited notice and receipt', async t => {
    const { request } = await fixture(t, dbPath);
    await request('/auth/login', 'POST', credentials);
    const list = await request('/announcements');
    assert.equal(list.total, 1);
    assert.equal(list.unread_count, 0);
    assert.equal(list.announcements[0].title, '管理员补充的更新说明');
    assert.equal(list.announcements[0].pinned, 1);
    await request(`/announcements/${item.id}`, 'DELETE', { version: item.version });
  });
  await t.test('restart does not restore a deleted release', async t => {
    const { db, request } = await fixture(t, dbPath);
    await request('/auth/login', 'POST', credentials);
    assert.equal((await request('/announcements')).total, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM release_announcements').get().n, 1);
  });
});
