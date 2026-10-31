import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { createApp } from '../server/app.js';
import { listProductionOrders, getProductionOrder } from '../server/production.js';

const worker = group => ({role:'employee',permissions:['production_register'], production_group_id:group});
test('production external reads reject unauthorized callers and ungrouped workers see no orders', () => {
  const {db} = createApp(':memory:');
  try {
    assert.throws(() => listProductionOrders(db,1,{},false,{role:'employee',permissions:[]}), error => error.status === 403);
    assert.deepEqual(listProductionOrders(db,1,{},false,worker(null)).orders, []);
    assert.throws(() => getProductionOrder(db,1,1,false,worker(null)), error => error.status === 404);
  } finally {db.close();}
});

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId || 1),
        ...(options.cookie === null ? {} : { Cookie: options.cookie || cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = options.method === 'HEAD' ? null : await response.json();
    // These regressions deliberately retain historical direct-stock production semantics.
    // Only test fixtures tag persisted rows; API requests cannot opt out of the new workflow.
    if (path === '/production-orders' && body !== undefined && response.status === 200) {
      db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(data.id);
      data.material_workflow = 0;
    }
    // Existing accounting regressions exercise posted output by explicitly approving
    // the new receipt through the warehouse API. Future batches never bypass approval.
    if (response.status === 200 && /\/production-orders\/\d+\/complete$/.test(path) && !options.pendingReceipt) {
      const current = (await request(`/production-orders/${data.id}`, undefined, options)).data;
      for (const doc of current.receipt_documents || []) if (doc.status === 'pending') {
        const approved = await request(`/production-receipts/${doc.id}/confirm`, {version:doc.version,request_id:randomUUID()});
        assert.equal(approved.status,200,JSON.stringify(approved.data));
      }
      data = {...(await request(`/production-orders/${data.id}`, undefined, options)).data, captured_at: data.captured_at};
    }
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  cookie = (await request('/auth/setup', { username: 'productionadmin', password: 'Test-admin-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const command = (path, body, options) => request(path, { request_id: randomUUID(), ...body }, options);
  const product = async (barcode, warehouseId = 1, extra = {}) => {
    const result = await request('/products', { name: `物料 ${barcode}`, barcode, category: '生产', unit: '件', cost: 1, price: 2, threshold: 0, ...extra }, { warehouseId });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.id;
  };
  const parent = await product('FINISHED'), material = await product('MATERIAL'), second = await product('SECOND');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=12345 WHERE id=?').run(material);
  db.prepare('UPDATE products SET stock=50,inventory_value_cents=5000 WHERE id=?').run(second);
  const definition = (extra = {}) => ({ name: '生产测试配方', product_id: parent, base_quantity: 2, base_unit: '件', note: '', enabled: 1,
    items: [{ product_id: material, quantity: 3, unit: '件', note: '材料备注' }, { product_id: second, quantity: 0.2, unit: '件', note: '' }], ...extra });
  const bom = ok(await command('/boms', definition()));
  const plan = extra => ({ bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '生产备注', ...extra });
  const create = async extra => ok(await command('/production-orders', plan(extra)));
  const completion = (order, extra) => ({ version: order.version, completed_quantity: 9,
    items: [{ product_id: material, quantity: 16 }, { product_id: second, quantity: 1.5 }], ...extra });
  const complete = async order => ok(await command(`/production-orders/${order.id}/complete`, completion(order)));
  const inventory = () => db.prepare('SELECT id,stock,inventory_value_cents,version FROM products ORDER BY id').all();
  return { db, request, command, ok, product, parent, material, second, bom, definition, plan, create, completion, complete, inventory };
}


async function organization(f) {
  const at = new Date().toISOString();
  const group = name => Number(f.db.prepare('INSERT INTO production_groups(name,description,created_at,updated_at) VALUES (?,\'\',?,?)').run(name,at,at).lastInsertRowid);
  const a=group('A组'), b=group('B组');
  const user = async (username, permissions, groupId) => {
    const created = await f.request('/users', {position_id:readonlyPositionId(f.db),username,employee_no:username,password:'Test-staff-123'});
    assert.equal(created.status,201,JSON.stringify(created.data)); const row=created.data;
    f.ok(await grantPosition(f.db,(path,body,method)=>f.request(path,body,{method}),row.id,permissions));
    f.db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(groupId,row.id);
    const cookie=(await f.request('/auth/login',{username,password:'Test-staff-123'},{cookie:null})).cookie;
    return {id:row.id,cookie};
  };
  const employee=await user('groupworker',['production_register','finance'],a), warehouse=await user('warehouseworker',['sale','purchase'],b);
  const assign=async (order, groupId, body={}) => f.command(`/production-orders/${order.id}/assign`,{version:order.version,schema_version:2,production_group_id:groupId,...body});
  return {a,b,employee,warehouse,assign,user};
}

test('group workers see and register only their group; snapshots and replay revocation are enforced', async t => {
  const f=await fixture(t), g=await organization(f);
  let a=f.ok(await g.assign(await f.create(),g.a)), b=f.ok(await g.assign(await f.create(),g.b));
  const options={cookie:g.employee.cookie,pendingReceipt:true};
  assert.equal((await f.request(`/Production-orders/${a.id}/`,undefined,{...options,method:'HEAD'})).status,200);
  assert.equal((await f.request(`/Production-orders/${b.id}/`,undefined,{...options,method:'HEAD'})).status,404);
  const listed=f.ok(await f.request('/production-orders',undefined,options));
  assert.deepEqual(listed.orders.map(o=>o.id),[a.id]);
  assert.equal((await f.request(`/production-orders/${b.id}`,undefined,options)).status,404);
  assert.equal((await f.request(`/Production-orders/${b.id}/`,undefined,options)).status,404);
  assert.equal((await f.command(`/Production-orders/${b.id}/complete/`,f.completion(b,{finish_order:false}),options)).status,404);
  assert.equal((await f.command(`/production-orders/${b.id}/complete`,f.completion(b,{finish_order:false}),options)).status,404);
  const detail=f.ok(await f.request(`/production-orders/${a.id}`,undefined,options));
  assert.equal(detail.items[0].product.stock,undefined);
  assert.equal(detail.items[0].cost_cents,undefined);
  for (const suffix of ['start','finish','void','delete','assign']) assert.equal((await f.command(`/production-orders/${a.id}/${suffix}`,{version:a.version},options)).status,403,suffix);
  assert.equal((await f.command(`/production-orders/${a.id}/complete`,f.completion(a),options)).status,403);
  const excessive=f.completion(a,{finish_order:false,items:[{product_id:f.material,quantity:101},{product_id:f.second,quantity:1}]});
  const denied=await f.command(`/production-orders/${a.id}/complete`,excessive,options);
  assert.equal(denied.status,400);
  assert.doesNotMatch(denied.data.error,/100|当前/);
  assert.match((await f.command(`/production-orders/${a.id}/complete`,excessive)).data.error,/当前 100/);
  const body={...f.completion(a,{finish_order:false}),request_id:randomUUID()};
  const done=f.ok(await f.request(`/production-orders/${a.id}/complete`,body,options));
  assert.equal(done.batches[0].created_by,g.employee.id);
  assert.equal(done.batches[0].production_group_id,g.a);
  assert.equal(done.batches[0].production_group_name,'A组');
  assert.equal(done.batches[0].total_cost_cents,undefined);
  assert.equal((await f.request(`/production-orders/${a.id}/complete`,body,options)).status,200);
  f.db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(g.b,g.employee.id);
  assert.equal((await f.request(`/production-orders/${a.id}/complete`,body,options)).status,404);
  f.db.prepare('UPDATE users SET production_group_id=NULL WHERE id=?').run(g.employee.id);
  assert.deepEqual(f.ok(await f.request('/production-orders',undefined,options)).orders,[]);
  const external={role:'employee',permissions:['production_register'],production_group_id:g.b};
  assert.deepEqual(listProductionOrders(f.db,1,{},true,external).orders.map(o=>o.id),[b.id]);
  assert.throws(()=>getProductionOrder(f.db,1,a.id,true,external),error=>error.status===404);
});

test('dispatch versions reject replacement after start; warehouse approval remains cross-group', async t => {
  const f=await fixture(t), g=await organization(f), initial=await f.create();
  const memberBefore=f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(g.employee.id).permissions_version;
  const assigned=f.ok(await g.assign(initial,g.a));
  assert.notEqual(assigned.version,initial.version);
  assert.ok(f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(g.employee.id).permissions_version>memberBefore);
  assert.equal((await g.assign(initial,g.b)).status,409);
  const body={version:assigned.version,schema_version:2,production_group_id:g.b,request_id:randomUUID()};
  const moved=f.ok(await f.request(`/production-orders/${initial.id}/assign`,body));
  assert.equal(moved.production_group_id,g.b);
  assert.equal((await f.request(`/production-orders/${initial.id}/assign`,body)).status,200);
  f.db.prepare('UPDATE production_orders SET material_workflow=1 WHERE id=?').run(initial.id);
  const started=f.ok(await f.command(`/production-orders/${initial.id}/start`,{version:moved.version}));
  assert.equal((await g.assign(started,g.a)).status,409);
  f.db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(g.a,g.warehouse.id);
  f.db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(g.b,g.employee.id);
  const queue=f.ok(await f.request('/production-material-documents?type=out',undefined,{cookie:g.warehouse.cookie}));
  assert.equal(queue.documents[0].production_group_name,'B组');
  const document=started.material_documents[0];
  assert.equal((await f.command(`/production-material-documents/${document.id}/confirm`,{version:document.version},{cookie:g.warehouse.cookie})).status,200);
  const active=f.ok(await f.request(`/production-orders/${initial.id}`));
  const registered=f.ok(await f.command(`/production-orders/${initial.id}/complete`,f.completion(active,{finish_order:false,items:[{product_id:f.material,quantity:14},{product_id:f.second,quantity:1}]}),{cookie:g.employee.cookie,pendingReceipt:true}));
  f.db.prepare('UPDATE users SET production_group_id=NULL WHERE id=?').run(g.warehouse.id);
  const receipt=registered.receipt_documents[0];
  assert.equal((await f.command(`/production-receipts/${receipt.id}/confirm`,{version:receipt.version},{cookie:g.warehouse.cookie})).status,200);
  const current=f.ok(await f.request(`/production-orders/${initial.id}`));
  const requested=f.ok(await f.command(`/production-orders/${initial.id}/material-requests`,{version:current.version,type:'in',items:[{product_id:f.material,quantity:1}],note:'剩余材料退回'}));
  const returned=requested.material_documents.at(-1);
  assert.equal(returned.production_group_id,g.b);
  assert.equal((await f.command(`/production-material-documents/${returned.id}/confirm`,{version:returned.version},{cookie:g.warehouse.cookie})).status,200);
});



test('creation validates optional group and dispatch accepts explicit unassignment only with protocol version', async t => {
  const f=await fixture(t), g=await organization(f);
  const order=await f.create({production_group_id:g.a});
  assert.equal(order.production_group_id,g.a);
  assert.equal(order.production_group_name,'A组');
  assert.equal((await f.command('/production-orders',f.plan({production_group_id:'bad'}))).status,400);
  assert.equal((await f.command('/production-orders',f.plan({production_group_id:999999}))).status,404);
  assert.equal((await g.assign(order,g.b,{schema_version:1})).status,409);
  assert.equal((await f.command(`/production-orders/${order.id}/assign`,{version:order.version,schema_version:2})).status,400);
  const cleared=f.ok(await g.assign(order,null));
  assert.equal(cleared.production_group_id,null);
  assert.equal(cleared.production_group_name,'');
  const options={cookie:g.employee.cookie,pendingReceipt:true};
  assert.equal((await f.command('/production-orders',f.plan(),options)).status,403);
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,options)).status,404);
});


test('started orders accept multiple groups and people, including ungrouped workers, without changing accounting or past batches', async t => {
  const f=await fixture(t), g=await organization(f);
  const bworker=await g.user('second-group-worker',['production_register'],g.b);
  const individual=await g.user('individual-worker',['production_register'],null);
  const outsider=await g.user('outsider-worker',['production_register'],null);
  let order=await f.create({production_group_id:g.a});
  f.db.prepare('UPDATE production_orders SET material_workflow=1 WHERE id=?').run(order.id);
  order=f.ok(await f.command(`/production-orders/${order.id}/start`,{version:order.version}));
  const before=f.inventory(), materialDocs=order.material_documents;
  const assign=(current, groups, people, options)=>f.command(`/production-orders/${current.id}/assign`,{version:current.version,schema_version:2,production_group_ids:groups,user_ids:people},options);
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,{cookie:individual.cookie})).status,404);
  const body={version:order.version,schema_version:2,production_group_ids:[g.a,g.b],user_ids:[individual.id],request_id:randomUUID()};
  order=f.ok(await f.request(`/production-orders/${order.id}/assign`,body));
  assert.deepEqual(order.assigned_groups.map(group=>group.id),[g.a,g.b]);
  assert.deepEqual(order.assigned_users.map(user=>user.id),[individual.id]);
  assert.deepEqual(f.inventory(),before);
  assert.deepEqual(order.material_documents,materialDocs);
  assert.equal((await f.request(`/production-orders/${order.id}/assign`,body)).status,200);
  assert.equal((await assign(order,[g.a],[])).status,409);
  assert.equal((await assign(order,[g.a,g.b],[individual.id],{cookie:individual.cookie})).status,403);
  for(const user of [g.employee,bworker,individual]) {
    const options={cookie:user.cookie};
    assert.deepEqual(f.ok(await f.request('/production-orders',undefined,options)).orders.map(row=>row.id),[order.id]);
    const detail=f.ok(await f.request(`/production-orders/${order.id}`,undefined,options));
    assert.equal(detail.items[0].product.stock,undefined);
    assert.equal(detail.items[0].cost_cents,undefined);
  }
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,{cookie:outsider.cookie})).status,404);
  const doc=order.material_documents[0];
  f.ok(await f.command(`/production-material-documents/${doc.id}/confirm`,{version:doc.version}));
  order=f.ok(await f.request(`/production-orders/${order.id}`));
  const complete=async(user, current)=>f.ok(await f.command(`/production-orders/${current.id}/complete`,{...f.completion(current),completed_quantity:1,finish_order:false,items:[{product_id:f.material,quantity:1.5},{product_id:f.second,quantity:0.1}]},{cookie:user.cookie,pendingReceipt:true}));
  order=await complete(bworker,order);
  assert.equal(order.batches[0].production_group_id,g.b);
  assert.equal(order.batches[0].production_group_name,'B组');
  const firstBatch=f.db.prepare('SELECT * FROM production_batches WHERE production_id=?').get(order.id);
  order=f.ok(await assign(order,[g.a,g.b],[individual.id,outsider.id]));
  assert.deepEqual(f.db.prepare('SELECT * FROM production_batches WHERE id=?').get(firstBatch.id),firstBatch);
  order=await complete(individual,order);
  assert.equal(order.batches[1].created_by,individual.id);
  assert.equal(order.batches[1].production_group_id,null);
  assert.equal(order.batches[1].production_group_name,'');
  const staff=f.db.prepare('SELECT permissions_version FROM users WHERE id=?').get(individual.id);
  assert.ok(staff.permissions_version>1);
  f.db.prepare("UPDATE positions SET permissions='[]' WHERE id=(SELECT position_id FROM users WHERE id=?)").run(individual.id);
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,{cookie:individual.cookie})).status,403);
  order=f.ok(await f.command(`/production-orders/${order.id}/finish`,{version:order.version}));
  assert.equal((await assign(order,[g.a,g.b],[individual.id,outsider.id])).status,409);
});

