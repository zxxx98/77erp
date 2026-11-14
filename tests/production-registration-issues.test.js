import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { productionIssuesFixture } from './helpers/production-issues.js';

const pending = o => o.operation_registrations.filter(row => row.status === 'pending');
const missing = (o, product) => o.registration_issues.find(row => row.product_id === product)?.missing_quantity ?? 0;

test('material shortages are recorded cumulatively without posting stock, costs, output or receipts', async t => {
  const f = await productionIssuesFixture(t); let o = f.order;
  o = f.ok(await f.complete(o, 12, [[f.raw, 24], [f.other, 12]]));
  assert.equal(o.registration_status, 'unsettled'); assert.equal(o.pending_registration_count, 1);
  assert.equal(missing(o, f.raw), 4); assert.equal(missing(o, f.other), 2);
  assert.equal(o.completed_quantity, null); assert.equal(o.receipt_documents.length, 0);
  assert.equal(o.batches.length, 0); assert.equal(o.items[0].available_quantity, 20);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.output).stock, 0);
  const cost = o.items[0].available_cost_cents;
  o = f.ok(await f.complete(o, 3, [[f.raw, 6], [f.other, 3]]));
  assert.equal(missing(o, f.raw), 10); assert.equal(missing(o, f.other), 5);
  assert.ok(o.items[0].available_cost_cents < cost);
  assert.equal(o.completed_quantity,3);
  assert.equal(o.pending_registration_count,1);
  assert.equal(o.receipt_documents.length,1);
  assert.equal((await f.command(`/production-orders/${o.id}/finish`, { version: o.version })).status, 409);
  assert.equal((await f.command(`/production-orders/${o.id}/void`, { version: o.version, reason: '测试' })).status, 409);
});

test('only actual approved replenishment clears deficits; reconciliation posts once and finishing succeeds', async t => {
  const f = await productionIssuesFixture(t); let o = f.ok(await f.complete(f.order, 12, [[f.raw, 24], [f.other, 12]]));
  let added = await f.supplement(o, [[f.raw, 2], [f.other, 1]]);
  assert.equal(missing(added.order, f.raw), 4);
  o = await f.confirm(added.doc);
  assert.equal(missing(o, f.raw), 2); assert.equal(missing(o, f.other), 1);
  o = f.ok(await f.reconcile(o));
  assert.equal(o.pending_registration_count, 1); assert.equal(o.batches.length, 0); assert.equal(o.settlement_errors.length, 1);
  added = await f.supplement(o, [[f.raw, 2], [f.other, 1]]); o = await f.confirm(added.doc);
  assert.equal(o.registration_issues.length, 0); assert.equal(o.pending_registration_count, 1);
  const original = pending(o)[0];
  const body = { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, version: o.version };
  o = f.ok(await f.request(`/production-orders/${o.id}/operations/registrations/reconcile`, body));
  assert.equal(o.pending_registration_count, 0); assert.equal(o.completed_quantity, 12); assert.equal(o.batches.length, 1);
  assert.equal(o.receipt_documents.length, 1); assert.equal(o.receipt_documents[0].status, 'pending');
  assert.equal(o.items[0].available_quantity, 0); assert.equal(o.items[0].available_cost_cents, 0);
  assert.equal(o.batches[0].created_by_name, original.registered_by_name);
  assert.deepEqual(f.ok(await f.request(`/production-orders/${o.id}/operations/registrations/reconcile`, body)), o);
  assert.equal((await f.get()).batches.length, 1);
  o = f.ok(await f.command(`/production-orders/${o.id}/finish`, { version: o.version })); assert.equal(o.status, 'completed');
  const receipt = o.receipt_documents[0];
  f.ok(await f.command(`/production-receipts/${receipt.id}/confirm`, { version: receipt.version }));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.output).stock, 12);
  f.ok(await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) }));
});

