import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { grantPosition, readonlyPositionId } from './helpers/positions.js';

async function fixture(t, path=':memory:') {
  const {app,db}=createApp(path), server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();};
  t.after(close);
  const request=async(cookie,path,body,method=body===undefined?'GET':'POST',warehouse=1)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Warehouse-ID':String(warehouse),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify({request_id:randomUUID(),...body})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const ok=r=>{assert.ok(r.status<300,JSON.stringify(r));return r.data;};
  const admin=(await request(null,'/auth/setup',{username:'todosadmin',password:'Password-123'})).cookie;
  ok(await request(admin,'/settings/reset',{confirmation:'RESET_BUSINESS_DATA'}));
  const product=ok(await request(admin,'/products',{name:'待办物料',barcode:'TODO-RAW',category:'原料',unit:'kg',cost:2,price:4,threshold:0}));
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=20000 WHERE id=?').run(product.id);
  const employee=async(name,permissions,displayName='同名员工')=>{
    const id=ok(await request(admin,'/users',{position_id:readonlyPositionId(db),username:name,name:displayName,employee_no:name,password:'Password-123'})).id;
    await grantPosition(db,(path,body,method)=>request(admin,path,body,method),id,permissions);
    return {id,cookie:(await request(null,'/auth/login',{username:name,password:'Password-123'})).cookie};
  };
  const submit=async(cookie=admin)=>ok(await request(cookie,'/orders',{type:'in',partner:'待办供应商',items:[{product_id:product.id,quantity:1,price:4}]}));
  const read=async(cookie=admin,path='/todo-notifications')=>ok(await request(cookie,path));
  const approve=async(doc,cookie=admin)=>ok(await request(cookie,`/orders/${doc.id}/approve`,{version:doc.version}));
  const ack=async(cookie,snapshot)=>ok(await request(cookie,'/todo-notifications/acknowledge',{through_id:snapshot.through_id}));
  return {db,request,admin,product,employee,submit,read,approve,ack,ok};
}

test('merged reminders require acknowledgement, isolate accounts and keep later arrivals unread',async t=>{
  const f=await fixture(t), writer=await f.employee('writer',['purchase']), other=await f.employee('other',['purchase']), reviewer=await f.employee('reviewer',['stock_approve']);
  const a=await f.submit(writer.cookie),b=await f.submit(writer.cookie);
  const snapshot=await f.read(reviewer.cookie);assert.equal(snapshot.pending,2);assert.equal(snapshot.approved,0);
  assert.equal((await f.read(reviewer.cookie)).total,2,'reading does not acknowledge');
  assert.equal((await f.read(writer.cookie,'/todos')).total,0);
  assert.equal((await f.read(other.cookie)).total,0);
  const c=await f.submit(writer.cookie);
  await f.ack(reviewer.cookie,snapshot);
  assert.equal((await f.read(reviewer.cookie)).pending,1,'a concurrent arrival remains unread');
  assert.equal((await f.read(f.admin)).pending,3,'another reviewer has independent acknowledgement');
  assert.equal((await f.read(reviewer.cookie,'/todos')).total,3,'acknowledgement does not remove tasks');
  await f.approve(a,reviewer.cookie);await f.approve(b,reviewer.cookie);
  assert.equal((await f.read(writer.cookie)).approved,2);
  assert.equal((await f.read(other.cookie)).approved,0,'same display name cannot receive another account’s approvals');
  assert.equal((await f.read(reviewer.cookie,'/todos')).total,1);
  const passed=await f.read(writer.cookie);await f.ack(writer.cookie,passed);await f.ack(writer.cookie,passed);
  assert.equal((await f.read(writer.cookie)).total,0);
  await f.ok(await f.request(writer.cookie,`/orders/${c.id}/cancel`,{version:1,reason:'撤回'}));
  assert.equal((await f.read(reviewer.cookie,'/todos')).total,0,'withdrawn tasks leave the queue');
  const withdrawn=await f.read(reviewer.cookie);assert.equal(withdrawn.pending,1,'reminders still need explicit acknowledgement after processing');assert.equal(withdrawn.items[0].task_pending,0);
  await f.ack(reviewer.cookie,withdrawn);assert.equal((await f.read(reviewer.cookie)).total,0);
  for (const path of ['/todos?limit=0','/todos?offset=-1','/todos?q=a&q=b']) assert.equal((await f.request(writer.cookie,path)).status,400);
  assert.equal((await f.request(writer.cookie,'/todo-notifications/acknowledge',{through_id:'1'})).status,400);
  assert.equal((await f.request(null,'/todos')).status,401);
});

