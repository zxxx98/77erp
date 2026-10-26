import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { migrateProduction } from '../server/production.js';
import { stageStandardQuantity } from '../shared/production-stages.js';
import { migrateProductionStages, productionStageTables } from '../server/production-stages.js';

async function fixture(t, { repeated = false } = {}) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: options.method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId || 1), Cookie: options.cookie === null ? '' : options.cookie || cookie || '', ...options.headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  cookie = (await request('/auth/setup', { username: 'stageadmin', password: 'Test-admin-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const command = (path, body, options) => request(path, { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, ...body }, options);
  const product = async name => { const r = await request('/products', { name, barcode: `STAGE-${name}`, category: '生产', unit: 'kg', cost: 1, price: 2, threshold: 0 }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.id; };
  const a = await product('A'), b = await product('B'), c = await product('C');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10001 WHERE id=?').run(c);
  const definition = (product_id, items) => ({ name: `BOM-${product_id}`, product_id, base_quantity: 1, base_unit: 'kg', loss_method: 'internal', note: '', enabled: 1, items });
  const child = ok(await command('/boms', definition(b, [{ product_id: c, quantity: 3, unit: 'kg', note: '' }])));
  const root = ok(await command('/boms', definition(a, [{ product_id: b, quantity: 2, unit: 'kg', note: '', usage_mode: 'explode', child_bom_id: child.id }, ...(repeated ? [{ product_id: c, quantity: 1, unit: 'kg', note: '' }] : [])])));
  const create = async () => { const body = { bom_id: root.id, bom_version: root.version, planned_quantity: 10, note: '' }; const plan = ok(await request('/production-orders/prepare', { ...body, schema_version: 2 })); return ok(await command('/production-orders', { ...body, structure_token: plan.structure_token })); };
  const get = id => request(`/production-orders/${id}`).then(ok);
  const active = async () => { let o = await create(); o = ok(await command(`/production-orders/${o.id}/start`, { version: o.version })); const doc = o.material_documents[0]; ok(await command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })); return get(o.id); };
  const complete = (o, path, quantity, items, extra = {}) => command(`/production-orders/${o.id}/stages/complete`, { version: o.version, path, completed_quantity: quantity, items: items.map(([path, quantity]) => ({path, quantity, variance_reason: ''})), scraps: [], note: '', finish_order: false, ...extra });
  const batches = (o, path) => request(`/production-orders/${o.id}/stages/batches?path=${path}&offset=0&limit=20`).then(ok);
  const voidBatch = (o, id) => command(`/production-orders/${o.id}/stages/batches/${id}/void`, {version:o.version,reason:'登记错误'});
  return { db, request, command, ok, a, b, c, root, create, get, active, complete, batches, voidBatch };
}

test('stage A→B→C registration consumes raw pool once, retains WIP, and projects root receipts', async t => {
  const f = await fixture(t); let o = await f.active();
  assert.equal(o.stage_workflow, 1); assert.deepEqual(o.stages.map(s => [s.path,s.planned_quantity]), [['',10],['1',20]]);
  assert.equal((await f.complete(o, '', 5, [['1',10]])).status, 400);
  o = f.ok(await f.complete(o,'1',12,[['1.1',36]]));
  assert.equal(o.completed_quantity,null); assert.equal(o.items[0].available_quantity,24);
  assert.equal(o.stages[1].available_quantity,12); assert.equal(o.receipt_documents.length,0);
  assert.equal(o.stages[1].items[0].actual_quantity,36);
  assert.equal(o.stages[1].items[0].standard_quantity,36);
  o = f.ok(await f.complete(o,'',5,[['1',10]]));
  assert.equal(o.stages[1].available_quantity,2); assert.equal(o.items[0].available_quantity,24); assert.equal(o.completed_quantity,5);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.b).stock,0); assert.equal(o.receipt_documents.length,1);
  assert.equal(o.items[0].actual_quantity,30); assert.equal(o.total_cost_cents,3001);
  assert.equal(o.items[0].available_cost_cents + o.stages[1].available_cost_cents + o.total_cost_cents,6001);
  assert.equal((await f.command(`/production-orders/${o.id}/finish`,{version:o.version})).status,409);
  const lower = (await f.batches(o,'1')).batches[0], upper = (await f.batches(o,'')).batches[0];
  assert.equal(lower.items[0].name,'C'); assert.equal(upper.items[0].allocations[0].source_batch_id,lower.id);
  assert.equal((await f.voidBatch(o,lower.id)).status,409);
  o = f.ok(await f.voidBatch(o,upper.id)); assert.equal(o.stages[1].available_quantity,12); assert.equal(o.items[0].available_quantity,24);
  o = f.ok(await f.voidBatch(o,lower.id)); assert.equal(o.items[0].available_quantity,60); assert.equal(o.items[0].available_cost_cents,6001);
  assert.equal(o.stages[1].items[0].actual_quantity,0);
  assert.equal(o.stages[1].items[0].standard_quantity,0);
});