test('cancelling a pending record releases its cumulative claim and preserves an audit record', async t => {
  const f = await productionIssuesFixture(t); let o = f.ok(await f.complete(f.order, 12, [[f.raw, 24], [f.other, 12]]));
  const first = pending(o)[0]; o = f.ok(await f.complete(o, 2, [[f.raw, 4], [f.other, 2]]));
  assert.equal(missing(o, f.raw), 8);
  o = f.ok(await f.cancel(o, first)); assert.equal(o.registration_issues.length, 0);
  o = f.ok(await f.reconcile(o)); assert.equal(o.completed_quantity, 2);
  assert.equal(o.operation_registrations.find(row => row.id === first.id).status, 'void');
  assert.equal(o.items[0].available_quantity, 16);
});

test('upper layers can be recorded before semi-finished production and settle with exact FIFO cost', async t => {
  const f = await productionIssuesFixture(t, { staged: true }); let o = f.order;
  o = f.ok(await f.complete(o, 5, [['1', 10]]));
  assert.equal(o.registration_status, 'unsettled'); assert.equal(o.registration_issues[0].kind, 'semi');
  assert.equal(missing(o, f.semi), 10); assert.equal(o.receipt_documents.length, 0);
  o = f.ok(await f.complete(o, 10, [['1.1', 30]], { path: '1' }));
  assert.equal(o.registration_issues.length, 0); assert.equal(o.stages[1].available_quantity, 10);
  o = f.ok(await f.reconcile(o)); assert.equal(o.completed_quantity, 5); assert.equal(o.stages[1].available_quantity, 0);
  assert.equal(o.items[0].available_quantity, 30);
  assert.equal(o.items[0].available_cost_cents + o.total_cost_cents, o.material_documents[0].items[0].cost_cents);
  const batch = f.ok(await f.request(`/production-orders/${o.id}/stages/batches?path=&limit=20`)).batches[0];
  o = f.ok(await f.command(`/production-orders/${o.id}/stages/batches/${batch.id}/void`, { version: o.version, reason: '纠正' }));
  assert.equal(o.stages[1].available_quantity, 10); assert.equal(o.items[0].available_quantity, 30);
});

test('multi-level shortage chain settles in dependency order even when recorded upper layer first', async t => {
  const f = await productionIssuesFixture(t, { staged: true }); let o = f.ok(await f.complete(f.order, 12, [['1', 24]]));
  o = f.ok(await f.complete(o, 24, [['1.1', 72]], { path: '1' }));
  assert.equal(o.pending_registration_count, 2); assert.equal(missing(o, f.raw), 12);
  const added = await f.supplement(o, [[f.raw, 12]]); o = await f.confirm(added.doc);
  o = f.ok(await f.reconcile(o)); assert.equal(o.pending_registration_count, 0); assert.equal(o.completed_quantity, 12);
  assert.equal(o.stages[1].available_quantity, 0); assert.equal(o.items[0].available_quantity, 0);
  assert.equal(o.settlement_errors.length, 0);
  f.ok(await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) }));
});

test('predecessor and material deficiencies are both visible and subsequent reporting releases settlement', async t => {
  const f = await productionIssuesFixture(t, { routed: true }); let o = f.order;
  o = f.ok(await f.complete(o, 12, [[f.raw, 24], [f.other, 12]]));
  assert.deepEqual(new Set(o.registration_issues.map(row => row.kind)), new Set(['material', 'predecessor']));
  assert.equal(o.operation_routes[0].operations[1].completed_quantity, 0);
  o = f.ok(await f.report(o, 'cut', 12));
  assert.equal(o.registration_issues.filter(row => row.kind === 'predecessor').length, 0);
  const added = await f.supplement(o, [[f.raw, 4], [f.other, 2]]); o = await f.confirm(added.doc);
  const registrar = pending(o)[0]; o = f.ok(await f.reconcile(o));
  assert.equal(o.completed_quantity, 12); assert.equal(o.operation_routes[0].reports.length, 2);
  const report = o.operation_routes[0].reports.find(row => row.node_id === 'output');
  assert.equal(report.created_at, registrar.created_at); assert.equal(report.worker_name, registrar.worker_name);
});

