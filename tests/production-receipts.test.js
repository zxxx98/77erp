import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { migrateProduction } from '../server/production.js';

async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  // This Windows host allocates low ephemeral ports; fetch rejects reserved service ports.
  const blocked = new Set([1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
  while (server.address().port < 1024 || blocked.has(server.address().port)) {
    await new Promise(resolve => server.close(resolve));
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId || 1), Cookie: options.cookie === null ? '' : options.cookie || cookie || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  cookie = (await request('/auth/setup', { username: 'materialadmin', password: 'Test-admin-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const command = (path, body, options) => request(path, { request_id: randomUUID(), ...body }, options);
  const product = async barcode => { const result = await request('/products', { name: barcode, barcode, category: '生产', unit: 'kg', cost: 1, price: 2, threshold: 0 }); assert.equal(result.status, 201); return result.data.id; };
  const parent = await product('FINISHED'), material = await product('RAW'), second = await product('SECOND');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10001 WHERE id=?').run(material);
  db.prepare('UPDATE products SET stock=50,inventory_value_cents=5000 WHERE id=?').run(second);
  const bom = ok(await command('/boms', { name: '材料流程', product_id: parent, base_quantity: 1, base_unit: 'kg', note: '', enabled: 1,
    items: [{ product_id: material, quantity: 2, unit: 'kg', note: '' }, { product_id: second, quantity: 1, unit: 'kg', note: '' }] }));
  const create = async () => ok(await command('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '', material_workflow: 0 }));
  const get = id => request(`/production-orders/${id}`).then(ok);
  const stock = id => db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(id);
  const start = order => command(`/production-orders/${order.id}/start`, { version: order.version, schema_version: 2 }).then(ok);
  const confirm = doc => command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version }).then(ok);
  const complete = (order, quantity = 15, extra = {}) => command(`/production-orders/${order.id}/complete`, { version: order.version, completed_quantity: 5,
    items: [{ product_id: material, quantity }, { product_id: second, quantity: 5 }], finish_order: false, ...extra });
  return { db, request, command, ok, product, parent, material, second, bom, create, get, stock, start, confirm, complete };
}


test('batch registration reserves output in a pending receipt; warehouse confirmation posts exact cost once', async t => {
  const f = await fixture(t); let order = await f.start(await f.create());
  await f.confirm(order.material_documents[0]); order = f.ok(await f.complete(await f.get(order.id)));
  assert.equal(f.stock(f.parent).stock, 0, 'registration must not post output');
  assert.equal(order.received_quantity, 0); assert.equal(order.pending_receipt_quantity, 5);
  const doc = order.receipt_documents[0];
  assert.equal(doc.status, 'pending'); assert.equal(order.batches[0].receipt_required, 1);
  const body = {version: doc.version, request_id: randomUUID()};
  const confirmed = f.ok(await f.request(`/production-receipts/${doc.id}/confirm`, body));
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(f.stock(f.parent).stock, 5); assert.equal(f.stock(f.parent).inventory_value_cents, order.total_cost_cents);
  assert.deepEqual(f.ok(await f.request(`/production-receipts/${doc.id}/confirm`, body)), confirmed);
  assert.equal((await f.command(`/production-receipts/${doc.id}/confirm`, {version: doc.version})).status, 409);
  order = await f.get(order.id); assert.equal(order.received_quantity, 5); assert.equal(order.pending_receipt_quantity, 0);
});
test('multiple pending batches may finish; pending void restores pool without removing output', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order = f.ok(await f.complete(await f.get(order.id), 10)); order = f.ok(await f.complete(order, 10));
  assert.equal(f.stock(f.parent).stock, 0);
  assert.equal(order.receipt_documents.length, 2);
  order = f.ok(await f.command(`/production-orders/${order.id}/finish`, {version: order.version}));
  assert.equal(order.status, 'completed'); assert.equal(order.pending_receipt_quantity, 10);
  order = f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, {version: order.version, reason:'登记错误'}));
  assert.equal(order.receipt_documents[0].status, 'void'); assert.equal(order.items[0].available_quantity, 10);
  assert.equal(f.stock(f.parent).stock, 0);
});
test('confirmed receipt reversal preserves exact stock and cost and rejects insufficient stock atomically', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order = f.ok(await f.complete(await f.get(order.id))); const doc = order.receipt_documents[0];
  f.ok(await f.command(`/production-receipts/${doc.id}/confirm`, {version: doc.version})); order = await f.get(order.id);
  f.db.prepare('UPDATE products SET stock=1 WHERE id=?').run(f.parent);
  assert.equal((await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, {version: order.version, reason:'纠正'})).status, 400);
  assert.equal((await f.get(order.id)).receipt_documents[0].status, 'confirmed');
  f.db.prepare('UPDATE products SET stock=5 WHERE id=?').run(f.parent);
  order = f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`, {version: order.version, reason:'纠正'}));
  assert.equal(order.receipt_documents[0].status, 'void'); assert.equal(f.stock(f.parent).stock, 0); assert.equal(f.stock(f.parent).inventory_value_cents, 0);
});
test('receipt backups validate immutable batch snapshots, statuses and actor metadata; restore keeps pending receipts', async t => {
  const f = await fixture(t); let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order = f.ok(await f.complete(await f.get(order.id))); const backup = f.ok(await f.request('/backup'));
  assert.equal(backup.version, 43);
  for (const mutate of [
    d=>d.production_receipts[0].quantity++, d=>d.production_receipts[0].batch_id=999,
    d=>d.production_receipts[0].status='confirmed', d=>d.production_receipts[0].confirmed_at=new Date().toISOString(),
    d=>d.production_receipt_items[0].cost_cents++, d=>d.production_receipt_items[0].kind='scrap',
    d=>d.production_receipt_items[0].unit='wrong', d=>d.production_receipts=[],
    d=>d.production_batches[0].receipt_required=0,
  ]) { const broken=structuredClone(backup); mutate(broken.data); assert.equal((await f.request('/backup/preview',{backup:broken})).status,400); }
  const preview=f.ok(await f.request('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  order=await f.get(order.id); assert.equal(order.pending_receipt_quantity,5); assert.equal(f.stock(f.parent).stock,0);
  assert.equal((await f.command(`/production-receipts/${order.receipt_documents[0].id}/confirm`,{version:backup.data.production_receipts[0].version})).status,409);
  const doc=order.receipt_documents[0]; f.ok(await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version}));
  assert.equal(f.stock(f.parent).stock,5);
});
test('receipt history only starts at confirmation and survives reversal', async t=>{
  const f=await fixture(t); let order=await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order=f.ok(await f.complete(await f.get(order.id)));
  assert.equal(f.ok(await f.request(`/products/${f.parent}/history`)).records.length,0);
  const doc=order.receipt_documents[0]; const confirmed=f.ok(await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version}));
  let history=f.ok(await f.request(`/products/${f.parent}/history`)).records;
  assert.equal(history.length,1); assert.equal(history[0].created_at,confirmed.confirmed_at); assert.equal(history[0].delta,5);
  order=await f.get(order.id); f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`,{version:order.version,reason:'重做'}));
  history=f.ok(await f.request(`/products/${f.parent}/history`)).records; assert.equal(history.reduce((sum,row)=>sum+row.delta,0),0);
});
test('purchase-only approval redacts costs; production-only users cannot approve; permission revocation blocks replay', async t=>{
  const f=await fixture(t);
  const user=async(username,permissions)=>{
    const created=await f.request('/users',{ position_id: readonlyPositionId(f.db),username,employee_no:username,password:'Test-staff-123'}); assert.equal(created.status,201);
    f.ok(await grantPosition(f.db, (path, body, method) => f.request(path, body, { method }), created.data.id, permissions));
    return {id:created.data.id,cookie:(await f.request('/auth/login',{username,password:'Test-staff-123'},{cookie:null})).cookie};
  };
  const producer=await user('producer',['production','corrections']), receiver=await user('receiver',['purchase']);
  let order=await f.start(await f.create()); await f.confirm(order.material_documents[0]); order=f.ok(await f.complete(await f.get(order.id)));
  const doc=order.receipt_documents[0], body={version:doc.version,request_id:randomUUID()}, path=`/production-receipts/${doc.id}/confirm`;
  assert.equal((await f.request('/production-receipts',undefined,producer)).status,403);
  assert.equal((await f.request(path,body,producer)).status,403);
  const queue=f.ok(await f.request('/production-receipts?status=pending&q=FINISHED&offset=0&limit=1',undefined,receiver));
  assert.equal(queue.total,1); assert.equal(JSON.stringify(queue).includes('cost_cents'),false);
  const approved=f.ok(await f.request(path,body,receiver)); assert.equal(JSON.stringify(approved).includes('cost_cents'),false);
  order=await f.get(order.id);
  assert.equal((await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`,{version:order.version,reason:'纠正'},producer)).status,403);
  assert.equal((await f.request(`/production-orders/${order.id}`,undefined,receiver)).status,403);
  f.ok(await grantPosition(f.db, (path, body, method) => f.request(path, body, { method }), receiver.id, ['production']));
  assert.equal((await f.request(path,body,receiver)).status,403);
});
test('approval guards stock/value limits, units, enabled flags, stale versions and warehouse boundary atomically',async t=>{
  const f=await fixture(t); let order=await f.start(await f.create()); await f.confirm(order.material_documents[0]); order=f.ok(await f.complete(await f.get(order.id)));
  const doc=order.receipt_documents[0], confirm=()=>f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version});
  for (const [sql,status] of [
    ['UPDATE products SET active=0 WHERE id=?',400],
    ["UPDATE products SET active=1,unit='件' WHERE id=?",409],
    ["UPDATE products SET unit='kg',unit_round_up=1 WHERE id=?",409],
    ['UPDATE products SET unit_round_up=0,stock=99999999 WHERE id=?',400],
    [`UPDATE products SET stock=1,inventory_value_cents=${Number.MAX_SAFE_INTEGER} WHERE id=?`,400],
  ]) { f.db.prepare(sql).run(f.parent); const before=f.stock(f.parent); assert.equal((await confirm()).status,status); assert.deepEqual(f.stock(f.parent),before); assert.equal((await f.get(order.id)).receipt_documents[0].status,'pending'); }
  f.db.prepare('UPDATE products SET stock=0,inventory_value_cents=0 WHERE id=?').run(f.parent);
  assert.equal((await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version+1})).status,409);
  const warehouseId=(await f.request('/warehouses',{name:'分仓',reuse_catalog:false})).data.id;
  assert.equal((await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version},{warehouseId})).status,404);
  const results=await Promise.all([confirm(),confirm()]); assert.deepEqual(results.map(r=>r.status).sort(),[200,409]); assert.equal(f.stock(f.parent).stock,5);
});
test('stock scrap shares receipt at zero cost and a failed scrap posting rolls back finished stock',async t=>{
  const f=await fixture(t), scrap=await f.product('SCRAP');
  const bom=f.ok(await f.command('/boms',{name:'废料流程',product_id:f.parent,base_quantity:1,base_unit:'kg',note:'',enabled:1,
    items:[{product_id:f.material,quantity:2,unit:'kg',note:''},{product_id:f.second,quantity:1,unit:'kg',note:''}],
    scraps:[{product_id:scrap,unit:'kg',method:'output',source_product_id:null,quantity:0.2,note:''}]}));
  let order=f.ok(await f.command('/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:10,note:''}));
  order=await f.start(order);await f.confirm(order.material_documents[0]);order=f.ok(await f.complete(await f.get(order.id),10,{scraps:[{product_id:scrap,quantity:1,disposition:'stock'}]}));
  const doc=order.receipt_documents[0];assert.equal(doc.items.length,2);assert.equal(doc.items[1].cost_cents,0);assert.equal(f.stock(scrap).stock,0);
  f.db.prepare('UPDATE products SET stock=99999999 WHERE id=?').run(scrap);
  assert.equal((await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version})).status,400);assert.equal(f.stock(f.parent).stock,0);
  f.db.prepare('UPDATE products SET stock=0 WHERE id=?').run(scrap);
  f.ok(await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version}));assert.equal(f.stock(scrap).stock,1);assert.equal(f.stock(scrap).inventory_value_cents,0);
  order=await f.get(order.id); f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`,{version:order.version,reason:'纠正'}));assert.equal(f.stock(scrap).stock,0);
});
test('version 34 migration leaves historical batches posted; future registration on legacy order still needs a receipt',async t=>{
  const f=await fixture(t);let order=await f.create();f.db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(order.id);
  order=f.ok(await f.complete(await f.get(order.id)));const doc=order.receipt_documents[0];f.ok(await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version}));
  const backup=f.ok(await f.request('/backup'));backup.version=34;delete backup.data.production_receipts;delete backup.data.production_receipt_items;
  for (const row of backup.data.production_batches) delete row.receipt_required;
  const preview=f.ok(await f.request('/backup/preview',{backup}));f.ok(await f.command('/backup/restore',{backup,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  order=await f.get(order.id);assert.equal(order.batches[0].receipt_required,0);assert.equal(order.received_quantity,5);assert.equal(order.receipt_documents.length,0);
  order=f.ok(await f.complete(order));assert.equal(f.stock(f.parent).stock,5);assert.equal(order.received_quantity,5);assert.equal(order.pending_receipt_quantity,5);assert.equal(order.batches[1].receipt_required,1);
  order=f.ok(await f.command(`/production-orders/${order.id}/void`,{version:order.version,reason:'撤回'}));assert.equal(f.stock(f.parent).stock,0);assert.equal(f.stock(f.material).stock,100);
  const checked=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup:checked}));
});
test('pending void needs no inbound permission and delete/reset remove linked receipt rows',async t=>{
  const f=await fixture(t); let order=await f.start(await f.create()); await f.confirm(order.material_documents[0]);order=f.ok(await f.complete(await f.get(order.id)));
  const created=await f.request('/users',{ position_id: readonlyPositionId(f.db),username:'corrector',employee_no:'corrector',password:'Test-staff-123'});assert.equal(created.status,201);
  f.ok(await grantPosition(f.db, (path, body, method) => f.request(path, body, { method }), created.data.id, ['production','corrections']));
  const options={cookie:(await f.request('/auth/login',{username:'corrector',password:'Test-staff-123'},{cookie:null})).cookie};
  order=f.ok(await f.command(`/production-orders/${order.id}/batches/${order.batches[0].id}/void`,{version:order.version,reason:'未入库纠正'},options));assert.equal(order.receipt_documents[0].status,'void');
  const backup=f.ok(await f.request('/backup'));f.ok(await f.request('/backup/preview',{backup}));
  order=f.ok(await f.command(`/production-orders/${order.id}/material-requests`,{version:order.version,type:'in',items:order.items.map(i=>({product_id:i.product_id,quantity:i.available_quantity})),note:''}));await f.confirm(order.material_documents.at(-1));
  order=await f.get(order.id);order=f.ok(await f.command(`/production-orders/${order.id}/void`,{version:order.version,reason:'取消'}));
  f.ok(await f.command(`/production-orders/${order.id}/delete`,{version:order.version}));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_receipts').get().n,0);
  f.ok(await f.request('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'}));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_receipt_items').get().n,0);
});

