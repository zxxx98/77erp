import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {readonlyPositionId,grantPosition} from './helpers/positions.js';

async function fixture(t) {
 const {app,db}=createApp(':memory:'); const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();});
 const origin=`http://127.0.0.1:${server.address().port}`; let admin;
 const raw=(path,body,options={})=>fetch(`${origin}/api${path}`,{method:options.method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Warehouse-ID':String(options.warehouseId||1),...(options.cookie===null?{}:{Cookie:options.cookie||admin}),...options.headers},body:body===undefined?undefined:JSON.stringify(body)});
 const req=async(path,body,options={})=>{const r=await raw(path,body,options);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 admin=(await req('/auth/setup',{username:'pdfadmin',password:'Test-admin-123'})).cookie;
 await req('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
 const product=async code=>(await req('/products',{name:`中文物料${code}`,barcode:code,category:'生产',unit:'件',cost:123,price:456,threshold:0})).data.id;
 const parent=await product('PDF-F'),material=await product('PDF-M');
 const bom=(await req('/boms',{request_id:randomUUID(),name:'中文配方',product_id:parent,base_quantity:1,base_unit:'件',note:'',enabled:1,items:[{product_id:material,quantity:2,unit:'件',note:'不可遗漏材料备注'}]})).data;
 const at=new Date().toISOString(); const group=Number(db.prepare("INSERT INTO production_groups(name,description,created_at,updated_at) VALUES ('一组','',?,?)").run(at,at).lastInsertRowid);
 const order=(await req('/production-orders',{request_id:randomUUID(),bom_id:bom.id,bom_version:bom.version,planned_quantity:10,note:'PDF中文备注',production_group_id:group})).data;
 const user=(await req('/users',{username:'pdfworker',password:'Test-staff-123',position_id:readonlyPositionId(db)})).data;
 await grantPosition(db,(path,body,method)=>req(path,body,{method}),user.id,['production_register']);
 db.prepare("UPDATE positions SET access_mode='production_only' WHERE id=(SELECT position_id FROM users WHERE id=?)").run(user.id);
 db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(group,user.id);
 const cookie=(await req('/auth/login',{username:'pdfworker',password:'Test-staff-123'},{cookie:null})).cookie;
 return {db,raw,req,origin,order,user,cookie};
}
test('PDF is an authenticated scoped read, attachment and never mutates business data',async t=>{
 const f=await fixture(t);const path=`/production-orders/${f.order.id}/pdf?origin=${encodeURIComponent(f.origin)}`;
 assert.equal((await f.raw(path,undefined,{cookie:null})).status,401);
 const before=f.db.prepare('SELECT * FROM production_orders').all();
 const changes=f.db.prepare('SELECT total_changes() n').get().n;
 for(const cookie of [undefined,f.cookie]) {const r=await f.raw(path,undefined,{cookie});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/pdf/);assert.match(r.headers.get('content-disposition'),/attachment/);assert.match(r.headers.get('cache-control'),/no-store/);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>10000);}
 assert.deepEqual(f.db.prepare('SELECT * FROM production_orders').all(),before);
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
 const warehouse=(await f.req('/warehouses',{name:'PDF隔离仓库'})).data.id;
 assert.equal((await f.raw(path,undefined,{warehouseId:warehouse})).status,404);
 f.db.prepare('UPDATE users SET production_group_id=NULL WHERE id=?').run(f.user.id);
 assert.equal((await f.raw(path,undefined,{cookie:f.cookie})).status,404);
 const at=new Date().toISOString();const other=Number(f.db.prepare("INSERT INTO production_groups(name,description,created_at,updated_at) VALUES ('二组','',?,?)").run(at,at).lastInsertRowid);
 f.db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(other,f.user.id);
 assert.equal((await f.raw(path,undefined,{cookie:f.cookie})).status,404);
 assert.equal((await f.raw(`/production-orders/${f.order.id}/pdf/extra`,undefined,{cookie:f.cookie})).status,403);
 f.db.prepare("UPDATE positions SET permissions='[]',access_mode='standard' WHERE id=(SELECT position_id FROM users WHERE id=?)").run(f.user.id);
 assert.equal((await f.raw(path,undefined,{cookie:f.cookie})).status,403);
});
test('PDF rejects unsafe or foreign QR origins and accepts browser origin behind proxy',async t=>{
 const f=await fixture(t);for(const origin of ['javascript:alert(1)','https://user:pass@example.com','https://foreign.example','https://example.com/path'])assert.equal((await f.raw(`/production-orders/${f.order.id}/pdf?origin=${encodeURIComponent(origin)}`)).status,400,origin);
 const r=await f.raw(`/production-orders/${f.order.id}/pdf?origin=https%3A%2F%2Ferp.example`,undefined,{headers:{Referer:'https://erp.example/production'}});assert.equal(r.status,200);
});

test('task sheet projection contains only planned material identity, quantity and note',async()=>{
 const {productionTaskRows}=await import('../server/production-pdf.js');
 assert.deepEqual(productionTaskRows({items:[{name:'中文材料',barcode:'M-1',specification:'规格',unit:'件',planned_quantity:20,note:'注意温度',actual_quantity:5,issued_quantity:9,available_quantity:4,cost_cents:777,stock:888}]}),[['中文材料','M-1','规格','件','20','注意温度']]);
});
test('renderer handles multi-page long Unicode text and all planned rows',async()=>{
 const {renderProductionPdf}=await import('../server/production-pdf.js');
 const order={number:'SC-TEST',product_name:'中文产品',planned_quantity:10,unit:'件',note:'长备注'.repeat(2500),items:Array.from({length:90},(_,i)=>({name:`材料${i}`,note:'材料说明'.repeat(35),planned_quantity:i+1}))};
 const bytes=await renderProductionPdf({order,warehouseName:'中文仓库',registrationUrl:'https://erp.example/?warehouse_id=1#production?register=1'});
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>6);
 assert.match(bytes.toString('latin1'),/FontFile3/);
});
test('a small task stays on one page including its footer',async()=>{
 const {renderProductionPdf}=await import('../server/production-pdf.js');
 const bytes=await renderProductionPdf({order:{number:'SC-SMALL',product_name:'中文产品',planned_quantity:10,unit:'件',note:'备注',items:Array.from({length:6},(_,i)=>({name:`材料${i}`,planned_quantity:i+1}))},warehouseName:'主仓库',registrationUrl:'https://erp.example/'});
 assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
});
test('long void reasons keep QR image inside printable content bounds',async()=>{
 const {default:PDFDocument}=await import('pdfkit');const {renderProductionPdf}=await import('../server/production-pdf.js');
 const original=PDFDocument.prototype.image;const positions=[];
 PDFDocument.prototype.image=function(source,x,y,options){positions.push({y,height:options.height});return original.call(this,source,x,y,options);};
 try {await renderProductionPdf({order:{number:'SC-VOID',status:'void',void_reason:Array(32).fill('原因').join('\n'),product_name:'产品',unit:'件',planned_quantity:1,items:[]},warehouseName:'仓库',registrationUrl:'https://erp.example/'});}finally {PDFDocument.prototype.image=original;}
 assert.equal(positions.length,1);assert.ok(positions[0].y+positions[0].height<=770,JSON.stringify(positions[0]));
});
test('material rows fitting a fresh page stay together instead of splitting across pages',async()=>{
 const {renderProductionPdf}=await import('../server/production-pdf.js');
 const bytes=await renderProductionPdf({order:{number:'SC-ROWS',product_name:'产品',unit:'件',planned_quantity:1,note:'备注',items:Array.from({length:3},(_,i)=>({name:`材料${i}`,note:Array(24).fill('材料说明').join('\n'),planned_quantity:1}))},warehouseName:'仓库',registrationUrl:'https://erp.example/'});
 assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,4);
});