test('cross-warehouse tasks are paged and searchable; failed approvals and permission changes stay safe',async t=>{
  const f=await fixture(t),reviewer=await f.employee('reviewer',['stock_approve']);
  const docs=[];for(let i=0;i<22;i++) docs.push(await f.submit());
  const warehouse=f.ok(await f.request(f.admin,'/warehouses',{name:'第二仓库',reuse_catalog:true}));
  const p=f.db.prepare('SELECT id FROM products WHERE warehouse_id=?').get(warehouse.id);
  f.ok(await f.request(f.admin,'/orders',{type:'in',partner:'另仓供应商',items:[{product_id:p.id,quantity:1,price:2}]},'POST',warehouse.id));
  const first=await f.read(reviewer.cookie,'/todos?limit=20');assert.equal(first.total,23);assert.equal(first.items.length,20);assert.equal(first.has_more,true);
  const next=await f.read(reviewer.cookie,'/todos?limit=20&offset=20');assert.equal(next.items.length,3);assert.ok(next.items.some(item=>item.warehouse_id===warehouse.id));
  assert.equal((await f.read(reviewer.cookie,`/todos?q=${docs[0].number}`)).total,1);
  const before=await f.read(reviewer.cookie);assert.equal((await f.request(reviewer.cookie,`/orders/${docs[0].id}/approve`,{version:99})).status,409);
  assert.equal((await f.read(reviewer.cookie)).total,before.total);
  await grantPosition(f.db,(path,body,method)=>f.request(f.admin,path,body,method),reviewer.id,['basic_view']);
  assert.equal((await f.read(reviewer.cookie)).total,0);assert.equal((await f.read(reviewer.cookie,'/todos')).total,0);
});

