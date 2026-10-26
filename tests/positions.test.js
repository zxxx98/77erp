import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createApp } from '../server/app.js';
import { legacyPermissions } from '../shared/permissions.js';

const password = 'Strong-password-123';
function oldDatabase(t, extra = '', cleanup = true) {
  const folder = mkdtempSync(join(tmpdir(), 'erp-positions-'));
  if (cleanup) t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'old.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    permissions TEXT, permissions_version INTEGER NOT NULL DEFAULT 1);`);
  const hash = scryptSync(password, 'salt', 64).toString('hex');
  const insert = db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1,?,?,?,1)');
  for (const [id, username, role, permissions] of [
    [1, 'owner', 'admin', null], [2, 'alice', 'employee', '["sale","purchase"]'],
    [3, 'bobby', 'employee', '["purchase","sale"]'], [4, 'finance', 'employee', '["finance"]'],
    [5, 'reader', 'employee', '[]'], [6, 'legacy', 'employee', null],
    [7, 'explicit', 'employee', JSON.stringify(legacyPermissions)],
  ]) insert.run(id, username, 'salt', hash, role, '2026-01-01', username, permissions);
  db.exec(extra);
  db.close();
  return path;
}
async function fixture(t, path = ':memory:') {
  const { app, db } = createApp(path);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); });
  const request = async (cookie, path, body, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  let admin = (await request(null, '/auth/setup', {username: 'owner', password})).cookie;
  if (!admin) admin = (await request(null, '/auth/login', {username: 'owner', password})).cookie;
  const position = async (name, permissions = []) => {
    const r = await request(admin, '/positions', {name, description: '', permissions});
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data;
  };
  const user = async (username, position_id) => {
    const r = await request(admin, '/users', {username, password, position_id});
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return {id: r.data.id, cookie: (await request(null, '/auth/login', {username, password})).cookie};
  };
  return {db, request, admin, position, user};
}

test('deployment migrates equal permissions together without merging legacy behavior, and never repeats', t => {
  const path = oldDatabase(t);
  let {db} = createApp(path);
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    assert.equal(users[0].position_id, null);
    assert.ok(users[1].position_id > 0);
    assert.equal(users[1].position_id, users[2].position_id);
    assert.notEqual(users[5].position_id, users[6].position_id);
    const positions = db.prepare('SELECT * FROM positions ORDER BY id').all();
    assert.equal(positions.length, 5);
    for (const user of users.slice(1)) {
      const p = positions.find(p => p.id === user.position_id);
      assert.deepEqual([...JSON.parse(p.permissions)].sort(), ['basic_view', ...(user.permissions == null ? legacyPermissions : JSON.parse(user.permissions))].sort());
      assert.equal(!!p.legacy_permissions, user.permissions == null);
    }
    assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='employee_positions_v1'").get().value, '1');
    db.prepare('UPDATE positions SET name=?,permissions=? WHERE id=?').run('管理员后来调整的仓管岗位', '["purchase"]', users[1].position_id);
    db.prepare('UPDATE users SET position_id=? WHERE id=3').run(users[3].position_id);
    // A later deliberate removal of the default job must not be undone on startup.
    db.prepare('UPDATE users SET position_id=? WHERE id=5').run(users[3].position_id);
    db.prepare('DELETE FROM positions WHERE id=?').run(users[4].position_id);
    const snapshot = {positions: db.prepare('SELECT * FROM positions ORDER BY id').all(), users: db.prepare('SELECT * FROM users ORDER BY id').all()};
    db.close();
    ({db} = createApp(path));
    assert.deepEqual(db.prepare('SELECT * FROM positions ORDER BY id').all(), snapshot.positions);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), snapshot.users);
  } finally { db.close(); }
});

