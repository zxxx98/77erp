import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { grantPosition, readonlyPositionId } from './helpers/positions.js';

async function fixture(t) {
  const {app,db}=createApp(':memory:');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();});
  const request=async(cookie,path,body,method=body===undefined?'GET':'POST',warehouse=1)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Warehouse-ID':String(warehouse),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const admin=(await request(null,'/auth/setup',{username:'approvaladmin',password:'Password-123'})).cookie;
  await request(admin,'/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const product=(await request(admin,'/products',{name:'审核原料',barcode:'APPROVAL-001',category:'原料',unit:'kg',cost:2,price:4,threshold:0})).data;
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=20000 WHERE id=?').run(product.id);
  const employee=async(name,permissions)=>{const id=(await request(admin,'/users',{position_id:readonlyPositionId(db),username:name,employee_no:name,password:'Password-123'})).data.id;await grantPosition(db,(path,body,method)=>request(admin,path,body,method),id,permissions);return {id,cookie:(await request(null,'/auth/login',{username:name,password:'Password-123'})).cookie};};
  const submit=async(type='out',quantity=10,cookie=admin)=>{const result=await request(cookie,'/orders',{type,partner:'审核往来单位',items:[{product_id:product.id,quantity,price:4}],request_id:randomUUID()});assert.equal(result.status,201,JSON.stringify(result.data));return result.data;};
  const command=(cookie,path,body)=>request(cookie,path,{request_id:randomUUID(),...body});
  const stock=()=>db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(product.id);
  return {db,request,admin,product,employee,submit,command,stock};
}
test('submission leaves inventory, costs, finance, history and reports unchanged; approval posts exactly once',async t=>{
  const f=await fixture(t),before=f.stock();const doc=await f.submit();assert.equal(doc.status,'pending');assert.deepEqual(f.stock(),before);
  assert.equal(f.db.prepare('SELECT cost_cents FROM order_items WHERE order_id=?').get(doc.id).cost_cents,null);
  assert.equal((await f.request(f.admin,`/products/${f.product.id}/history`)).data.records?.length || 0,0);
  assert.equal((await f.request(f.admin,'/dashboard')).data.trend.reduce((n,r)=>n+r.sales_count,0),0);
  assert.equal((await f.request(f.admin,`/orders/${doc.id}`)).data.order.due_cents,0);
  assert.equal((await f.command(f.admin,`/orders/${doc.id}/payments`,{amount_cents:10,method:'现金',note:''})).status,400);
  const body={version:doc.version,request_id:randomUUID()};const approval=await f.request(f.admin,`/orders/${doc.id}/approve`,body);assert.equal(approval.status,200,JSON.stringify(approval));
  assert.equal(f.stock().stock,90);assert.equal(f.stock().inventory_value_cents,18000);
  assert.equal((await f.request(f.admin,`/orders/${doc.id}/approve`,body)).status,200);assert.equal(f.stock().stock,90);
  assert.equal((await f.command(f.admin,`/orders/${doc.id}/approve`,{version:doc.version})).status,409);
  assert.equal((await f.request(f.admin,`/orders/${doc.id}`)).data.order.approved_by_name,'approvaladmin');
});
test('direction submitters cannot approve production or ordinary documents; approval-only employee can read and post both directions without finance',async t=>{
  const f=await fixture(t);const writer=await f.employee('writer',['purchase','sale']),reviewer=await f.employee('reviewer',['stock_approve']);
  const outgoing=await f.submit('out',10,writer.cookie);
  assert.equal((await f.command(writer.cookie,`/orders/${outgoing.id}/approve`,{version:outgoing.version})).status,403);
  assert.equal((await f.command(writer.cookie,'/production-material-documents/1/confirm',{version:1})).status,403);
  assert.equal((await f.command(writer.cookie,'/production-receipts/1/confirm',{version:1})).status,403);
  assert.equal((await f.request(reviewer.cookie,'/orders?status=pending')).status,200);
  const detail=await f.request(reviewer.cookie,`/orders/${outgoing.id}`);assert.equal(detail.status,200);assert.equal(detail.data.order.items[0].cost_cents,undefined);assert.equal(detail.data.order.due_cents,undefined);
  assert.equal((await f.request(reviewer.cookie,'/orders',{type:'in'})).status,403);
  assert.equal((await f.command(reviewer.cookie,`/orders/${outgoing.id}/approve`,{version:outgoing.version})).status,200);
  const incoming=await f.submit('in',20,writer.cookie);assert.equal((await f.command(reviewer.cookie,`/orders/${incoming.id}/approve`,{version:incoming.version})).status,200);
  assert.equal(f.stock().stock,110);
  for(const path of ['/stock/increase','/transfers',`/orders/${incoming.id}/void`])assert.equal((await f.command(reviewer.cookie,path,{})).status,403);
});
test('approval rechecks stock and unit snapshots, rejects atomically and detects stale/withdrawn documents',async t=>{
  const f=await fixture(t);const doc=await f.submit('out',101);assert.equal(f.stock().stock,100);
  assert.equal((await f.command(f.admin,`/orders/${doc.id}/approve`,{version:1})).status,409);assert.equal(f.stock().stock,100);
  f.db.prepare('UPDATE products SET unit=? WHERE id=?').run('件',f.product.id);
  assert.equal((await f.command(f.admin,`/orders/${doc.id}/approve`,{version:1})).status,409);
  const rejected=await f.command(f.admin,`/orders/${doc.id}/reject`,{version:1,reason:'单位变化'});assert.equal(rejected.data.status,'rejected');assert.equal(f.stock().stock,100);
  const doc2=await f.submit('in');assert.equal((await f.command(f.admin,`/orders/${doc2.id}/cancel`,{version:1,reason:'重复提交'})).status,200);
  assert.equal((await f.command(f.admin,`/orders/${doc2.id}/approve`,{version:1})).status,409);
});
test('concurrent approvals and withdrawals serialize and revoked permission cannot replay approval',async t=>{
  const f=await fixture(t);const reviewer=await f.employee('reviewer',['stock_approve']);const a=await f.submit('out',70),b=await f.submit('out',70);
  const results=await Promise.all([a,b].map(doc=>f.command(reviewer.cookie,`/orders/${doc.id}/approve`,{version:1})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.stock().stock,30);
  const doc=await f.submit('in',10);const body={version:1,request_id:randomUUID()};assert.equal((await f.request(reviewer.cookie,`/orders/${doc.id}/approve`,body)).status,200);
  await grantPosition(f.db,(path,data,method)=>f.request(f.admin,path,data,method),reviewer.id,[]);
  assert.equal((await f.request(reviewer.cookie,`/orders/${doc.id}/approve`,body)).status,403);
  const c=await f.submit('in',1);const race=await Promise.all([f.command(f.admin,`/orders/${c.id}/approve`,{version:1}),f.command(f.admin,`/orders/${c.id}/cancel`,{version:1,reason:'撤回'})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
});
test('pending/rejected approvals survive validated backup restore and corrections remain immediate',async t=>{
  const f=await fixture(t);const pending=await f.submit('in',10);const rejected=await f.submit();await f.command(f.admin,`/orders/${rejected.id}/reject`,{version:1,reason:'数量有误'});
  const backup=(await f.request(f.admin,'/backup')).data;assert.equal(backup.version,46);
  const preview=await f.request(f.admin,'/backup/preview',{backup});assert.equal(preview.status,200,JSON.stringify(preview.data));
  const restore=await f.command(f.admin,'/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA'});assert.equal(restore.status,200,JSON.stringify(restore.data));
  assert.equal(f.stock().stock,100);assert.equal((await f.command(f.admin,`/orders/${pending.id}/approve`,{version:1})).status,200);assert.equal(f.stock().stock,110);
  assert.equal((await f.command(f.admin,`/orders/${pending.id}/void`,{reason:'取消采购'})).status,200);assert.equal(f.stock().stock,100);
});

test('late line failure rolls back inventory and costs; changed lifecycle and contact role prevent posting',async t=>{
  const f=await fixture(t);
  const second=(await f.request(f.admin,'/products',{name:'第二原料',barcode:'APPROVAL-002',category:'原料',unit:'kg',cost:2,price:4,threshold:0})).data;
  const response=await f.request(f.admin,'/orders',{type:'out',partner:'审核往来单位',items:[{product_id:f.product.id,quantity:5,price:4},{product_id:second.id,quantity:1,price:4}]});
  assert.equal(response.status,201);const doc=response.data;
  const before=f.stock();assert.equal((await f.command(f.admin,`/orders/${doc.id}/approve`,{version:1})).status,409);
  assert.deepEqual(f.stock(),before);assert.ok(f.db.prepare('SELECT cost_cents FROM order_items WHERE order_id=?').all(doc.id).every(i=>i.cost_cents===null));
  const single=await f.submit('in',1);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.product.id);
  assert.equal((await f.command(f.admin,`/orders/${single.id}/approve`,{version:1})).status,409);
  f.db.prepare('UPDATE products SET active=1 WHERE id=?').run(f.product.id);
  f.db.prepare("UPDATE contacts SET role='customer',name='已变更客户' WHERE id=(SELECT partner_id FROM orders WHERE id=?)").run(single.id);
  assert.equal((await f.command(f.admin,`/orders/${single.id}/approve`,{version:1})).status,409);assert.deepEqual(f.stock(),before);
});

test('resubmission preserves source and warehouse boundaries forbid reviewing another warehouse',async t=>{
  const f=await fixture(t);const source=await f.submit('in',1);
  await f.command(f.admin,`/orders/${source.id}/reject`,{version:1,reason:'重填'});
  const body={type:'in',partner:'审核往来单位',items:[{product_id:f.product.id,quantity:2,price:4}],resubmitted_from_id:source.id};
  const copy=await f.request(f.admin,'/orders',body);assert.equal(copy.status,201);
  assert.equal((await f.request(f.admin,`/orders/${copy.data.id}`)).data.order.resubmitted_from_id,source.id);
  const warehouse=await f.request(f.admin,'/warehouses',{name:'隔离仓库'});assert.equal(warehouse.status,201);
  const isolated=await f.request(f.admin,`/orders/${copy.data.id}/approve`,{version:1,request_id:randomUUID()},'POST',warehouse.data.id);assert.equal(isolated.status,400,JSON.stringify(isolated.data));assert.equal(isolated.data.code,'RECORD_WRONG_WAREHOUSE');
  assert.equal(f.stock().stock,100);
});