test('invalid quantities, forged paths, disabled products, stale versions and cross-warehouse writes still fail', async t => {
  const f = await productionIssuesFixture(t); const o = f.order;
  for (const quantity of [-1, 0.00001, '1/0']) assert.equal((await f.complete(o, 12, [[f.raw, quantity], [f.other, 12]])).status, 400);
  assert.equal((await f.complete(o, 12, [[999999, 24], [f.other, 12]])).status, 400);
  assert.equal((await f.complete(o, 12, [[f.raw, 24], [f.other, 12]], { version: o.version - 1 })).status, 409);
  assert.equal((await f.complete(o, 12, [[f.raw, 24], [f.other, 12]], { finish_order: true })).status, 400);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.raw);
  assert.equal((await f.complete(o, 12, [[f.raw, 24], [f.other, 12]])).status, 400);
  assert.equal((await f.get()).pending_registration_count, 0);
});

test('settlement revalidates changed units and rolls back every write while retaining the pending record', async t => {
  const f = await productionIssuesFixture(t); let o = f.ok(await f.complete(f.order, 12, [[f.raw, 24], [f.other, 12]]));
  const added = await f.supplement(o, [[f.raw, 4], [f.other, 2]]); o = await f.confirm(added.doc);
  f.db.prepare("UPDATE products SET unit='件' WHERE id=?").run(f.raw);
  o = f.ok(await f.reconcile(o)); assert.equal(o.pending_registration_count, 1); assert.equal(o.batches.length, 0);
  assert.match(o.settlement_errors[0].error, /单位/); assert.equal(o.items[0].available_quantity, 24);
});

test('pending fractional shortages survive backup restore and retain exact cumulative amounts', async t => {
  const f = await productionIssuesFixture(t); let o = f.ok(await f.complete(f.order, '1/3', [[f.raw, '61/3'], [f.other, '1/3']]));
  assert.equal(o.registration_issues.find(row => row.product_id === f.raw).missing_quantity_fraction, '1/3');
  const backup = f.ok(await f.request('/backup')); assert.equal(backup.version, 57);
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  o = await f.get(); assert.equal(o.pending_registration_count, 1); assert.equal(o.registration_issues[0].missing_quantity_fraction, '1/3');
  const corrupt = structuredClone(backup); corrupt.data.production_operation_registrations[0].body = JSON.stringify({ ...JSON.parse(corrupt.data.production_operation_registrations[0].body), items: [{ product_id: 999999, quantity: 1 }] });
  assert.equal((await f.request('/backup/preview', { backup: corrupt })).status, 400);
});

test('post-processing may be reported before output and material availability, but never posts premature wages or costs', async t => {
  const f = await productionIssuesFixture(t, { postProcessing: true }); let o = f.order;
  const path = o.operation_routes.find(row => row.product_coefficient != null).path;
  o = f.ok(await f.report(o, 'pack', 6, path));
  assert.equal(o.registration_status, 'unsettled');
  assert.equal(o.registration_issues.find(row => row.kind === 'post_processing').missing_quantity, 6);
  assert.equal(o.post_processing_material_cost_cents, 0);
  o = f.ok(await f.complete(o, 10, [[f.raw, 20], [f.other, 15]]));
  assert.equal(o.registration_issues.find(row => row.kind === 'post_processing').missing_quantity, 1);
  // Reconcile cannot turn exceeding the final allowance into valid production.
  o = f.ok(await f.reconcile(o)); assert.equal(o.pending_registration_count, 1);
  o = f.ok(await f.cancel(o, pending(o)[0]));
  // Actual output releases five runs; their fixed materials still require issuing.
  o = f.ok(await f.report(o, 'pack', 5, path));
  assert.equal(missing(o, f.other), 5);
  const added = await f.supplement(o, [[f.other, 5]]); o = await f.confirm(added.doc);
  o = f.ok(await f.reconcile(o)); assert.equal(o.pending_registration_count, 0);
  assert.equal(o.operation_routes.find(row => row.path === path).operations[0].completed_quantity, 5);
  assert.equal(o.items.find(row => row.product_id === f.other).available_quantity, 0);
  assert.equal(o.operation_registrations.find(row => row.kind === 'settlement' && row.status === 'approved').initial_issues.length, 1);
  f.ok(await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) }));
});

