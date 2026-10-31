import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { validateProcessGraph, arrangeProcessGraph } from '../shared/process-routes.js';

const node = (id, name = id) => ({ id, name, note: '', x: 24, y: 24 });
const serial = { nodes: [node('cut','下料'),node('weld','焊接'),node('out','检验')], edges: [{from:'cut',to:'weld'},{from:'weld',to:'out'}] };
const parallel = { nodes: [node('cut'),node('part'),node('out')], edges: [{from:'cut',to:'out'},{from:'part',to:'out'}] };
async function fixture(t, { multi = false, graph = serial, routed = true, repeated = false } = {}) {
  const {app,db}=createApp(':memory:'); const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
  let cookie;
  const request=async(path,body,options={})=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:options.method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',Cookie:options.cookie||cookie||'','X-Warehouse-ID':String(options.warehouseId||1)},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  cookie=(await request('/auth/setup',{username:'routeadmin',password:'Route-test-123'})).cookie;
  const ok=r=>{assert.ok([200,201].includes(r.status),JSON.stringify(r.data));return r.data;};
  ok(await request('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'}));
  const command=(path,body={},options)=>request(path,{request_id:randomUUID(),schema_version:2,stage_schema_version:1,operation_schema_version:1,...body},options);
  const route=ok(await command('/process-routes',{name:'凳架工艺',note:'',enabled:1,graph}));
  const product=async(name,routeId=null)=>{const response=await request('/products',{name,barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,default_route_id:routeId});assert.equal(response.status,201,JSON.stringify(response.data));return response.data.id;};
  const raw=await product('钢管'),half=await product('凳架',routed?route.id:null),output=multi?await product('凳子',routed?route.id:null):half;
  db.prepare('UPDATE products SET stock=1000,inventory_value_cents=100000 WHERE id=?').run(raw);
  const bom=async(product_id,items,name)=>ok(await command('/boms',{name,product_id,base_quantity:1,base_unit:'件',note:'',enabled:1,items}));
  const child=await bom(half,[{product_id:raw,quantity:2,unit:'件',note:''}],'凳架配方');
  let branches;
  if (repeated) {
    branches = [];
    for (const name of ['黑芯', '白芯']) {
      const product_id = await product(name);
      const branch = await bom(product_id, [{product_id:half,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:child.id}], name+'配方');
      branches.push({product_id,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:branch.id});
    }
  }
  const root=repeated?await bom(output,branches,'双支配方'):multi?await bom(output,[{product_id:half,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:child.id}],'凳子配方'):child;
  const create=async(extra={})=>{const plan=ok(await command('/production-orders/prepare',{bom_id:root.id,bom_version:root.version,planned_quantity:10}));return ok(await command('/production-orders',{bom_id:root.id,bom_version:root.version,planned_quantity:10,note:'',structure_token:plan.structure_token,...extra}));};
  const get=id=>request(`/production-orders/${id}`).then(ok);
  const start=async(order)=>{const started=ok(await command(`/production-orders/${order.id}/start`,{version:order.version}));const doc=started.material_documents[0];ok(await command(`/production-material-documents/${doc.id}/confirm`,{version:doc.version}));return get(order.id);};
  const report=(order,node_id,quantity,path='',extra={},options)=>command(`/production-orders/${order.id}/operations/report`,{version:order.version,path,operation_node_id:node_id,quantity,note:'',...extra},options);
  const complete=(order,quantity,path='',extra={},options)=>command(`/production-orders/${order.id}/${multi?'stages/':''}complete`,{version:order.version,path,operation_node_id:'out',completed_quantity:quantity,items:multi?[{path:path?'1.1':'1',quantity:quantity*(path?2:1)}]:[{product_id:raw,quantity:quantity*2}],scraps:[],note:'',finish_order:false,...extra},options);
  return {db,request,command,ok,route,raw,half,output,root,child,create,get,start,report,complete,adminCookie:cookie};
}

test('route graph rejects loops, disconnected outputs and malformed nodes and arranges parallel branches',()=>{
  assert.equal(validateProcessGraph(serial).output,'out');
  assert.throws(()=>validateProcessGraph({...serial,edges:[...serial.edges,{from:'out',to:'cut'}]}),/循环/);
  assert.throws(()=>validateProcessGraph({...serial,edges:[]}),/唯一/);
  assert.throws(()=>validateProcessGraph({...serial,nodes:[...serial.nodes,node('cut')]}),/编号/);
  assert.throws(()=>validateProcessGraph({...serial,edges:[{from:'none',to:'cut'}]}),/不存在/);
  assert.equal(new Set(arrangeProcessGraph(parallel).nodes.map(n=>`${n.x},${n.y}`)).size,3);
});