test('stage writes enforce schema, version, paths, balances and idempotency', async t => {
  const f = await fixture(t); let o = await f.active();
  assert.equal((await f.command(`/production-orders/${o.id}/complete`,{version:o.version,completed_quantity:1,items:[{product_id:f.c,quantity:6}],finish_order:false})).status,409);
  assert.equal((await f.complete(o,'1',1,[['1.1',61]])).status,400);
  assert.equal((await f.complete(o,'missing',1,[['1.1',3]])).status,404);
  assert.equal((await f.complete(o,'1',1,[['1.1',0.00001]])).status,400);
  assert.equal((await f.complete(o,'1',1,[['1.1',3]],{stage_schema_version:undefined})).status,409);
  const body = {request_id:randomUUID(),schema_version:2,stage_schema_version:1,version:o.version,path:'1',completed_quantity:1,items:[{path:'1.1',quantity:3}],finish_order:false};
  const first = f.ok(await f.request(`/production-orders/${o.id}/stages/complete`,body));
  assert.deepEqual(f.ok(await f.request(`/production-orders/${o.id}/stages/complete`,body)),first);
  assert.equal((await f.complete(o,'1',1,[['1.1',3]])).status,409);
  o=await f.get(o.id); assert.equal(o.stages[1].completed_quantity,1);
});

test('FIFO cost tails survive partial allocations and rollback and production can finish with unspent raw', async t => {
  const f=await fixture(t); let o=await f.active();
  o=f.ok(await f.complete(o,'1',1,[['1.1',0.01]])); o=f.ok(await f.complete(o,'1',2,[['1.1',0.02]]));
  const sources=(await f.batches(o,'1')).batches;
  o=f.ok(await f.complete(o,'',1,[['1',1.5]])); const upper=(await f.batches(o,'')).batches[0];
  assert.deepEqual(upper.items[0].allocations.map(x=>[x.source_batch_id,x.quantity]),[[sources[0].id,1],[sources[1].id,0.5]]);
  o=f.ok(await f.voidBatch(o,upper.id)); assert.equal(o.stages[1].available_quantity,3);
  o=f.ok(await f.complete(o,'',1,[['1',3]],{finish_order:true})); assert.equal(o.status,'completed');
  assert.equal(o.stages[1].available_quantity,0); assert.equal(o.stages[1].available_cost_cents,0);
  assert.equal(o.items[0].available_quantity,59.97); assert.equal(o.total_cost_cents,3); assert.equal(o.items[0].actual_quantity,0.03);
  f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});

test('untouched historic drafts explicitly enable from saved snapshot; plans refresh stages; legacy writes are guarded',async t=>{
  const f=await fixture(t); let o=await f.create();
  o=f.ok(await f.command(`/production-orders/${o.id}`,{version:o.version,planned_quantity:4,note:''})); assert.equal(o.stages[1].planned_quantity,8);
  f.db.prepare('DELETE FROM production_stages WHERE production_id=?').run(o.id); f.db.prepare('UPDATE production_orders SET stage_workflow=0 WHERE id=?').run(o.id);
  o=await f.get(o.id); assert.equal(o.stage_workflow,0);
  o=f.ok(await f.command(`/production-orders/${o.id}/stages/enable`,{version:o.version})); assert.equal(o.stages[1].planned_quantity,8);
  o=f.ok(await f.command(`/production-orders/${o.id}/start`,{version:o.version}));
  assert.equal((await f.command(`/production-orders/${o.id}/stages/enable`,{version:o.version})).status,409);
});

