import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { installR2Backup, nextBackup, pruneR2Backups } from '../server/r2-backup.js';

async function fixture(t, options = {}) {
  const instance = createApp(':memory:', options);
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await instance.r2Backup.stop(); await instance.notifications.stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); instance.db.close(); });
  let cookie;
  const request = async (path, method = 'GET', body, session = cookie) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  const configure = async (changes = {}) => request('/settings/r2-backup', 'PUT', { ...(await request('/settings/r2-backup')).data, ...changes });
  return { ...instance, request, configure };
}
const credentials = { account_id: 'a'.repeat(32), bucket: 'erp-backups', access_key: 'test-access', secret_key: 'test-secret' };

test('cron is five-field and timezone aware', () => {
  assert.equal(nextBackup('0 2 * * *', 'Asia/Shanghai', new Date('2026-01-01T00:00:00Z')), '2026-01-01T18:00:00.000Z');
  for (const cron of ['* * * * * *', '70 * * * *', 'invalid']) assert.throws(() => nextBackup(cron, 'UTC'));
  assert.throws(() => nextBackup('* * * * *', 'invalid'));
});
test('settings enforce authorization, validation, versioning and secret redaction', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/settings/r2-backup', 'GET', undefined, '')).status, 401);
  const config = (await f.configure(credentials)).data;
  assert.equal(config.has_secret_key, true);
  assert.ok(!JSON.stringify(config).includes('test-secret'));
  assert.ok(!JSON.stringify(config).includes('private-token'));
  assert.equal((await f.configure({ secret_key: '' })).data.has_secret_key, true);
  assert.equal((await f.request('/settings/r2-backup', 'PUT', config)).status, 409);
  for (const changes of [{ enabled: true, clear_secret_key: true }, { cron: 'invalid' }, { timezone: 'invalid' }, { account_id: 'localhost' }, { prefix: '../escape' }]) assert.equal((await f.configure(changes)).status, 400);
  const user = await f.request('/users', 'POST', { username: 'worker', password: 'Test-worker-123', role: 'employee' });
  assert.equal(user.status, 201);
  const employee = (await f.request('/auth/login', 'POST', { username: 'worker', password: 'Test-worker-123' })).cookie;
  assert.equal((await f.request('/settings/r2-backup', 'GET', undefined, employee)).status, 403);
  assert.ok(!JSON.stringify((await f.request('/backup')).data).includes('test-secret'));
});
test('online snapshot restores SQLite, prevents overlapping runs and cleans temporary files', async t => {
  let release, entered, path; const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  const f = await fixture(t, { r2Upload: async (_c, file, key) => {
    path = file;
    assert.match(key, /^77erp\/.*\.sqlite$/);
    const copy = new DatabaseSync(file);
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(copy.prepare('SELECT username FROM users WHERE id=1').get().username, 'admin');
    copy.close(); entered(); await gate;
  } });
  const c = (await f.configure(credentials)).data;
  const pending = f.request('/settings/r2-backup/run', 'POST', { version: c.version });
  await started;
  assert.equal((await f.request('/settings/r2-backup/run', 'POST', { version: c.version })).status, 409);
  release();
  const result = await pending;
  assert.equal(result.status, 200); assert.equal(result.data.status, 'success'); assert.ok(result.data.bytes > 0);
  assert.equal(existsSync(path), false);
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='r2_backup_runs'").get(), undefined);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE event='database_backup'").get().n, 0);
});
test('missed schedules are skipped, current schedules run once, notifications use existing subscriptions', async t => {
  let calls = 0, failUpload = false; const sent = [];
  const f = await fixture(t, { r2Upload: async () => { calls++; if (failUpload) throw new Error('private credential'); }, webhookSend: async (_c, e) => sent.push(e) });
  const c = (await f.configure({ ...credentials, enabled: true, cron: '* * * * *' })).data;
  const initial = Date.now();
  const future = new Date(Math.floor(initial / 60000) * 60000 + 5 * 60000);
  await f.r2Backup.tick(future);
  assert.equal(calls, 0);
  const due = new Date(future.getTime() + 60000);
  await f.r2Backup.tick(due); await f.r2Backup.tick(due);
  assert.equal(calls, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE event='database_backup'").get().n, 0);
  const notification = (await f.request('/settings/notifications')).data;
  assert.equal((await f.request('/settings/notifications', 'PUT', { ...notification, enabled: true, url: 'https://example.com/hook', events: ['database_backup'], warehouse_ids: [1] })).status, 200);
  failUpload = true;
  const failed = await f.request('/settings/r2-backup/run', 'POST', { version: c.version });
  assert.equal(failed.status, 502); assert.ok(!failed.data.error.includes('private credential'));
  await f.notifications.tick();
  assert.equal(sent.length, 1); assert.equal(sent[0].event, 'database_backup'); assert.equal(sent[0].data.status, 'failed'); assert.equal(sent[0].warehouse, null);
  assert.match(sent[0].message, /备份失败/);
  failUpload = false;
  await f.request('/settings/r2-backup/run', 'POST', { version: c.version }); await f.notifications.tick();
  assert.equal(sent[1].data.status, 'success'); assert.match(sent[1].message, /备份成功/);
  const latest = (await f.request('/settings/notifications')).data;
  await f.request('/settings/notifications', 'PUT', { ...latest, events: [] });
  await f.request('/settings/r2-backup/run', 'POST', { version: c.version }); await f.notifications.tick();
  assert.equal(sent.length, 2);
});

test('previous backup history and independent webhook credentials are removed on upgrade', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE r2_backup_settings(id INTEGER PRIMARY KEY,config TEXT,version INTEGER DEFAULT 1,next_at TEXT,lease_until INTEGER); CREATE TABLE r2_backup_runs(id TEXT);");
    db.prepare('INSERT INTO r2_backup_settings VALUES (1,?,1,?,123)').run(JSON.stringify({ ...credentials, enabled: false, cron: '* * * * *', timezone: 'UTC', prefix: '77erp', webhook_url: 'https://example.com/old', webhook_secret: 'old-secret', webhook_format: 'json' }), '2020-01-01T00:00:00.000Z');
    installR2Backup({ get() {}, put() {}, post() {} }, db);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='r2_backup_runs'").get(), undefined);
    assert.deepEqual(db.prepare('PRAGMA table_info(r2_backup_settings)').all().map(c => c.name), ['id', 'config', 'version']);
    const config = JSON.parse(db.prepare('SELECT config FROM r2_backup_settings').get().config);
    assert.equal(config.secret_key, credentials.secret_key);
    assert.equal(config.webhook_url, undefined); assert.equal(config.webhook_secret, undefined);
  } finally { db.close(); }
});

