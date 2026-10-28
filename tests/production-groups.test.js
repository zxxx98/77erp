import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateProductionGroups } from '../server/production-groups.js';

const password = 'Strong-password-123';
async function fixture(t) {
  const {app,db} = createApp(':memory:');
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const request = async (cookie,path,body,method=body === undefined ? 'GET':'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {method,
      headers:{'Content-Type':'application/json',...(cookie ? {Cookie:cookie}:{})},body:body === undefined ? undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const admin = (await request(null,'/auth/setup',{username:'owner',password})).cookie;
  const group = async name => { const r=await request(admin,'/production-groups',{name}); assert.equal(r.status,201,JSON.stringify(r.data)); return r.data; };
  const position = async (name,permissions=[],access_mode='standard') => {
    const r=await request(admin,'/positions',{name,permissions,access_mode}); assert.equal(r.status,201,JSON.stringify(r.data)); return r.data;
  };
  const user = async (username,position_id,production_group_id=null) => {
    const r=await request(admin,'/users',{username,password,position_id,production_group_id}); assert.equal(r.status,201,JSON.stringify(r.data));
    const login=await request(null,'/auth/login',{username,password}); return {...login.data,id:r.data.id,cookie:login.cookie};
  };
  return {db,request,admin,group,position,user};
}

test('groups support optional membership, versioned edits and protected deletion',async t => {
  const f=await fixture(t), a=await f.group('一组'), b=await f.group('二组');
  const p=await f.position('仓管',['purchase','sale']), worker=await f.user('worker',p.id);
  assert.equal(worker.production_group_id,null);
  let r=await f.request(f.admin,`/users/${worker.id}/production-group`,{production_group_id:a.id,version:worker.permissions_version},'PUT');
  assert.equal(r.status,200);
  let current=(await f.request(worker.cookie,'/auth/status')).data;
  assert.equal(current.production_group_id,a.id); assert.equal(current.production_group_name,'一组');
  assert.ok(current.permissions_version>worker.permissions_version);
  r=await f.request(f.admin,`/users/${worker.id}/production-group`,{production_group_id:b.id,version:worker.permissions_version},'PUT');
  assert.equal(r.status,409);
  assert.equal((await f.request(f.admin,`/production-groups/${a.id}`,{version:a.version},'DELETE')).status,409);
  r=await f.request(f.admin,`/production-groups/${a.id}`,{name:'装配组',version:a.version},'PUT');
  assert.equal(r.status,200); assert.equal(r.data.name,'装配组');
  assert.equal((await f.request(f.admin,`/production-groups/${a.id}`,{name:'旧表单',version:a.version},'PUT')).status,409);
  assert.equal((await f.request(worker.cookie,'/production-groups')).status,403);
  assert.equal((await f.request(worker.cookie,'/production-groups',{name:'越权'})).status,403);
  current=(await f.request(worker.cookie,'/auth/status')).data;
  assert.equal((await f.request(f.admin,`/users/${worker.id}/production-group`,{production_group_id:null,version:current.permissions_version},'PUT')).status,200);
  assert.equal((await f.request(f.admin,`/production-groups/${a.id}`,{version:r.data.version},'DELETE')).status,200);
  assert.equal((await f.request(f.admin,'/users',{username:'invalid',password,position_id:p.id,production_group_id:999})).status,400);
});

test('production-only positions deny all other business endpoints and expose minimal bootstrap',async t => {
  const f=await fixture(t);
  const p=await f.position('仅生产',['production_register'],'production_only');
  const worker=await f.user('worker',p.id);
  assert.equal(worker.access_mode,'production_only');
  assert.equal((await f.request(f.admin,'/positions',{name:'混合权限',permissions:['production_register','purchase'],access_mode:'production_only'})).status,400);
  for(const path of ['/data','/products','/orders','/dashboard','/categories','/contacts','/templates','/warehouses','/announcements','/ai/conversations','/production-groups','/production-material-documents','/production-receipts','/production-orders/boms'])
    assert.equal((await f.request(worker.cookie,path)).status,403,path);
  const workspace=await f.request(worker.cookie,'/workspace');
  assert.equal(workspace.status,200); assert.deepEqual(workspace.data.categories,[]);
  assert.equal(workspace.data.settings.stock_expression,undefined);
  assert.equal(workspace.data.settings.usd_cny_rate,undefined);
  assert.equal(workspace.data.settings.base_currency,undefined);
  assert.equal(workspace.data.settings.r2_secret_access_key,undefined);
  assert.equal((await f.request(worker.cookie,'/updates')).status,200);
  assert.equal((await f.request(worker.cookie,'/style')).status,200);
  const basic=await f.position('基础读取',['basic_view']), standard=await f.user('reader',basic.id);
  assert.equal((await f.request(standard.cookie,'/products')).status,200);
  assert.equal((await f.request(f.admin,`/positions/${basic.id}`,{name:basic.name,permissions:['production_register'],access_mode:'production_only',version:basic.version},'PUT')).status,200);
  assert.equal((await f.request(standard.cookie,'/products')).status,403);
  assert.ok((await f.request(standard.cookie,'/auth/status')).data.permissions_version>standard.permissions_version);
});

test('group migration runs once and keeps existing authorization and deliberate memberships',async t => {
  const f=await fixture(t), a=await f.group('一组'), p=await f.position('生产主管',['production']), u=await f.user('worker',p.id,a.id);
  assert.equal(f.db.prepare("SELECT value FROM app_metadata WHERE key='production_groups_v1'").get()?.value,'1');
  const {migrateProductionGroups}=await import('../server/production-groups.js');
  const before={users:f.db.prepare('SELECT * FROM users').all(),positions:f.db.prepare('SELECT * FROM positions').all(),groups:f.db.prepare('SELECT * FROM production_groups').all()};
  migrateProductionGroups(f.db);
  assert.deepEqual(f.db.prepare('SELECT * FROM users').all(),before.users);
  assert.deepEqual(f.db.prepare('SELECT * FROM positions').all(),before.positions);
  assert.deepEqual(f.db.prepare('SELECT * FROM production_groups').all(),before.groups);
  assert.deepEqual(u.permissions,['production']); assert.equal(u.access_mode,'standard');
});

test('interrupted group migration rolls back its entire schema and can retry without losing old data',() => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,permissions_version INTEGER);
      CREATE TABLE positions(id INTEGER PRIMARY KEY,name TEXT,permissions TEXT);
      CREATE TABLE production_orders(id INTEGER PRIMARY KEY,warehouse_id INTEGER);
      CREATE TABLE production_batches(id INTEGER PRIMARY KEY,created_by_name TEXT);
      INSERT INTO users VALUES(1,'worker',7); INSERT INTO positions VALUES(1,'原岗位','["production"]');
      INSERT INTO production_orders VALUES(1,1); INSERT INTO production_batches VALUES(1,'原登记人');
      CREATE TRIGGER interrupt_groups BEFORE INSERT ON app_metadata WHEN NEW.key='production_groups_v1'
      BEGIN SELECT RAISE(ABORT,'interrupted group upgrade'); END;`);
    assert.throws(() => migrateProductionGroups(db),/interrupted group upgrade/);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='production_groups'").get(),undefined);
    assert.equal(db.prepare('PRAGMA table_info(users)').all().some(c => c.name==='production_group_id'),false);
    assert.equal(db.prepare("SELECT 1 FROM app_metadata WHERE key='production_groups_v1'").get(),undefined);
    db.exec('DROP TRIGGER interrupt_groups');
    migrateProductionGroups(db);
    assert.equal(db.prepare('SELECT production_group_id FROM users WHERE id=1').get().production_group_id,null);
    assert.equal(db.prepare('SELECT production_group_id FROM production_orders WHERE id=1').get().production_group_id,null);
    assert.equal(db.prepare('SELECT created_by_name FROM production_batches WHERE id=1').get().created_by_name,'原登记人');
    assert.equal(db.prepare('SELECT permissions FROM positions WHERE id=1').get().permissions,'["production"]');
    assert.equal(db.prepare('SELECT permissions_version FROM users WHERE id=1').get().permissions_version,7);
  } finally { db.close(); }
});

test('standard group registration without basic view matches isolated production access; grants and revocations apply immediately', async t => {
  const f = await fixture(t), group = await f.group('登记组');
  const position = await f.position('普通登记', ['production_register']);
  const worker = await f.user('standard-worker', position.id, group.id);
  assert.equal(worker.access_mode, 'standard');
  for (const path of ['/data', '/products', '/products/1', '/products/1/history', '/orders', '/orders/1', '/dashboard', '/categories', '/contacts', '/templates', '/warehouses', '/announcements', '/announcements/unread-count']) {
    assert.equal((await f.request(worker.cookie, path)).status, 403, path);
  }
  assert.equal((await f.request(worker.cookie, '/production-orders')).status, 200);
  const workspace = (await f.request(worker.cookie, '/workspace')).data;
  assert.deepEqual(workspace.categories, []);
  assert.equal(workspace.settings.stock_expression, undefined);
  assert.deepEqual(Object.keys(workspace.warehouses[0]).sort(), ['id', 'name']);
  const granted = await f.request(f.admin, `/positions/${position.id}`, {
    name: position.name, version: position.version, permissions: ['basic_view', 'production_register']
  }, 'PUT');
  assert.equal(granted.status, 200);
  for (const path of ['/data', '/products', '/orders', '/dashboard', '/announcements'])
    assert.equal((await f.request(worker.cookie, path)).status, 200, path);
  assert.equal((await f.request(worker.cookie, '/products', {})).status, 403);
  const revoked = await f.request(f.admin, `/positions/${position.id}`, {
    name: position.name, version: granted.data.version, permissions: []
  }, 'PUT');
  assert.equal(revoked.status, 200);
  assert.equal((await f.request(worker.cookie, '/products')).status, 403);
  assert.equal((await f.request(worker.cookie, '/production-orders')).status, 403);
  assert.equal((await f.request(worker.cookie, '/workspace')).status, 200);
});

test('basic page migration preserves standard access once and never expands production-only positions', async t => {
  const f = await fixture(t);
  const standard = await f.position('旧普通岗位', ['production_register']);
  const isolated = await f.position('旧生产岗位', ['production_register'], 'production_only');
  const user = await f.user('migration-worker', standard.id);
  f.db.prepare("DELETE FROM app_metadata WHERE key='position_basic_view_v1'").run();
  const { migrateBasicView } = await import('../server/positions.js');
  migrateBasicView(f.db);
  const current = f.db.prepare('SELECT * FROM positions WHERE id=?').get(standard.id);
  assert.deepEqual(JSON.parse(current.permissions), ['basic_view', 'production_register']);
  assert.equal(current.version, standard.version + 1);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT permissions FROM positions WHERE id=?').get(isolated.id).permissions), ['production_register']);
  assert.ok((await f.request(user.cookie, '/auth/status')).data.permissions_version > user.permissions_version);
  f.db.prepare("UPDATE positions SET permissions='[]' WHERE id=?").run(standard.id);
  migrateBasicView(f.db);
  assert.equal(f.db.prepare('SELECT permissions FROM positions WHERE id=?').get(standard.id).permissions, '[]');
});

test('mixed positions combine workspace access and secondary production grants qualify for assignment', async t => {
  const f=await fixture(t);
  const normal=await f.position('普通员工',['basic_view']), worker=await f.position('生产登记',['production_register'],'production_only');
  const user=await f.user('multiworker',normal.id);
  assert.equal((await f.request(f.admin,'/production-orders/assignment-options')).data.users.some(row=>row.id===user.id),false);
  const assign=async ids=>{
    const current=(await f.request(user.cookie,'/auth/status')).data;
    assert.equal((await f.request(f.admin,`/users/${user.id}/position`,{position_ids:ids,version:current.permissions_version},'PUT')).status,200);
    return (await f.request(user.cookie,'/auth/status')).data;
  };
  let current=await assign([normal.id,worker.id]);
  assert.equal(current.access_mode,'standard');
  assert.deepEqual(current.permissions,['basic_view','production_register']);
  assert.equal((await f.request(user.cookie,'/products')).status,200);
  assert.equal((await f.request(f.admin,'/production-orders/assignment-options')).data.users.filter(row=>row.id===user.id).length,1);
  const other=await f.position('第二生产岗位',['production_register'],'production_only');
  current=await assign([worker.id,other.id]);
  assert.equal(current.access_mode,'production_only');
  assert.equal((await f.request(user.cookie,'/products')).status,403);
  assert.equal((await f.request(user.cookie,'/production-orders')).status,200);
  await assign([normal.id]);
  assert.equal((await f.request(f.admin,'/production-orders/assignment-options')).data.users.some(row=>row.id===user.id),false);
});