test('multi-assignment validates recipients, preserves legacy creation and protects secondary groups', async t => {
  const f=await fixture(t), g=await organization(f);
  const person=await g.user('personal-assignee',['production_register'],null);
  const order=await f.create({production_group_ids:[g.a,g.b],user_ids:[person.id]});
  assert.equal(order.production_group_id,g.a);
  assert.deepEqual(order.assigned_groups.map(group=>group.id),[g.a,g.b]);
  assert.equal(order.assigned_users[0].id,person.id);
  const position=f.db.prepare('SELECT version FROM production_groups WHERE id=?').get(g.b);
  assert.equal((await f.request(`/production-groups/${g.b}`,{version:position.version},{method:'DELETE'})).status,409);
  for(const extra of [{production_group_ids:null},{production_group_ids:[g.a,g.a]},{user_ids:[person.id,person.id]},{user_ids:['1']},{user_ids:[999999]},{user_ids:[g.warehouse.id]}])
    assert.equal((await f.command('/production-orders',f.plan(extra))).status,400,JSON.stringify(extra));
  const options=f.ok(await f.request('/production-orders/assignment-options'));
  assert.ok(options.users.some(user=>user.id===person.id));
  assert.ok(!options.users.some(user=>user.id===g.warehouse.id));
  assert.equal((await f.request('/production-orders/assignment-options',undefined,{cookie:person.cookie})).status,403);
  const cleared=f.ok(await g.assign(order,null));
  assert.deepEqual(cleared.assigned_groups,[]);
  assert.deepEqual(cleared.assigned_users,[]);
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,{cookie:person.cookie})).status,404);
});

