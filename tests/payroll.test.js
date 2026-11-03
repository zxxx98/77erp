import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { validateProcessGraph } from '../shared/process-routes.js';
import { operationWageCents } from '../shared/payroll.js';

const node = (id, name = id) => ({ id, name, note: '', x: 24, y: 24 });
const serial = { nodes: [node('cut','下料'),node('weld','焊接'),node('out','检验')], edges: [{from:'cut',to:'weld'},{from:'weld',to:'out'}] };
const parallel = { nodes: [node('cut'),node('part'),node('out')], edges: [{from:'cut',to:'out'},{from:'part',to:'out'}] };
async function fixture(t, { multi = false, graph = serial, routed = true, repeated = false, qualityStorage } = {}) {
  const {app,db}=createApp(':memory:', {qualityStorage}); const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
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

const period = '&start_at=2000-01-01T00%3A00%3A00.000Z&end_at=2100-01-01T00%3A00%3A00.000Z';
const priced = { ...serial, nodes: serial.nodes.map((node, i) => ({ ...node, ...(i < 2 ? { unit_price: i ? 0.1234 : 2.5, currency: i ? 'USD' : 'CNY' } : {}) })) };

test('piecework prices validate and round once with exact decimal arithmetic', () => {
  assert.equal(operationWageCents({ unit_price: 2.5, currency: 'CNY' }, { quantity: 3, multiplier: 1.2 }), 900);
  assert.equal(operationWageCents({ unit_price: 0.005, currency: 'CNY' }, { quantity: 1, multiplier: 1 }), 1);
  assert.equal(operationWageCents({ unit_price: 0.1, currency: 'VND' }, { quantity: 0.1, multiplier: 0.5 }), 1);
  assert.equal(operationWageCents({}, { quantity: 1 }), null);
  assert.equal(operationWageCents({ unit_price: 0, currency: 'VND' }, { quantity: 1 }), 0);
  for (const unit_price of [-1, '2', 0.00001, Infinity, NaN, 100000000])
    assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), unit_price, currency: 'CNY' }], edges: [] }), /单价/);
  assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), unit_price: 1 }], edges: [] }), /币种/);
  assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), currency: 'INVALID' }], edges: [] }), /币种/);
  assert.throws(() => operationWageCents({ unit_price: 99999999, currency: 'CNY' }, { quantity: 99999999, multiplier: 99999999 }), /范围/);
});

test('payroll uses immutable snapshots, active worker reports, separate currencies, all pages and exact date boundaries', async t => {
  const f = await fixture(t, { graph: priced });
  const admin = f.db.prepare('SELECT id FROM users WHERE username=?').get('routeadmin').id;
  let order = await f.start(await f.create());
  order = f.ok(await f.report(order, 'cut', 4, '', { multiplier: 1.5 }));
  const first = order.operation_routes[0].reports[0];
  order = f.ok(await f.report(order, 'weld', 4, '', { multiplier: 2 }));
  order = f.ok(await f.complete(order, 2));
  const url = `/payroll?worker_id=${admin}${period}`;
  let stats = f.ok(await f.request(url + '&limit=1'));
  assert.equal(stats.total, 3); assert.equal(stats.has_more, true); assert.equal(stats.reports.length, 1);
  assert.equal(stats.summary.unpriced_count, 1);
  assert.equal(stats.summary.production_count, 1);
  assert.deepEqual(stats.currencies.sort((a,b) => a.currency.localeCompare(b.currency)), [{ currency: 'CNY', amount_cents: 1500 }, { currency: 'USD', amount_cents: 99 }]);
  const cut = stats.operations.find(row => row.operation_name === '下料');
  assert.equal(cut.quantity, 4); assert.equal(cut.weighted_quantity, 6);
  const changed = { ...priced, nodes: priced.nodes.map(row => ({ ...row, unit_price: 100, currency: 'VND' })) };
  f.ok(await f.command(`/process-routes/${f.route.id}`, { name: f.route.name, note: '', enabled: 1, version: f.route.version, graph: changed }));
  assert.deepEqual(f.ok(await f.request(url)).currencies, stats.currencies.slice().reverse());
  assert.equal((await f.create()).operation_routes[0].graph.nodes[0].unit_price, 100);
  const at = first.created_at;
  const only = f.ok(await f.request(`/payroll?worker_id=${admin}&start_at=${encodeURIComponent(at)}&end_at=2100-01-01T00%3A00%3A00.000Z`));
  assert.equal(only.total, 3);
  assert.equal(f.ok(await f.request(`/payroll?worker_id=${admin}&start_at=2000-01-01T00%3A00%3A00.000Z&end_at=${encodeURIComponent(at)}`)).total, 0);
  f.db.prepare("UPDATE production_operation_reports SET status='void',void_reason='测试纠正' WHERE node_id='cut'").run();
  stats = f.ok(await f.request(url));
  assert.equal(stats.summary.void_count, 1); assert.equal(stats.summary.active_count, 2);
  assert.deepEqual(stats.currencies, [{currency: 'USD', amount_cents: 99}]);
  assert.equal(stats.reports.find(row => row.id === first.id).amount_cents, 1500);
  for (const suffix of ['&offset=-1', '&limit=101', '&offset=abc']) assert.equal((await f.request(url + suffix)).status, 400);
  assert.equal((await f.request(`/payroll?worker_id=${admin}&start_at=2026-02-30T00:00:00.000Z&end_at=2027-01-01T00:00:00.000Z`)).status, 400);
  assert.equal((await f.request(`/payroll?worker_id=${admin}`)).status, 400);
});