test('failed migration rolls back associations, schema and completion marker; a later start can retry', t => {
  const path = oldDatabase(t, "CREATE TRIGGER stop_migration BEFORE UPDATE ON users WHEN NEW.id=4 BEGIN SELECT RAISE(ABORT,'simulate migration interruption'); END;");
  assert.throws(() => { const created = createApp(path); created.db.close(); }, /migration interruption/);
  let db = new DatabaseSync(path);
  assert.equal(db.prepare("SELECT 1 FROM app_metadata WHERE key='employee_positions_v1'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='positions'").get(), undefined);
  assert.equal(db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'position_id'), false);
  db.exec('DROP TRIGGER stop_migration'); db.close();
  ({db} = createApp(path));
  assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='employee_positions_v1'").get().value, '1');
  db.close();
});

test('invalid historical permissions stop migration instead of silently granting or dropping capabilities', t => {
  const path = oldDatabase(t, `UPDATE users SET permissions='["unknown"]' WHERE id=4;`);
  assert.throws(() => { const created = createApp(path); created.db.close(); }, /权限/);
  const db = new DatabaseSync(path);
  assert.equal(db.prepare("SELECT 1 FROM app_metadata WHERE key='employee_positions_v1'").get(), undefined);
  assert.equal(db.prepare('SELECT permissions FROM users WHERE id=4').get().permissions, '["unknown"]');
  db.close();
});

test('position changes update all member sessions, ignore retired individual grants and prevent stale edits', async t => {
  const f = await fixture(t);
  const p = await f.position('仓管', ['purchase', 'sale']);
  const a = await f.user('alice', p.id), b = await f.user('bobby', p.id);
  const other = await f.position('财务', ['finance']);
  const c = await f.user('carol', other.id);
  const state = async user => (await f.request(user.cookie, '/auth/status')).data;
  const before = await state(a);
  assert.equal(before.position_name, '仓管');
  const revision = (await f.request(a.cookie, '/updates')).data.revision;
  const changed = await f.request(f.admin, `/positions/${p.id}`, {...p, permissions: ['purchase']}, 'PUT');
  assert.equal(changed.status, 200);
  assert.equal(changed.data.member_count, 2);
  assert.deepEqual((await state(a)).permissions, ['purchase']);
  assert.deepEqual((await state(b)).permissions, ['purchase']);
  assert.deepEqual((await state(c)).permissions, ['finance']);
  assert.ok((await state(a)).permissions_version > before.permissions_version);
  assert.notEqual((await f.request(a.cookie, '/updates')).data.revision, revision);
  assert.equal((await f.request(a.cookie, '/orders', {type: 'out'})).status, 403);
  f.db.prepare('UPDATE users SET permissions=? WHERE id=?').run('["sale","finance"]', a.id);
  assert.deepEqual((await state(a)).permissions, ['purchase']);
  assert.equal((await f.request(f.admin, `/positions/${p.id}`, p, 'PUT')).status, 409);
  assert.equal((await f.request(f.admin, `/users/${a.id}/permissions`, {permissions: ['sale'], version: before.permissions_version}, 'PUT')).status, 409);
  assert.equal((await f.request(f.admin, `/positions/${p.id}`, {version: changed.data.version}, 'DELETE')).status, 409);
});

test('assignment requires current user version, revokes same-permission authorization, and missing position fails closed', async t => {
  const f = await fixture(t), p = await f.position('岗位甲', ['purchase']), q = await f.position('岗位乙', ['purchase']);
  const a = await f.user('alice', p.id);
  const original = (await f.request(a.cookie, '/auth/status')).data;
  assert.equal((await f.request(f.admin, `/users/${a.id}/position`, {position_id: q.id, version: original.permissions_version}, 'PUT')).status, 200);
  const next = (await f.request(a.cookie, '/auth/status')).data;
  assert.equal(next.position_id, q.id); assert.ok(next.permissions_version > original.permissions_version);
  assert.equal((await f.request(f.admin, `/users/${a.id}/position`, {position_id: p.id, version: original.permissions_version}, 'PUT')).status, 409);
  assert.equal((await f.request(f.admin, `/users/${a.id}`, {role: 'employee', active: 0}, 'PUT')).status, 200);
  assert.equal((await f.request(f.admin, `/positions/${q.id}`, {version: q.version}, 'DELETE')).status, 409);
  f.db.prepare('UPDATE users SET position_id=NULL,active=1,permissions=NULL WHERE id=?').run(a.id);
  const login = await f.request(null, '/auth/login', {username: 'alice', password});
  assert.deepEqual(login.data.permissions, []); assert.equal(login.data.legacy_permissions, false);
});