test('registration requests remain idempotent and permission checks precede both new and replayed settlement', async t => {
  const f = await productionIssuesFixture(t); const o = f.order;
  const body = { request_id: randomUUID(), schema_version: 2, version: o.version, completed_quantity: 12,
    items: [{ product_id: f.raw, quantity: 24 }, { product_id: f.other, quantity: 12 }], scraps: [], finish_order: false };
  const first = f.ok(await f.request(`/production-orders/${o.id}/complete`, body));
  assert.deepEqual(f.ok(await f.request(`/production-orders/${o.id}/complete`, body)), first);
  assert.equal((await f.get()).pending_registration_count, 1);
  assert.equal((await f.command(`/production-orders/${o.id}/operations/registrations/reconcile`, { version: first.version }, { cookie: '' })).status, 401);
  assert.equal((await f.command(`/production-orders/${o.id}/operations/registrations/${pending(first)[0].id}/approve`, { version: first.version }, { cookie: '' })).status, 401);
  const otherResponse=await f.command('/warehouses', { name: '其他仓库' });
  assert.equal(otherResponse.status,201);const other=otherResponse.data;
  assert.equal((await f.command(`/production-orders/${o.id}/complete`, { ...body, request_id: randomUUID(), version: first.version }, { warehouseId: other.id })).status, 404);
});

test('settling only ready records keeps unresolved rows intact and returns cost on a later batch reversal', async t => {
  const f = await productionIssuesFixture(t); let o = f.ok(await f.complete(f.order, 12, [[f.raw, 24], [f.other, 12]]));
  const original = pending(o)[0];
  o = f.ok(await f.complete(o, 11, [[f.raw, 22], [f.other, 11]]));
  const added = await f.supplement(o, [[f.raw, 4], [f.other, 2]]); o = await f.confirm(added.doc);
  o = f.ok(await f.reconcile(o)); assert.equal(o.completed_quantity, 12); assert.equal(o.pending_registration_count, 1);
  assert.equal(o.operation_registrations.find(row => row.id === original.id).initial_issues.find(row => row.product_id === f.raw).missing_quantity, 4);
  assert.equal(missing(o, f.raw), 22);
  const batch = o.batches[0];
  o = f.ok(await f.command(`/production-orders/${o.id}/batches/${batch.id}/void`, { version: o.version, reason: '纠正真实错误' }));
  assert.equal(o.registration_issues.length, 0); assert.equal(o.items[0].available_quantity, 24);
  o = f.ok(await f.reconcile(o)); assert.equal(o.completed_quantity, 11); assert.equal(o.pending_registration_count, 0);
  assert.equal(o.receipt_documents.filter(row => row.status === 'pending').length, 1);
});

for(const staged of [false,true]) test(`later supplemental materials do not invalidate saved pending inputs (${staged?'staged':'ordinary'})`,async t=>{
  const f=await productionIssuesFixture(t,{staged});
  let o=f.ok(await f.complete(f.order,12,staged?[['1.1',72]]:[[f.raw,24],[f.other,12]],staged?{path:'1'}:{}));
  const extraResponse=await f.request('/products',{name:'额外补料',barcode:randomUUID(),category:'生产',unit:'kg',cost:1,price:2,threshold:0});
  assert.equal(extraResponse.status,201);const extra=extraResponse.data.id;
  f.db.prepare('UPDATE products SET stock=10,inventory_value_cents=1000 WHERE id=?').run(extra);
  const added=await f.supplement(o,[[f.raw,staged?12:4],...(staged?[]:[[f.other,2]]),[extra,1]]);o=await f.confirm(added.doc);
  f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
  o=f.ok(await f.reconcile(o));assert.equal(o.pending_registration_count,0);
  assert.equal(o.items.find(item=>item.product_id===extra).available_quantity,1);
  f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});