test('database migration marks pre-existing posted batches historical and is restart safe',async t=>{
  const f=await fixture(t);let order=await f.start(await f.create());await f.confirm(order.material_documents[0]);order=f.ok(await f.complete(await f.get(order.id)));
  const doc=order.receipt_documents[0];f.ok(await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version}));
  // Reconstruct the persisted pre-migration schema with its already-posted batch.
  f.db.exec('DELETE FROM production_receipt_items; DELETE FROM production_receipts; DROP TRIGGER data_revision_production_batches_UPDATE; ALTER TABLE production_batches DROP COLUMN receipt_required;');
  const before=f.stock(f.parent);migrateProduction(f.db);migrateProduction(f.db);
  order=await f.get(order.id);assert.equal(order.batches[0].receipt_required,0);assert.equal(order.batches[0].receipt_status,'confirmed');assert.equal(order.received_quantity,5);assert.deepEqual(f.stock(f.parent),before);
  assert.equal((await f.command(`/production-receipts/${doc.id}/confirm`,{version:doc.version})).status,404);
});

test('pending receipt order filter applies before pagination and removes confirmed or voided batches', async t => {
  const f = await fixture(t);
  let order = await f.start(await f.create()); await f.confirm(order.material_documents[0]);
  order = f.ok(await f.complete(await f.get(order.id), 10));
  await f.create(); // A newer draft must not hide the matching order at limit=1.
  const pending = () => f.request('/production-orders?status=pending_receipt&limit=1').then(f.ok);
  let list = await pending();
  assert.equal(list.total, 1); assert.equal(list.orders[0].id, order.id); assert.equal(list.has_more, false);
  f.ok(await f.command(`/production-receipts/${order.receipt_documents[0].id}/confirm`, { version: order.receipt_documents[0].version }));
  assert.equal((await pending()).total, 0);
  order = f.ok(await f.complete(await f.get(order.id), 10));
  assert.equal((await pending()).total, 1);
  const batch = order.batches.at(-1);
  f.ok(await f.command(`/production-orders/${order.id}/batches/${batch.id}/void`, { version: order.version, reason: '纠正登记' }));
  assert.equal((await pending()).total, 0);
  assert.equal(f.ok(await f.request('/production-orders?status=draft')).total, 1);
});