const backupObject = (index, prefix = '77erp/') => ({
  Key: `${prefix}2026-01-01T00-00-00.000Z-00000000-0000-4000-8000-${String(index).padStart(12, '0')}.sqlite`,
  LastModified: new Date(index * 1000),
});
test('R2 retention paginates, keeps ten latest backups and ignores other files and subdirectories', async () => {
  const objects = Array.from({ length: 1015 }, (_, i) => backupObject(i));
  const deleted = [], lists = [];
  const client = { async send(command) {
    const input = command.input;
    if (command.constructor.name === 'ListObjectsV2Command') {
      lists.push(input);
      return input.ContinuationToken ? { Contents: [...objects.slice(1000), backupObject(9999, '77erp/sub/'), backupObject(9999, 'other/'), { Key: '77erp/manual.sqlite' }] }
        : { Contents: objects.slice(0, 1000), IsTruncated: true, NextContinuationToken: 'page-2' };
    }
    deleted.push(input.Delete.Objects.map(o => o.Key)); return {};
  } };
  await pruneR2Backups(client, { bucket: 'backups', prefix: '77erp' }, objects.at(-1).Key);
  assert.equal(lists.length, 2); assert.equal(lists[0].Prefix, '77erp/');
  assert.deepEqual(deleted.map(batch => batch.length), [1000, 5]);
  assert.deepEqual(new Set(deleted.flat()), new Set(objects.slice(0, 1005).map(o => o.Key)));
});
test('R2 retention never deletes when listing fails or current upload is absent', async () => {
  for (const mode of ['failure', 'missing', 'truncated']) {
    let deletes = 0;
    const client = { async send(command) {
      if (command.constructor.name === 'DeleteObjectsCommand') { deletes++; return {}; }
      if (mode === 'failure') throw new Error('listing failed');
      return { Contents: Array.from({ length: 12 }, (_, i) => backupObject(i)), IsTruncated: mode === 'truncated' };
    } };
    await assert.rejects(pruneR2Backups(client, { bucket: 'backups', prefix: '77erp' }, backupObject(99).Key));
    assert.equal(deletes, 0);
  }
});
test('R2 retention handles empty prefix, short lists, clock changes and partial delete errors', async () => {
  for (const count of [5, 12]) {
    const objects = Array.from({ length: count }, (_, i) => backupObject(i, ''));
    const client = { async send(command) {
      if (command.constructor.name === 'ListObjectsV2Command') {
        assert.equal(command.input.Prefix, ''); return { Contents: objects };
      }
      assert.deepEqual(command.input.Delete.Objects, [{ Key: objects[2].Key }, { Key: objects[1].Key }]);
      return { Errors: [{ Code: 'AccessDenied' }] };
    } };
    const task = pruneR2Backups(client, { bucket: 'backups', prefix: '' }, objects[0].Key);
    if (count === 12) await assert.rejects(task, /deletion/); else await task;
  }
});
test('retention warnings preserve backup success and reach existing notifications', async t => {
  const f = await fixture(t, { r2Upload: async () => ({ warning: '旧备份清理失败' }) });
  const c = (await f.configure(credentials)).data;
  const notification = (await f.request('/settings/notifications')).data;
  await f.request('/settings/notifications', 'PUT', { ...notification, enabled: true, url: 'https://example.com/hook', events: ['database_backup'] });
  const result = await f.request('/settings/r2-backup/run', 'POST', { version: c.version });
  assert.equal(result.status, 200); assert.equal(result.data.warning, '旧备份清理失败');
  const payload = JSON.parse(f.db.prepare("SELECT payload FROM notification_deliveries WHERE event='database_backup'").get().payload);
  assert.equal(payload.data.status, 'success'); assert.match(payload.message, /旧备份清理失败/);
});