test('registration staff can report shortages and cancel their own records but cannot approve or bypass settlement',async t=>{
  const f=await productionIssuesFixture(t,{routed:true});
  const group=f.ok(await f.command('/production-groups',{name:'缺料登记组'}));
  const position=f.ok(await f.command('/positions',{name:'缺料报工员',access_mode:'production_only',permissions:['production_register']}));
  const worker=f.ok(await f.command('/users',{username:'issuereporter',employee_no:'issuereporter',password:'Worker-test-123',name:'登记员工',role:'employee',position_id:position.id,production_group_id:group.id}));
  let o=f.ok(await f.command(`/production-orders/${f.order.id}/assign`,{version:f.order.version,production_group_ids:[group.id]}));
  const cookie=(await f.request('/auth/login',{username:'issuereporter',password:'Worker-test-123'})).cookie;
  const response=await f.command(`/production-orders/${o.id}/complete`,{version:o.version,operation_node_id:'output',completed_quantity:12,items:[{product_id:f.raw,quantity:24},{product_id:f.other,quantity:12}],scraps:[],finish_order:false},{cookie});
  o=f.ok(response);assert.equal(o.registration_status,'unsettled');const row=pending(o)[0];
  assert.equal(row.worker_id,worker.id);assert.equal(row.registered_by,worker.id);assert.equal(o.items[0].available_cost_cents,undefined);
  assert.equal((await f.command(`/production-orders/${o.id}/operations/registrations/${row.id}/approve`,{version:o.version},{cookie})).status,403);
  assert.equal((await f.command(`/production-orders/${o.id}/operations/registrations/reconcile`,{version:o.version},{cookie})).status,403);
  const cancelled=f.ok(await f.command(`/production-orders/${o.id}/operations/registrations/${row.id}/cancel`,{version:o.version},{cookie}));
  assert.equal(cancelled.pending_registration_count,0);assert.equal(cancelled.batches.length,0);
});

test('computed shortage snapshots retain precision beyond manual decimal inputs on backup',async t=>{
  const f=await productionIssuesFixture(t);
  const o=f.ok(await f.complete(f.order,1,[[f.raw,'2000.0001/100'],[f.other,1]]));
  assert.equal(missing(o,f.raw),0.000001);
  const backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
  const bad=structuredClone(backup),issues=JSON.parse(bad.data.production_operation_registrations[0].initial_issues);
  issues[0].missing_quantity=-1;bad.data.production_operation_registrations[0].initial_issues=JSON.stringify(issues);
  assert.equal((await f.request('/backup/preview',{backup:bad})).status,400);
});