test('production material and finished receipt approvals notify the original submitting account',async t=>{
  const f=await fixture(t),manager=await f.employee('manager',['production']),reviewer=await f.employee('reviewer',['stock_approve']);
  const output=f.ok(await f.request(f.admin,'/products',{name:'成品',barcode:'TODO-OUTPUT',category:'成品',unit:'kg',cost:0,price:4,threshold:0}));
  const bom=f.ok(await f.request(f.admin,'/boms',{name:'待办配方',product_id:output.id,base_quantity:1,base_unit:'kg',note:'',enabled:1,items:[{product_id:f.product.id,quantity:2,unit:'kg',note:''}]}));
  let order=f.ok(await f.request(manager.cookie,'/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:10,note:''}));
  order=f.ok(await f.request(manager.cookie,`/production-orders/${order.id}/start`,{version:order.version,schema_version:2}));
  const material=order.material_documents[0];
  assert.equal((await f.read(reviewer.cookie,'/todos')).items[0].kind,'material_initial');
  const partial=f.ok(await f.request(reviewer.cookie,`/production-material-documents/${material.id}/confirm`,{version:material.version,items:[{product_id:f.product.id,quantity:10}]}));
  material.version=partial.version;
  assert.equal((await f.read(manager.cookie)).approved,0,'partial issue is still pending');
  f.ok(await f.request(reviewer.cookie,`/production-material-documents/${material.id}/confirm`,{version:material.version,items:[{product_id:f.product.id,quantity:10}]}));
  assert.equal((await f.read(manager.cookie)).approved,1);
  order=await f.read(manager.cookie,`/production-orders/${order.id}`);
  order=f.ok(await f.request(manager.cookie,`/production-orders/${order.id}/complete`,{schema_version:2,version:order.version,completed_quantity:5,items:[{product_id:f.product.id,quantity:10}],finish_order:false}));
  const receipt=order.receipt_documents[0];assert.ok(receipt);
  assert.equal((await f.read(reviewer.cookie,'/todos')).items[0].kind,'receipt');
  f.ok(await f.request(reviewer.cookie,`/production-receipts/${receipt.id}/confirm`,{version:receipt.version}));
  assert.equal((await f.read(manager.cookie)).approved,2);
  assert.equal((await f.read(reviewer.cookie,'/todos')).total,0);
});

test('notifications and acknowledgements survive reopening the database; reset removes stale events',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'77erp-todos-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const path=join(folder,'test.sqlite'),f=await fixture(t,path);
  const a=await f.submit();await f.ack(f.admin,await f.read());const b=await f.submit();await f.approve(a);
  // A second server opens the same persistent database without replaying acknowledged events.
  const next=createApp(path),server=next.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/todo-notifications`,{headers:{Cookie:f.admin}});
    const snapshot=await response.json();assert.equal(response.status,200,JSON.stringify(snapshot));assert.equal(snapshot.pending,1);assert.equal(snapshot.approved,1);
    assert.equal(next.db.prepare('SELECT COUNT(*) n FROM todo_events WHERE source_id=?').get(b.id).n,1);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));next.db.close();}
  f.ok(await f.request(f.admin,'/settings/reset',{confirmation:'RESET_BUSINESS_DATA'}));
  assert.equal((await f.read()).total,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM todo_acknowledgements').get().n,0);
  Object.assign(f.product,f.ok(await f.request(f.admin,'/products',{name:'重建物料',barcode:'TODO-RESET',category:'原料',unit:'kg',cost:2,price:4,threshold:0})));
  const replacement=await f.submit();assert.equal((await f.read()).pending,1,'reused document ids do not reuse acknowledgement');
  await f.approve(replacement);assert.equal((await f.read()).approved,1);
});

test('registration tasks respect assignment and separate acceptance from production settlement',async t=>{
  const f=await fixture(t),manager=await f.employee('manager',['production']),inspector=await f.employee('inspector',['production_register','operation_accept']),outsider=await f.employee('outsider',['production_register','operation_accept']);
  const output=f.ok(await f.request(f.admin,'/products',{name:'登记成品',barcode:'TODO-REG',category:'成品',unit:'kg',cost:0,price:4,threshold:0}));
  const bom=f.ok(await f.request(f.admin,'/boms',{name:'登记配方',product_id:output.id,base_quantity:1,base_unit:'kg',note:'',enabled:1,items:[{product_id:f.product.id,quantity:2,unit:'kg',note:''}]}));
  const order=f.ok(await f.request(manager.cookie,'/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:10,note:''}));
  f.db.prepare('UPDATE production_orders SET assigned_users=? WHERE id=?').run(JSON.stringify([{id:inspector.id,name:'验收员'}]),order.id);
  // Model existing queued registrations independently of the acceptance workbook storage.
  const insert=f.db.prepare(`INSERT INTO production_operation_registrations(production_id,path,node_id,endpoint,body,registered_by,registered_by_name,worker_name,created_at,kind) VALUES (?,'','','operations/report','{}',?,'提交人','作业人',?,?)`);
  const first=Number(insert.run(order.id,manager.id,new Date().toISOString(),'acceptance').lastInsertRowid);
  insert.run(order.id,manager.id,new Date().toISOString(),'settlement');
  const personal=await f.read(inspector.cookie,'/todos');assert.equal(personal.total,1);assert.equal(personal.items[0].kind,'acceptance');
  assert.equal((await f.read(outsider.cookie,'/todos')).total,0);
  assert.equal((await f.read(manager.cookie,'/todos')).items[0].kind,'settlement');
  assert.equal((await f.read(f.admin,'/todos')).total,2);
  f.db.prepare("UPDATE production_operation_registrations SET status='approved',resolved_at=? WHERE id=?").run(new Date().toISOString(),first);
  assert.equal((await f.read(manager.cookie)).approved,1);
  assert.equal((await f.read(inspector.cookie,'/todos')).total,0);
});