test('route deletion checks versions, warehouse and permissions, and supports safe request replay', async t => {
  const f = await fixture(t, { routed: false });
  const path = `/process-routes/${f.route.id}/delete`;
  assert.equal((await f.request(path, { version: f.route.version })).status, 400);
  assert.equal((await f.command(path)).status, 409);
  assert.equal((await f.command(path, { version: String(f.route.version) })).status, 409);
  const warehouse = f.ok(await f.request('/warehouses', { name: '删除隔离仓' }));
  assert.equal((await f.command(path, { version: f.route.version }, { warehouseId: warehouse.id })).status, 404);
  const position = f.ok(await f.command('/positions', { name: '工艺只读', permissions: ['products', 'production'] }));
  f.ok(await f.command('/users', { username: 'routereader', employee_no: 'routereader', password: 'Reader-test-123', role: 'employee', position_id: position.id }));
  const login = await f.request('/auth/login', { username: 'routereader', password: 'Reader-test-123' }, { cookie: 'no-session' });
  const readOnly = { cookie: login.cookie };
  assert.equal((await f.request(`/process-routes/${f.route.id}`, undefined, readOnly)).status, 200);
  assert.equal((await f.command(path, { version: f.route.version }, readOnly)).status, 403);
  const changed = f.ok(await f.command(`/process-routes/${f.route.id}/status`, { version: f.route.version, enabled: 0 }));
  assert.equal((await f.command(path, { version: f.route.version })).status, 409);
  const body = { request_id: randomUUID(), version: changed.version };
  const revision = f.ok(await f.request('/updates')).revision;
  assert.deepEqual(f.ok(await f.command(path, body)), { ok: true });
  assert.notEqual(f.ok(await f.request('/updates')).revision, revision);
  assert.equal((await f.request(`/process-routes/${f.route.id}`)).status, 404);
  assert.deepEqual(f.ok(await f.command(path, body)), { ok: true });
  assert.equal((await f.command(path, { version: changed.version })).status, 404);
  const recreated = f.ok(await f.command('/process-routes', { name: f.route.name, note: '', enabled: 1, graph: serial }));
  assert.ok(recreated.version > changed.version);
  assert.equal((await f.command(`/process-routes/${recreated.id}/delete`, { version: changed.version })).status, 409);
  f.ok(await f.command(`/process-routes/${recreated.id}/delete`, { version: recreated.version }));
  // Permission is checked before a successful deletion can be replayed.
  f.db.prepare("UPDATE users SET role='employee',position_id=? WHERE username='routeadmin'").run(position.id);
  assert.equal((await f.command(path, body)).status, 403);
});

test('route deletion preserves inactive bindings and all production snapshots including voided orders', async t => {
  const f = await fixture(t);
  let order = await f.create();
  const path = `/process-routes/${f.route.id}/delete`;
  const remove = () => f.command(path, { version: f.route.version });
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.half);
  let result = await remove();
  assert.equal(result.status, 409); assert.match(result.data.error, /物料引用/);
  f.db.prepare('UPDATE products SET active=1,default_route_id=NULL WHERE id=?').run(f.half);
  f.db.prepare('UPDATE boms SET enabled=0,route_override_id=? WHERE id=?').run(f.route.id, f.root.id);
  result = await remove();
  assert.equal(result.status, 409); assert.match(result.data.error, /BOM引用/);
  f.db.prepare('UPDATE boms SET enabled=1 WHERE id=?').run(f.root.id);
  f.db.prepare('UPDATE boms SET route_override_id=NULL WHERE id=?').run(f.root.id);
  result = await remove();
  assert.equal(result.status, 409); assert.match(result.data.error, /生产单引用/);
  order = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: order.version, reason: '取消生产' }));
  assert.equal(order.status, 'void');
  result = await remove();
  assert.equal(result.status, 409); assert.match(result.data.error, /生产单引用/);
  assert.deepEqual((await f.get(order.id)).operation_routes[0].graph, serial);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.raw).stock, 1000);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.command('/backup/preview', { backup }));
});