test('unsettled semi-finished output flows to the parent and finishing settles the whole cost chain', async t => {
  const f=await productionIssuesFixture(t,{staged:true});
  let o=f.ok(await f.complete(f.order,24,[['1.1',72]],{path:'1'}));
  assert.equal(o.stages[1].completed_quantity,0);
  assert.equal(o.flow_progress.stages[1].completed_quantity,24);
  assert.equal(o.flow_progress.stages[0].items[0].available_quantity,24);
  o=f.ok(await f.complete(o,12,[['1',24]]));
  assert.equal(o.flow_progress.completed_quantity,12);
  assert.equal(o.flow_progress.stages[1].available_quantity,0);
  assert.equal(o.pending_registration_count,2);
  assert.equal(o.receipt_documents.length,0);
  const failed=await f.command(`/production-orders/${o.id}/finish`,{version:o.version});
  assert.equal(failed.status,409);
  assert.equal((await f.get()).batches.length,0);
  const added=await f.supplement(o,[[f.raw,12]]);o=await f.confirm(added.doc);
  o=f.ok(await f.command(`/production-orders/${o.id}/finish`,{version:o.version}));
  assert.equal(o.status,'completed');assert.equal(o.pending_registration_count,0);
  assert.equal(o.completed_quantity,12);assert.equal(o.flow_progress.completed_quantity,12);
  assert.equal(o.items[0].available_quantity,0);
  assert.equal(o.total_cost_cents,o.material_documents.reduce((sum,doc)=>sum+doc.items.reduce((n,i)=>n+i.cost_cents,0),0));
  assert.equal(o.receipt_documents.length,1);
  f.ok(await f.request('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});

test('warehouse cannot approve an existing finished receipt while other registrations remain unsettled', async t=>{
  const f=await productionIssuesFixture(t);
  let o=f.ok(await f.complete(f.order,1,[[f.raw,2],[f.other,1]]));
  const receipt=o.receipt_documents[0];
  o=f.ok(await f.complete(o,12,[[f.raw,24],[f.other,12]]));
  const denied=await f.command(`/production-receipts/${receipt.id}/confirm`,{version:receipt.version});
  assert.equal(denied.status,409);assert.match(denied.data.error,/未结算/);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.output).stock,0);
  o=f.ok(await f.cancel(o,pending(o)[0]));
  f.ok(await f.command(`/production-receipts/${receipt.id}/confirm`,{version:receipt.version}));
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.output).stock,1);
});

test('short production can confirm flow completion and report post-processing before material settlement',async t=>{
  const f=await productionIssuesFixture(t,{postProcessing:true});
  let o=f.ok(await f.complete(f.order,5,[[f.raw,24],[f.other,5]]));
  assert.equal(o.flow_progress.completed_quantity,5);assert.equal(o.completed_quantity,null);
  o=f.ok(await f.command(`/production-orders/${o.id}/output-completion`,{version:o.version,completed:true}));
  assert.equal(o.output_completion_confirmed,true);
  const path=o.operation_routes.find(r=>r.product_coefficient!=null).path;
  assert.equal(o.flow_progress.operation_routes.find(r=>r.path===path).post_processing_limit,3);
  assert.equal((await f.complete(o,1,[[f.raw,2],[f.other,1]])).status,409);
  o=f.ok(await f.report(o,'pack',3,path));
  assert.equal(o.flow_progress.operation_routes.find(r=>r.path===path).operations[0].completed_quantity,3);
  assert.equal((await f.command(`/production-orders/${o.id}/output-completion`,{version:o.version,completed:false})).status,409);
  const added=await f.supplement(o,[[f.raw,4]]);o=await f.confirm(added.doc);
  o=f.ok(await f.command(`/production-orders/${o.id}/finish`,{version:o.version}));
  assert.equal(o.status,'completed');assert.equal(o.completed_quantity,5);assert.equal(o.pending_registration_count,0);
  assert.equal(o.operation_routes.find(r=>r.path===path).operations[0].completed_quantity,3);
});

test('registering the final batch and finishing also reconciles earlier ready work',async t=>{
  const f=await productionIssuesFixture(t);
  let o=f.ok(await f.complete(f.order,12,[[f.raw,24],[f.other,12]]));
  const added=await f.supplement(o,[[f.raw,6],[f.other,3]]);o=await f.confirm(added.doc);
  o=f.ok(await f.complete(o,1,[[f.raw,2],[f.other,1]],{finish_order:true}));
  assert.equal(o.status,'completed');assert.equal(o.completed_quantity,13);
  assert.equal(o.pending_registration_count,0);assert.equal(o.batches.length,2);
  assert.equal(o.items[0].available_quantity,0);
});