test('payroll enforces finance permission and warehouse scope, attributes work to worker instead of registrar, and preserves inactive members', async t => {
  const f = await fixture(t, { graph: priced });
  const position = f.ok(await f.request('/positions', { name: '财务', access_mode: 'standard', permissions: ['finance'] }));
  f.ok(await f.request('/users', {username:'accountant',employee_no:'F001',name:'财务成员',password:'Finance-1234',role:'employee',position_id:position.id}));
  const accountant = f.db.prepare("SELECT id FROM users WHERE username='accountant'").get();
  const workerPosition = f.ok(await f.request('/positions', {name:'登记员',access_mode:'production_only',permissions:['production_register']}));
  f.ok(await f.request('/users', {username:'workerpay',employee_no:'W001',name:'作业成员',password:'Worker-1234',role:'employee',position_id:workerPosition.id}));
  const worker = f.db.prepare("SELECT id FROM users WHERE username='workerpay'").get();
  let order = await f.start(await f.create({ user_ids: [worker.id] }));
  order = f.ok(await f.report(order, 'cut', 3, '', {worker_id:worker.id,multiplier:2}));
  const login = await f.request('/auth/login', {username:'accountant',password:'Finance-1234'}, {cookie:' '});
  const stats = f.ok(await f.request(`/payroll?worker_id=${worker.id}${period}`, undefined, {cookie:login.cookie}));
  assert.deepEqual(stats.currencies, [{ currency:'CNY',amount_cents:1500 }]);
  assert.equal(stats.reports[0].worker_name, '作业成员'); assert.equal(stats.reports[0].registered_by_name, 'routeadmin');
  assert.equal(f.ok(await f.request(`/payroll?worker_id=${accountant.id}${period}`)).total, 0);
  const workerLogin = await f.request('/auth/login',{username:'workerpay',password:'Worker-1234'}, {cookie:' '});
  for (const path of ['/payroll/members', `/payroll?worker_id=${worker.id}${period}`]) assert.equal((await f.request(path,undefined,{cookie:workerLogin.cookie})).status,403);
  const warehouse = f.ok(await f.request('/warehouses',{name:'第二仓库'}));
  assert.equal(f.ok(await f.request(`/payroll?worker_id=${worker.id}${period}`,undefined,{warehouseId:warehouse.id})).total,0);
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(worker.id);
  assert.equal(f.ok(await f.request('/payroll/members',undefined,{cookie:login.cookie})).members.find(row=>row.id===worker.id).active,0);
  assert.equal(f.ok(await f.request(`/payroll?worker_id=${worker.id}${period}`)).total,1);
  const backup=f.ok(await f.request('/backup'));
  f.ok(await f.command('/backup/preview',{backup}));
  backup.data.process_routes[0].graph=JSON.stringify({...priced,nodes:priced.nodes.map(n=>({...n,unit_price:-1,currency:'CNY'}))});
  assert.equal((await f.command('/backup/preview',{backup})).status,400);
});