test('assignment backups migrate old single-group orders and never grant cross-instance recipients', async t => {
  const f=await fixture(t), g=await organization(f), person=await g.user('backup-assignee',['production_register'],null);
  const order=await f.create({production_group_ids:[g.a,g.b],user_ids:[person.id]});
  const backup=f.ok(await f.request('/backup'));
  assert.equal(backup.version,41);
  const restore=async backup=>{ const preview=await f.command('/backup/preview',{backup}); if(preview.status!==200)return preview; return f.command('/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA'}); };
  const invalid=structuredClone(backup);invalid.data.production_orders[0].assigned_users='[{"id":1,"name":"x"},{"id":1,"name":"x"}]';
  assert.equal((await restore(invalid)).status,400);
  f.ok(await restore(backup));
  assert.equal(f.ok(await f.request(`/production-orders/${order.id}`,undefined,{cookie:person.cookie})).assigned_users[0].id,person.id);
  const old=structuredClone(backup);old.version=40;
  for(const row of old.data.production_orders){delete row.assigned_groups;delete row.assigned_users;}
  f.ok(await restore(old));
  assert.deepEqual(f.ok(await f.request(`/production-orders/${order.id}`)).assigned_groups.map(group=>group.id),[g.a]);
  const foreign=structuredClone(backup);foreign.source_instance_id=randomUUID();
  f.ok(await restore(foreign));
  const restored=f.ok(await f.request(`/production-orders/${order.id}`));
  assert.equal(restored.production_group_id,null);
  assert.deepEqual(restored.assigned_groups,[]);
  assert.deepEqual(restored.assigned_users,[]);
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,{cookie:person.cookie})).status,404);
});