test('administrator-only position routes validate data and protect admin changes', async t => {
  const f = await fixture(t), p = await f.position('仓管');
  const a = await f.user('alice', p.id);
  for (const [path, method, body] of [['/positions','GET'], ['/positions','POST',{name:'越权',permissions:[]}],
    [`/positions/${p.id}`,'PUT',{...p,permissions:['finance']}], [`/positions/${p.id}`,'DELETE',{version:p.version}],
    [`/users/${a.id}/position`,'PUT',{position_id:p.id,version:1}]])
    assert.equal((await f.request(a.cookie, path, body, method)).status, 403);
  for (const body of [{name:'',permissions:[]}, {name:'a'.repeat(61),permissions:[]}, {name:'合法',description:'x'.repeat(201),permissions:[]},
    {name:'合法',permissions:['fake']}, {name:'合法',permissions:['sale','sale']}, {name:'合法',permissions:[],legacy_permissions:true}])
    assert.equal((await f.request(f.admin, '/positions', body)).status, 400);
  assert.equal((await f.request(f.admin, '/positions', {name:' 仓管 ',permissions:[]})).status, 409);
  assert.equal((await f.request(f.admin, '/users', {username:'nojob',password})).status, 400);
  assert.equal((await f.request(f.admin, '/users', {username:'badjob',password,position_id:999})).status, 400);
  assert.equal((await f.request(f.admin, '/users/1', {role:'employee',active:1,position_id:p.id}, 'PUT')).status, 409);
  const second = await f.request(f.admin, '/users', {username:'owner2',password,role:'admin'});
  assert.equal(second.status, 201);
  assert.equal((await f.request(f.admin, `/users/${second.data.id}`, {role:'employee',active:1}, 'PUT')).status, 400);
  assert.equal((await f.request(f.admin, `/users/${second.data.id}`, {role:'employee',active:1,position_id:p.id}, 'PUT')).status, 200);
  assert.equal((await f.request(f.admin, `/users/${second.data.id}`, {role:'admin',active:1}, 'PUT')).status, 200);
  assert.equal(f.db.prepare('SELECT position_id FROM users WHERE id=?').get(second.data.id).position_id, null);
  const unused = await f.position('可删除');
  assert.equal((await f.request(f.admin, `/positions/${unused.id}`, {version:unused.version}, 'DELETE')).status, 200);
  assert.ok(f.db.prepare('SELECT COUNT(*) n FROM position_changes').get().n > 0);
});

test('legacy positions preserve old rules until explicit conversion, including renamed positions', async t => {
  const path = oldDatabase(t, '', false), f = await fixture(t, path);
  t.after(() => rmSync(dirname(path), {recursive:true,force:true}));
  const employee = await f.request(null, '/auth/login', {username:'legacy',password});
  assert.equal(employee.data.legacy_permissions, true);
  let p = (await f.request(f.admin, '/positions')).data.find(p => p.id === employee.data.position_id);
  const renamed = await f.request(f.admin, `/positions/${p.id}`, {...p,name:'保留旧员工'}, 'PUT');
  assert.equal(renamed.status,200); p = renamed.data;
  assert.equal(p.legacy_permissions,true);
  assert.equal((await f.request(employee.cookie, '/categories', {name:'不允许旧员工管理分类'})).status,403);
  assert.equal((await f.request(f.admin, `/positions/${p.id}`, {...p,permissions:['products']},'PUT')).status,409);
  const converted = await f.request(f.admin, `/positions/${p.id}`, {...p,permissions:['products'],convert_legacy:true},'PUT');
  assert.equal(converted.status,200); assert.equal(converted.data.legacy_permissions,false);
  const next = (await f.request(employee.cookie, '/auth/status')).data;
  assert.equal(next.legacy_permissions,false); assert.deepEqual(next.permissions,['products']);
});