test('backup roundtrip retains WIP and rejects cross-source, quantity and cost corruption',async t=>{
  const f=await fixture(t); let o=await f.active();
  o=f.ok(await f.complete(o,'1',12,[['1.1',36]]));
  let backup=f.ok(await f.request('/backup'));assert.equal(backup.version, 40);
  let preview=f.ok(await f.request('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  o=await f.get(o.id);assert.equal(o.stages[1].available_quantity,12);
  o=f.ok(await f.complete(o,'',5,[['1',10]]));
  backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
  for(const mutate of [
    data=>{data.production_stage_allocations[0].source_batch_id=data.production_stage_batches.find(b=>b.path==='').id;},
    data=>{data.production_stage_allocations[0].quantity++;},
    data=>{data.production_stage_allocation_components[0].cost_cents++;},
    data=>{data.production_stage_components[0].quantity++;},
    data=>{data.production_stage_batches[0].status='void';},
    data=>{data.production_stage_inputs[0].path='1';},
  ]){const broken=structuredClone(backup);mutate(broken.data);assert.equal((await f.request('/backup/preview',{backup:broken})).status,400);}
});

test('production manager with correction permission can void; group registration cannot manage or see costs',async t=>{
  const f=await fixture(t); const groupResult=await f.request('/production-groups',{name:'车间一组',note:''});assert.equal(groupResult.status,201,JSON.stringify(groupResult.data));const group=groupResult.data;
  const user=async(username,permissions,access_mode='standard',groupId=null)=>{
    const pos=await f.request('/positions',{name:username,description:'',permissions,access_mode});assert.equal(pos.status,201,JSON.stringify(pos.data));
    const u=await f.request('/users',{username,password:'Test-staff-123',position_id:pos.data.id,production_group_id:groupId});assert.equal(u.status,201,JSON.stringify(u.data));
    return {cookie:(await f.request('/auth/login',{username,password:'Test-staff-123'},{cookie:null})).cookie,id:u.data.id};
  };
  const manager=await user('stage-manager',['production','corrections']),worker=await user('stage-worker',['production_register'],'production_only',group.id);
  let o=await f.active();f.db.prepare('UPDATE production_orders SET production_group_id=?,production_group_name=? WHERE id=?').run(group.id,group.name,o.id);o=await f.get(o.id);
  const body={request_id:randomUUID(),schema_version:2,stage_schema_version:1,version:o.version,path:'1',completed_quantity:1,items:[{path:'1.1',quantity:3}],finish_order:false};
  o=f.ok(await f.request(`/production-orders/${o.id}/stages/complete`,body,worker));assert.equal(JSON.stringify(o).includes('cost'),false);assert.equal(JSON.stringify(o).includes('"stock":'),false);
  const page=f.ok(await f.request(`/production-orders/${o.id}/stages/batches?path=1`,undefined,worker));assert.equal(JSON.stringify(page).includes('cost'),false);
  assert.equal((await f.command(`/production-orders/${o.id}/stages/batches/${page.batches[0].id}/void`,{version:o.version,reason:'纠正'},worker)).status,403);
  f.ok(await f.command(`/production-orders/${o.id}/stages/batches/${page.batches[0].id}/void`,{version:o.version,reason:'纠正'},manager));
  f.db.prepare('UPDATE users SET production_group_id=NULL,permissions_version=permissions_version+1 WHERE id=?').run(worker.id);
  assert.equal((await f.request(`/production-orders/${o.id}/stages/complete`,body,worker)).status,404);
});

test('half batch corrections reject changed snapshot units or rounding without changing balances',async t=>{
  const f=await fixture(t);let o=await f.active();o=f.ok(await f.complete(o,'1',2,[['1.1',6]]));const b=(await f.batches(o,'1')).batches[0];
  f.db.prepare("UPDATE products SET unit='件' WHERE id=?").run(f.b);
  assert.equal((await f.voidBatch(o,b.id)).status,409);f.db.prepare("UPDATE products SET unit='kg',unit_round_up=1 WHERE id=?").run(f.b);
  assert.equal((await f.voidBatch(o,b.id)).status,409);f.db.prepare('UPDATE products SET unit_round_up=0 WHERE id=?').run(f.b);
  f.db.prepare('UPDATE products SET unit_round_up=1 WHERE id=?').run(f.c);assert.equal((await f.voidBatch(o,b.id)).status,409);
  f.db.prepare('UPDATE products SET unit_round_up=0 WHERE id=?').run(f.c);o=await f.get(o.id);assert.equal(o.stages[1].available_quantity,2);assert.equal(o.items[0].available_quantity,54);
  f.ok(await f.voidBatch(o,b.id));
});

test('six decimal provenance may round to zero without invalidating genuine positive stage inputs',async t=>{
  const f=await fixture(t);let o=await f.active();
  o=f.ok(await f.complete(o,'1',99999999,[['1.1',0.0001]]));o=f.ok(await f.complete(o,'',1,[['1',0.0001]]));
  assert.equal(o.items[0].actual_quantity,0);assert.equal(o.items[0].direct_consumed_quantity,0.0001);
  const backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
});

test('three-level repeated child recipes keep path balances separate and aggregate only raw provenance',async t=>{
  const f=await fixture(t);
  const product=async name=>{const r=await f.request('/products',{name,barcode:`STAGE-${name}`,category:'生产',unit:'kg',cost:1,price:2,threshold:0});assert.equal(r.status,201);return r.data.id;};
  const d=await product('D'),e=await product('E'),child=f.root.items[0].child_bom_id;
  const makeBom=async(product_id,name,items)=>f.ok(await f.command('/boms',{product_id,name,base_quantity:1,base_unit:'kg',note:'',enabled:1,items}));
  const edge=(product_id,child_bom_id)=>({product_id,child_bom_id,usage_mode:'explode',quantity:1,unit:'kg',note:''});
  const left=await makeBom(d,'left',[edge(f.b,child)]),right=await makeBom(e,'right',[edge(f.b,child)]);
  const root=await makeBom(f.a,'deep-root',[edge(d,left.id),edge(e,right.id),{product_id:f.c,quantity:1,unit:'kg',note:''}]);
  const body={bom_id:root.id,bom_version:root.version,planned_quantity:2,note:'',schema_version:2};const plan=f.ok(await f.request('/production-orders/prepare',body));
  let o=f.ok(await f.command('/production-orders',{...body,structure_token:plan.structure_token}));
  o=f.ok(await f.command(`/production-orders/${o.id}/start`,{version:o.version}));const doc=o.material_documents[0];f.ok(await f.command(`/production-material-documents/${doc.id}/confirm`,{version:doc.version}));o=await f.get(o.id);
  assert.deepEqual(o.stages.map(s=>s.path),['','1','1.1','2','2.1']);
  o=f.ok(await f.complete(o,'1.1',2,[['1.1.1',6]]));assert.equal((await f.complete(o,'2',1,[['2.1',1]])).status,400);
  o=f.ok(await f.complete(o,'2.1',1,[['2.1.1',3]]));o=f.ok(await f.complete(o,'1',1,[['1.1',1]]));o=f.ok(await f.complete(o,'2',1,[['2.1',1]]));
  o=f.ok(await f.complete(o,'',1,[['1',1],['2',1],['3',1]]));
  assert.equal(o.items[0].available_quantity,4);assert.equal(o.items[0].actual_quantity,7);assert.equal(o.items[0].direct_consumed_quantity,10);
  assert.equal(o.stages.find(s=>s.path==='1.1').available_quantity,1);assert.equal(o.stages.find(s=>s.path==='2.1').available_quantity,0);
  assert.equal(o.total_cost_cents,700);assert.equal(o.work_in_progress_cost_cents,300);
  for(const id of [f.b,d,e])assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock,0);
  f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});

test('all half batches must be corrected before order void; returned pools permit deletion with clean foreign keys',async t=>{
  const f=await fixture(t);let o=await f.active();o=f.ok(await f.complete(o,'1',2,[['1.1',6]]));const b=(await f.batches(o,'1')).batches[0];
  assert.equal((await f.command(`/production-orders/${o.id}/void`,{version:o.version,reason:'取消'})).status,409);
  o=f.ok(await f.voidBatch(o,b.id));o=f.ok(await f.command(`/production-orders/${o.id}/material-requests`,{version:o.version,type:'in',items:[{product_id:f.c,quantity:60}],note:''}));
  const doc=o.material_documents.at(-1);f.ok(await f.command(`/production-material-documents/${doc.id}/confirm`,{version:doc.version}));o=await f.get(o.id);
  o=f.ok(await f.command(`/production-orders/${o.id}/void`,{version:o.version,reason:'取消'}));f.ok(await f.command(`/production-orders/${o.id}/delete`,{version:o.version}));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_stage_batches').get().n,0);assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.c).stock,100);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('stage batch cap includes void history and rejects the entire write',async t=>{
  const f=await fixture(t);let o=await f.active();const s=o.stages[1];
  const insert=f.db.prepare(`INSERT INTO production_stage_batches(production_id,stage_id,path,batch_number,completed_quantity,total_cost_cents,status,note,created_by_name,created_at,voided_by_name,voided_at,void_reason) VALUES (?,?,?, ?,1,0,'void','','test',?,'test',?,'fixture')`);
  for(let n=1;n<=1000;n++)insert.run(o.id,s.id,s.path,n,o.created_at,o.created_at);
  const result=await f.complete(o,'1',1,[['1.1',3]]);assert.equal(result.status,400);assert.match(result.data.error,/1000/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_stage_batches').get().n,1000);assert.equal((await f.get(o.id)).items[0].available_quantity,60);
});

test('repeated migrations retain stage ledgers; pending returns recheck actual direct consumption',async t=>{
  const f=await fixture(t);let o=await f.active();
  o=f.ok(await f.command(`/production-orders/${o.id}/material-requests`,{version:o.version,type:'in',items:[{product_id:f.c,quantity:50}],note:''}));const doc=o.material_documents.at(-1);
  o=f.ok(await f.complete(o,'1',12,[['1.1',36]]));const revision=o.version;
  assert.equal((await f.command(`/production-material-documents/${doc.id}/confirm`,{version:doc.version})).status,400);
  migrateProduction(f.db);migrateProduction(f.db);o=await f.get(o.id);
  assert.equal(o.version,revision);assert.equal(o.stages[1].available_quantity,12);assert.equal(o.items[0].available_quantity,24);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal((await f.complete(o,'',5,[['1',10]],{finish_order:true})).status,409);
  assert.equal((await f.get(o.id)).completed_quantity,null);assert.equal((await f.batches(o,'')).total,0);
});

test('backup validates original allocations even after the consuming batch was voided',async t=>{
  const f=await fixture(t);let o=await f.active();o=f.ok(await f.complete(o,'1',12,[['1.1',36]]));o=f.ok(await f.complete(o,'',5,[['1',10]]));
  o=f.ok(await f.voidBatch(o,(await f.batches(o,'')).batches[0].id));const backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
  const a=backup.data.production_stage_allocations[0];a.quantity=50;backup.data.production_stage_inputs.find(i=>i.id===a.input_id).quantity=50;
  assert.equal((await f.request('/backup/preview',{backup})).status,400);
});

test('direct standard quantities keep exact fractions, one edge loss and material round-up',()=>{
  const item={quantity:0.3334,quantity_fraction:'1/3',bom_base_quantity:1,loss_rate:10,loss_method:'internal',unit_round_up:0};
  assert.equal(stageStandardQuantity(item,3),1.1112);assert.equal(stageStandardQuantity({...item,unit_round_up:1},3),2);
  assert.equal(stageStandardQuantity({...item,loss_method:'external'},3),1.1);
});

test('backup rejects proportional allocation tampering even when quantity and input totals agree',async t=>{
  const f=await fixture(t);let o=await f.active();o=f.ok(await f.complete(o,'1',12,[['1.1',36]]));o=f.ok(await f.complete(o,'',5,[['1',10]]));
  const backup=f.ok(await f.request('/backup')),broken=structuredClone(backup),a=broken.data.production_stage_allocations[0];
  a.quantity=5;broken.data.production_stage_inputs.find(i=>i.id===a.input_id).quantity=5;
  const preview=await f.request('/backup/preview',{backup:broken});
  assert.equal(preview.status,400,'changing only transferred quantity must not retain the original cost and C30 provenance');
  const valid=f.ok(await f.request('/backup/preview',{backup}));
  assert.equal((await f.command('/backup/restore',{backup:broken,...valid,confirmation:'RESTORE_BUSINESS_DATA'})).status,400);
  assert.equal((await f.get(o.id)).stages[1].available_quantity,2);
});

test('backup rejects skipping an earlier identical FIFO source',async t=>{
  const f=await fixture(t);let o=await f.active();o=f.ok(await f.complete(o,'1',2,[['1.1',6]]));o=f.ok(await f.complete(o,'1',2,[['1.1',6]]));o=f.ok(await f.complete(o,'',1,[['1',1]]));
  const backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
  const sources=backup.data.production_stage_batches.filter(b=>b.path==='1');backup.data.production_stage_allocations[0].source_batch_id=sources[1].id;
  assert.equal((await f.request('/backup/preview',{backup})).status,400);
});

test('backup replays earlier consumer corrections and subsequent cost tails including same-millisecond ties',async t=>{
  const f=await fixture(t);let o=await f.active();o=f.ok(await f.complete(o,'1',3,[['1.1',0.01]]));
  o=f.ok(await f.complete(o,'',1,[['1',1]]));const first=(await f.batches(o,'')).batches[0];
  o=f.ok(await f.complete(o,'',1,[['1',1]]));o=f.ok(await f.voidBatch(o,first.id));o=f.ok(await f.complete(o,'',1,[['1',1]]));
  let backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
  // A clock-resolution tie cannot tell whether an older consumer was voided
  // before or after another registration. Both must preserve a valid replay.
  const roots=backup.data.production_stage_batches.filter(b=>b.path===''),third=roots.at(-1);
  const tie=third.created_at;
  for(const b of roots){b.created_at=tie;if(b.status==='void')b.voided_at=tie;const root=backup.data.production_batches.find(r=>r.id===b.root_batch_id);root.created_at=tie;if(root.status==='void')root.voided_at=tie;const doc=backup.data.production_receipts.find(d=>d.batch_id===root.id);doc.created_at=tie;doc.updated_at=tie;if(doc.status==='void')doc.voided_at=tie;}
  backup.data.production_orders[0].completed_at=tie;
  const preview=f.ok(await f.request('/backup/preview',{backup}));f.ok(await f.command('/backup/restore',{backup,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  o=await f.get(o.id);o=f.ok(await f.complete(o,'',1,[['1',1]]));assert.equal(o.stages[1].available_quantity,0);assert.equal(o.total_cost_cents,1);
  backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
});

test('stage migration rolls back partial DDL without disturbing an outer transaction',async t=>{
  const f=await fixture(t);
  for(const table of [...productionStageTables].reverse())f.db.exec(`DROP TABLE ${table}`);
  for(const trigger of f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='production_orders'").all())if(trigger.sql.includes('stage_workflow'))f.db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"','""')}"`);
  f.db.exec('ALTER TABLE production_orders DROP COLUMN stage_workflow');
  const broken={prepare:sql=>f.db.prepare(sql),exec:sql=>{
    const marker='CREATE TABLE IF NOT EXISTS production_stage_inputs';
    if(sql.includes(marker)){f.db.exec(sql.slice(0,sql.indexOf(marker)));throw new Error('injected migration failure');}
    return f.db.exec(sql);
  }};
  for(const outer of [false,true]){
    if(outer){f.db.exec('BEGIN IMMEDIATE');f.db.prepare("INSERT INTO app_metadata(key,value) VALUES ('stage_migration_outer','preserved')").run();}
    assert.throws(()=>migrateProductionStages(broken),/injected migration failure/);
    assert.equal(f.db.isTransaction,outer);
    assert.equal(f.db.prepare('PRAGMA table_info(production_orders)').all().some(c=>c.name==='stage_workflow'),false);
    assert.deepEqual(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'production_stage%'").all(),[]);
    if(outer){assert.equal(f.db.prepare("SELECT value FROM app_metadata WHERE key='stage_migration_outer'").get().value,'preserved');f.db.exec('ROLLBACK');}
  }
  f.db.exec('BEGIN IMMEDIATE');migrateProductionStages(f.db);assert.equal(f.db.isTransaction,true);assert.equal(f.db.prepare('PRAGMA table_info(production_orders)').all().some(c=>c.name==='stage_workflow'),true);f.db.exec('ROLLBACK');
  assert.equal(f.db.prepare('PRAGMA table_info(production_orders)').all().some(c=>c.name==='stage_workflow'),false);
  migrateProductionStages(f.db);assert.equal(f.db.prepare('PRAGMA table_info(production_orders)').all().some(c=>c.name==='stage_workflow'),true);
});

test('backup replay preserves zero-quantity provenance cents and source correction after consumers',async t=>{
  const f=await fixture(t);f.db.prepare('UPDATE products SET inventory_value_cents=? WHERE id=?').run(1_000_000_000_000_000,f.c);let o=await f.active();
  o=f.ok(await f.complete(o,'1',99999999,[['1.1',0.0001]]));o=f.ok(await f.complete(o,'',1,[['1',1]]));
  assert.equal(o.items[0].actual_quantity,0);assert.equal(o.items[0].cost_cents,10);
  f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
  o=f.ok(await f.voidBatch(o,(await f.batches(o,'')).batches[0].id));o=f.ok(await f.voidBatch(o,(await f.batches(o,'1')).batches[0].id));
  assert.equal(o.items[0].available_quantity,60);f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});