test('serial reports constrain later operations, remain separate from inventory, and atomically register final output',async t=>{
  const f=await fixture(t);let order=await f.start(await f.create());
  assert.equal(order.operation_routes[0].route_id,f.route.id);
  assert.equal((await f.report(order,'weld',1)).status,409);
  order=f.ok(await f.report(order,'cut',6)); assert.equal(order.completed_quantity,null);assert.equal(order.receipt_documents.length,0);assert.equal(order.items[0].available_quantity,20);
  assert.equal((await f.report(order,'weld',7)).status,409);
  order=f.ok(await f.report(order,'weld',4));
  const before=f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n;
  assert.equal((await f.complete(order,5)).status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n,before);
  assert.equal((await f.complete(order,4,'',{operation_schema_version:undefined})).status,409);
  order=f.ok(await f.complete(order,4));assert.equal(order.completed_quantity,4);assert.equal(order.items[0].available_quantity,12);assert.equal(order.receipt_documents.length,1);
  assert.equal(order.operation_routes[0].operations.find(n=>n.id==='out').completed_quantity,4);
  assert.equal((await f.command(`/production-orders/${order.id}/finish`,{version:order.version})).status,409);
  const report=order.operation_routes[0].reports.find(r=>r.node_id==='cut');
  assert.equal((await f.command(`/production-orders/${order.id}/operations/${report.id}/void`,{version:order.version,reason:'错误'})).status,409);
  order=f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`,{version:order.version,reason:'重录'}));
  assert.equal(order.operation_routes[0].operations.find(n=>n.id==='out').completed_quantity,0);assert.equal(order.items[0].available_quantity,20);
  const weld=order.operation_routes[0].reports.find(r=>r.node_id==='weld');
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/${weld.id}/void`,{version:order.version,reason:'重录'}));
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/${report.id}/void`,{version:order.version,reason:'重录'}));
  assert.equal(order.operation_routes[0].operations[0].completed_quantity,0);
});

test('parallel join waits for all predecessors and partial output can complete an order with balanced operations',async t=>{
  const f=await fixture(t,{graph:parallel});let order=await f.start(await f.create());
  order=f.ok(await f.report(order,'cut',4));assert.equal((await f.complete(order,1)).status,409);
  order=f.ok(await f.report(order,'part',3));order=f.ok(await f.complete(order,3));
  assert.equal(order.operation_routes[0].operations.find(n=>n.id==='out').available_quantity,0);
  order=f.ok(await f.report(order,'part',1));order=f.ok(await f.complete(order,1));
  order=f.ok(await f.command(`/production-orders/${order.id}/finish`,{version:order.version}));assert.equal(order.status,'completed');assert.equal(order.completed_quantity,4);
});

test('route snapshots survive edits and disabling; bindings preserve older clients and respect warehouse scope',async t=>{
  const f=await fixture(t);const order=await f.create();
  const changed=f.ok(await f.command(`/process-routes/${f.route.id}`,{...f.route,name:'修改后的路线',graph:parallel}));
  assert.equal((await f.get(order.id)).operation_routes[0].route_name,'凳架工艺');
  assert.deepEqual((await f.get(order.id)).operation_routes[0].graph,serial);
  assert.equal((await f.command(`/process-routes/${f.route.id}`,{...f.route,name:'过期编辑'})).status,409);
  assert.deepEqual((await f.create()).operation_routes[0].graph,parallel);
  f.ok(await f.command(`/process-routes/${changed.id}/status`,{version:changed.version,enabled:0}));
  const started=await f.start(order);assert.equal(started.status,'in_progress');
  const warehouse=f.ok(await f.request('/warehouses',{name:'第二仓库'}));
  assert.equal((await f.request(`/process-routes/${f.route.id}`,undefined,{warehouseId:warehouse.id})).status,404);
  const bad=await f.request('/products',{name:'跨仓',barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,default_route_id:f.route.id},{warehouseId:warehouse.id});assert.equal(bad.status,400);
});

test('BOM override wins over material default and can be cleared without copying a graph',async t=>{
  const f=await fixture(t);const other=f.ok(await f.command('/process-routes',{name:'特殊工艺',note:'',enabled:1,graph:parallel}));
  const body={...f.root,items:f.root.items.map(i=>({...i,unit:i.product.unit})),route_override_id:other.id};
  const saved=f.ok(await f.command(`/boms/${f.root.id}`,body));
  const plan=f.ok(await f.command('/production-orders/prepare',{bom_id:saved.id,bom_version:saved.version,planned_quantity:1}));
  const order=f.ok(await f.command('/production-orders',{bom_id:saved.id,bom_version:saved.version,planned_quantity:1,structure_token:plan.structure_token,note:''}));
  assert.equal(order.operation_routes[0].route_id,other.id);
  const preserved=f.ok(await f.command(`/boms/${saved.id}`,{...body,version:saved.version,route_override_id:undefined}));assert.equal(preserved.route_override_id,other.id);
  const cleared=f.ok(await f.command(`/boms/${saved.id}`,{...body,version:preserved.version,route_override_id:null}));assert.equal(cleared.route_override_id,null);
});

test('half-finished and root routes register output once and reverse with the existing stage ledger',async t=>{
  const f=await fixture(t,{multi:true});let order=await f.start(await f.create());assert.equal(order.operation_routes.length,2);
  order=f.ok(await f.report(order,'cut',6,'1'));order=f.ok(await f.report(order,'weld',6,'1'));order=f.ok(await f.complete(order,6,'1'));
  assert.equal(order.stages.find(s=>s.path==='1').available_quantity,6);assert.equal(order.completed_quantity,null);assert.equal(order.receipt_documents.length,0);
  order=f.ok(await f.report(order,'cut',4));order=f.ok(await f.report(order,'weld',4));order=f.ok(await f.complete(order,4));
  assert.equal(order.completed_quantity,4);assert.equal(order.items[0].available_quantity,8);assert.equal(order.stages.find(s=>s.path==='1').available_quantity,2);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.half).stock,0);
  const upper=f.db.prepare("SELECT id FROM production_stage_batches WHERE production_id=? AND path=''").get(order.id);
  order=f.ok(await f.command(`/production-orders/${order.id}/stages/batches/${upper.id}/void`,{version:order.version,reason:'重录'}));
  assert.equal(order.operation_routes.find(r=>r.path==='').operations.find(n=>n.id==='out').completed_quantity,0);assert.equal(order.stages.find(s=>s.path==='1').available_quantity,6);
});

test('group workers can report only themselves and their orders, including before idempotent replay',async t=>{
  const f=await fixture(t);const group=f.ok(await f.command('/production-groups',{name:'路线生产组',description:''}));
  const position=f.ok(await f.command('/positions',{name:'路线岗位',access_mode:'production_only',permissions:['production_register']}));
  const worker=f.ok(await f.command('/users',{username:'routeworker',employee_no:'routeworker',password:'Worker-test-123',role:'employee',position_id:position.id,production_group_id:group.id,name:'李四'}));
  const another=f.ok(await f.command('/users',{username:'routeother',employee_no:'routeother',password:'Worker-test-123',role:'employee',position_id:position.id,production_group_id:group.id,name:'张三'}));
  let order=await f.start(await f.create({production_group_id:group.id}));
  order=f.ok(await f.report(order,'cut',2,'',{worker_id:worker.id}));assert.equal(order.operation_routes[0].reports[0].worker_name,'李四');assert.equal(order.operation_routes[0].reports[0].registered_by_name,'routeadmin');
  const login=await f.request('/auth/login',{username:'routeworker',password:'Worker-test-123'}),options={cookie:login.cookie};
  assert.equal((await f.request('/process-routes',undefined,options)).status,403);
  const workers=f.ok(await f.request(`/production-orders/${order.id}/operation-workers`,undefined,options));assert.equal(workers.workers.length,1);assert.equal(workers.workers[0].id,worker.id);
  assert.equal((await f.report(order,'weld',1,'',{worker_id:another.id},options)).status,403);
  const request_id=randomUUID(),body={request_id,version:order.version,path:'',operation_node_id:'weld',quantity:1,note:''};
  const result=f.ok(await f.command(`/production-orders/${order.id}/operations/report`,body,options));assert.ok(!JSON.stringify(result).includes('cost_cents'));
  assert.deepEqual(f.ok(await f.command(`/production-orders/${order.id}/operations/report`,body,options)),result);
  f.db.prepare('UPDATE users SET production_group_id=NULL WHERE id=?').run(worker.id);
  assert.equal((await f.command(`/production-orders/${order.id}/operations/report`,body,options)).status,404);
});

test('new backup roundtrip preserves routes and reports, rejects corrupt output and dependencies, and resets safely',async t=>{
  const f=await fixture(t);let order=await f.start(await f.create());order=f.ok(await f.report(order,'cut',3));order=f.ok(await f.report(order,'weld',3));order=f.ok(await f.complete(order,2));
  const backup=f.ok(await f.request('/backup'));assert.equal(backup.version,43);
  const preview=f.ok(await f.command('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,token:preview.token,current_token:preview.current_token,confirmation:'RESTORE_BUSINESS_DATA'}));
  order=await f.get(order.id);assert.equal(order.operation_routes[0].operations.find(n=>n.id==='weld').completed_quantity,3);
  for(const mutate of [b=>b.data.production_operation_reports.find(r=>r.output_kind).quantity=3,b=>b.data.production_operation_reports.find(r=>r.node_id==='cut').quantity=1,b=>b.data.products.find(p=>p.id===f.half).default_route_id=999,b=>b.data.production_routes[0].path='missing']){
    const bad=structuredClone(backup);mutate(bad);assert.equal((await f.command('/backup/preview',{backup:bad})).status,400);
  }
  order=f.ok(await f.complete(order,1));assert.equal(order.completed_quantity,3);
  f.ok(await f.command('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'}));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM process_routes').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n,0);
});

test('legacy backup and unrouted orders retain their original registration flow',async t=>{
  const f=await fixture(t,{routed:false});let order=await f.start(await f.create());assert.equal(order.operation_routes.length,0);
  order=f.ok(await f.complete(order,2,'',{operation_node_id:undefined,operation_schema_version:undefined}));assert.equal(order.completed_quantity,2);
  const backup=f.ok(await f.request('/backup'));backup.version=38;for(const table of ['process_routes','production_routes','production_operation_reports'])delete backup.data[table];for(const p of backup.data.products)delete p.default_route_id;for(const b of backup.data.boms)delete b.route_override_id;
  const preview=f.ok(await f.command('/backup/preview',{backup}));f.ok(await f.command('/backup/restore',{backup,token:preview.token,current_token:preview.current_token,confirmation:'RESTORE_BUSINESS_DATA'}));
  assert.equal((await f.get(order.id)).operation_routes.length,0);
});

test('reports reject changed units and replayed backups reject historical dependency forgery',async t=>{
  const f=await fixture(t);let order=await f.start(await f.create());
  f.db.prepare("UPDATE products SET unit='kg' WHERE id=?").run(f.half);
  assert.equal((await f.report(order,'cut',2)).status,409);
  f.db.prepare("UPDATE products SET unit='件' WHERE id=?").run(f.half);
  order=f.ok(await f.report(order,'cut',3));order=f.ok(await f.report(order,'weld',3));order=f.ok(await f.complete(order,3));
  const backup=f.ok(await f.request('/backup'));const reports=backup.data.production_operation_reports;
  const first=reports.find(r=>r.node_id==='cut'),second=reports.find(r=>r.node_id==='weld');
  [first.created_sequence,second.created_sequence]=[second.created_sequence,first.created_sequence];
  const bad=await f.command('/backup/preview',{backup});assert.equal(bad.status,400);assert.match(bad.data.error,/顺序/);
  const history=f.ok(await f.request(`/production-orders/${order.id}/operations/reports?snapshot_id=${order.operation_routes[0].id}&offset=1&limit=1`));assert.equal(history.total,3);assert.equal(history.reports.length,1);assert.equal(history.has_more,true);
});

for (const multi of [false,true]) test(`started ${multi ? 'layered' : 'single-level'} operation routes support secondary groups and personal assignees`, async t => {
  const f=await fixture(t,{multi});
  const a=f.ok(await f.command('/production-groups',{name:'主生产组'})), b=f.ok(await f.command('/production-groups',{name:'协作组'}));
  const position=f.ok(await f.command('/positions',{name:'协作登记',access_mode:'production_only',permissions:['production_register']}));
  const employee=async(username,groupId)=>{
    const user=f.ok(await f.command('/users',{username,employee_no:username,password:'Worker-test-123',role:'employee',position_id:position.id,production_group_id:groupId}));
    const login=await f.request('/auth/login',{username,password:'Worker-test-123'},{cookie:'no-session'});
    return {...user,cookie:login.cookie};
  };
  const grouped=await employee('secondary-worker',b.id), person=await employee('personal-worker',null), outsider=await employee('unassigned-worker',null);
  let order=await f.start(await f.create({production_group_id:a.id}));
  order=f.ok(await f.command(`/production-orders/${order.id}/assign`,{version:order.version,production_group_ids:[a.id,b.id],user_ids:[person.id]}));
  const available=f.ok(await f.request(`/production-orders/${order.id}/operation-workers`)).workers.map(user=>user.id);
  assert.ok(available.includes(grouped.id));assert.ok(available.includes(person.id));assert.ok(!available.includes(outsider.id));
  const path=multi?'1':'';
  assert.equal((await f.report(order,'cut',2,path,{worker_id:outsider.id})).status,403);
  order=f.ok(await f.report(order,'cut',2,path,{worker_id:grouped.id}));
  order=f.ok(await f.report(order,'weld',2,path,{}, {cookie:grouped.cookie}));
  order=f.ok(await f.complete(order,1,path,{}, {cookie:person.cookie}));
  const reports=order.operation_routes.find(route=>route.path===path).reports;
  assert.equal(reports.find(report=>report.node_id==='cut').worker_id,grouped.id);
  assert.equal(reports.find(report=>report.node_id==='out').worker_id,person.id);
  const batch=f.db.prepare(`SELECT production_group_id,created_by FROM ${multi?'production_stage_batches':'production_batches'} WHERE production_id=? ORDER BY id DESC`).get(order.id);
  assert.equal(batch.created_by,person.id);assert.equal(batch.production_group_id,null);
});


test('shared operations aggregate predecessors across paths, register output once and replay safely', async t => {
  const f = await fixture(t, { multi: true, repeated: true });
  let order = await f.start(await f.create());
  const paths = order.stages.filter(s => s.product_id === f.half).map(s => s.path);
  assert.equal(paths.length, 2);
  order = f.ok(await f.report(order, 'cut', 16, paths[0], { auto_overflow: true }));
  assert.deepEqual(paths.map(path => order.operation_routes.find(r => r.path === path).operations[0].completed_quantity), [16,16]);
  const before = order.version;
  assert.equal((await f.report(order, 'weld', 17, paths[0], { auto_overflow: true })).status, 409);
  assert.equal((await f.get(order.id)).version, before);
  order = f.ok(await f.report(order, 'weld', 16, paths[1], { auto_overflow: true }));
  const allocations = [{path:paths[0],quantity:16,items:[{path:paths[0]+'.1',quantity:32}]}];
  const body = { request_id:randomUUID(),version:order.version,path:paths[0],operation_node_id:'out',completed_quantity:16,finish_order:false,note:'线盘 R001',scraps:[],auto_overflow:true,allocations };
  const invalid = structuredClone(body); invalid.request_id=randomUUID(); invalid.allocations[0].items[0].quantity=9999;
  assert.equal((await f.command(`/production-orders/${order.id}/stages/complete`,invalid)).status,400);
  order = await f.get(order.id);
  assert.equal(order.stages.find(s=>s.path===paths[0]).completed_quantity,0);
  order = f.ok(await f.command(`/production-orders/${order.id}/stages/complete`,body));
  assert.deepEqual(paths.map(path=>order.stages.find(s=>s.path===path).completed_quantity),[16,0]);
  assert.deepEqual(paths.map(path=>order.stages.find(s=>s.path===path).items[0].actual_quantity),[32,0]);
  assert.equal(order.completed_quantity ?? 0,0);
  const replay=f.ok(await f.command(`/production-orders/${order.id}/stages/complete`,body));
  assert.equal(replay.version,order.version);
  assert.equal(order.stage_pools[0].completed_quantity,16);
  const history=f.ok(await f.request(`/production-orders/${order.id}/operations/reports?snapshot_id=${order.operation_routes.find(r=>r.path===paths[1]).id}`));
  assert.equal(history.total,3);
  const cut=history.reports.find(r=>r.node_id==='cut');
  assert.equal((await f.command(`/production-orders/${order.id}/operations/${cut.id}/void`,{version:order.version,reason:'前序核对'})).status,409);
  f.ok(await f.command('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});