test('business reset and restore preserve positions, assignments, audit and migration marker', async t => {
  const f = await fixture(t), p = await f.position('独立账号配置', ['products']);
  await f.user('alice', p.id);
  const snapshot = () => ({
    positions:f.db.prepare('SELECT * FROM positions ORDER BY id').all(),
    users:f.db.prepare('SELECT * FROM users ORDER BY id').all(),
    changes:f.db.prepare('SELECT * FROM position_changes ORDER BY id').all(),
    marker:f.db.prepare("SELECT value FROM app_metadata WHERE key='employee_positions_v1'").get(),
  });
  const saved = snapshot();
  const backup = (await f.request(f.admin, '/backup')).data;
  assert.equal(backup.data.positions, undefined);
  assert.equal((await f.request(f.admin, '/settings/reset', {confirmation:'RESET_BUSINESS_DATA'})).status, 200);
  assert.deepEqual(snapshot(), saved);
  const preview = await f.request(f.admin, '/backup/preview', {backup});
  assert.equal(preview.status, 200);
  const restored = await f.request(f.admin, '/backup/restore', {backup,token:preview.data.token,current_token:preview.data.current_token,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()});
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(snapshot(), saved);
});

test('existing login sessions and pre-upgrade user revision triggers keep following position updates', async t => {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const path = oldDatabase(t, `
    CREATE TABLE app_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE data_revisions (scope TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TRIGGER data_revision_users_UPDATE AFTER UPDATE ON users
      WHEN OLD.permissions_version IS NOT NEW.permissions_version
      BEGIN INSERT INTO data_revisions VALUES('user:' || NEW.id,1)
      ON CONFLICT(scope) DO UPDATE SET revision=revision+1; END;
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    INSERT INTO auth_sessions VALUES('${hash}',2,${Date.now() + 600000});
  `, false);
  const f = await fixture(t, path);
  t.after(() => rmSync(dirname(path), {recursive:true,force:true}));
  const cookie = `77erp_session=${token}`;
  const before = (await f.request(cookie, '/auth/status')).data;
  assert.equal(before.authenticated, true);
  assert.deepEqual(before.permissions, ['basic_view','purchase','sale']);
  const revision = (await f.request(cookie, '/updates')).data.revision;
  const position = (await f.request(f.admin, '/positions')).data.find(p => p.id === before.position_id);
  assert.equal((await f.request(f.admin, `/positions/${position.id}`, {...position,permissions:['purchase']}, 'PUT')).status, 200);
  assert.notEqual((await f.request(cookie, '/updates')).data.revision, revision);
  const after = (await f.request(cookie, '/auth/status')).data;
  assert.deepEqual(after.permissions, ['purchase']);
  assert.ok(after.permissions_version > before.permissions_version);
  assert.equal((await f.request(cookie, '/orders', {type:'out'})).status,403);
});

test('deleting a position during employee creation cannot leave an orphan or crash after password hashing', async t => {
  const f = await fixture(t), p = await f.position('并发岗位');
  const [created, deleted] = await Promise.all([
    f.request(f.admin, '/users', {username:'racing',password,position_id:p.id}),
    f.request(f.admin, `/positions/${p.id}`, {version:p.version}, 'DELETE'),
  ]);
  if (deleted.status === 200) {
    assert.equal(created.status,400);
    assert.equal(f.db.prepare("SELECT 1 FROM users WHERE username='racing'").get(),undefined);
  } else {
    assert.equal(deleted.status,409); assert.equal(created.status,201);
    assert.equal(f.db.prepare('SELECT position_id FROM users WHERE id=?').get(created.data.id).position_id,p.id);
    assert.ok(f.db.prepare('SELECT 1 FROM positions WHERE id=?').get(p.id));
  }
});