test('R2 credentials trim clipboard whitespace and report invalid fields without exposing secrets', async t => {
  const f = await fixture(t);
  const saved = await f.configure({ ...credentials, access_key: ' \t' + credentials.access_key + '\r\n', secret_key: '\u00a0' + credentials.secret_key + '\uFEFF' });
  assert.equal(saved.status, 200);
  const stored = () => JSON.parse(f.db.prepare('SELECT config FROM r2_backup_settings').get().config);
  assert.equal(stored().access_key, credentials.access_key);
  assert.equal(stored().secret_key, credentials.secret_key);
  assert.equal((await f.configure({ access_key: '   ', secret_key: '\n' })).status, 200);
  assert.equal(stored().secret_key, credentials.secret_key);
  for (const [key, label] of [['access_key', 'R2 Access Key ID'], ['secret_key', 'R2 Secret Access Key']]) {
    for (const value of ['private secret', 'private\nsecret', 'private\u200bsecret', 'private\u0000secret', 'x'.repeat(4097), 123]) {
      const response = await f.configure({ [key]: value });
      assert.equal(response.status, 400);
      assert.ok(response.data.error.includes(label));
      assert.ok(!response.data.error.includes('private'));
    }
  }
  assert.equal((await f.configure({ clear_secret_key: true })).status, 200);
  assert.equal(stored().secret_key, '');
});
