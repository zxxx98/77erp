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
  assert.equal(operationWageCents({ unit_price: 2.5, currency: 'CNY', multiplier: 1.2 }, { quantity: 3 }), 900);
  assert.equal(operationWageCents({ unit_price: 2.5, currency: 'CNY' }, { quantity: 3, multiplier: 1.2 }), 900);
  assert.equal(operationWageCents({ unit_price: 0.005, currency: 'CNY' }, { quantity: 1, multiplier: 1 }), 1);
  assert.equal(operationWageCents({ unit_price: 0.1, currency: 'VND' }, { quantity: 0.1, multiplier: 0.5 }), 1);
  assert.equal(operationWageCents({}, { quantity: 1 }), null);
  assert.equal(operationWageCents({ unit_price: 0, currency: 'VND' }, { quantity: 1 }), 0);
  for (const multiplier of [0, -1, null, '2', 1.00001, Infinity, NaN, 100000000])
    assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), multiplier }], edges: [] }), /倍率/);
  for (const unit_price of [-1, '2', 0.00001, Infinity, NaN, 100000000])
    assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), unit_price, currency: 'CNY' }], edges: [] }), /单价/);
  assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), unit_price: 1 }], edges: [] }), /币种/);
  assert.throws(() => validateProcessGraph({ nodes: [{ ...node('a'), currency: 'INVALID' }], edges: [] }), /币种/);
  assert.throws(() => operationWageCents({ unit_price: 99999999, currency: 'CNY' }, { quantity: 99999999, multiplier: 99999999 }), /范围/);
});

test('payroll uses immutable snapshots, active worker reports, separate currencies, all pages and exact date boundaries', async t => {
  const f = await fixture(t, { graph: { ...priced, nodes: priced.nodes.map((n, i) => ({ ...n, ...(i === 0 ? { multiplier: 1.5 } : i === 1 ? { multiplier: 2 } : {}) })) } });
  const admin = f.db.prepare('SELECT id FROM users WHERE username=?').get('routeadmin').id;
  let order = await f.start(await f.create());
  order = f.ok(await f.report(order, 'cut', 4));
  const first = order.operation_routes[0].reports[0];
  order = f.ok(await f.report(order, 'weld', 4));
  order = f.ok(await f.complete(order, 2));
  const url = `/payroll?worker_id=${admin}${period}`;
  let stats = f.ok(await f.request(url + '&limit=1'));
  assert.equal(stats.total, 3); assert.equal(stats.has_more, true); assert.equal(stats.reports.length, 1);
  assert.equal(stats.summary.unpriced_count, 1);
  assert.equal(stats.daily.reduce((sum, row) => sum + row.report_count, 0), 2);
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
  assert.ok(stats.daily.every(row => row.currency === 'USD'));
  assert.equal(stats.daily.reduce((sum, row) => sum + row.amount_cents, 0), 99);
  assert.equal(stats.reports.find(row => row.id === first.id).amount_cents, 1500);
  for (const suffix of ['&offset=-1', '&limit=101', '&offset=abc']) assert.equal((await f.request(url + suffix)).status, 400);
  assert.equal((await f.request(`/payroll?worker_id=${admin}&start_at=2026-02-30T00:00:00.000Z&end_at=2027-01-01T00:00:00.000Z`)).status, 400);
  assert.equal((await f.request(`/payroll?worker_id=${admin}`)).status, 400);
});

test('payroll enforces finance permission and warehouse scope, attributes work to worker instead of registrar, and preserves inactive members', async t => {
  const f = await fixture(t, { graph: { ...priced, nodes: priced.nodes.map((n, i) => i === 0 ? { ...n, multiplier: 2 } : n) } });
  const position = f.ok(await f.request('/positions', { name: '财务', access_mode: 'standard', permissions: ['finance'] }));
  f.ok(await f.request('/users', {username:'accountant',employee_no:'F001',name:'财务成员',password:'Finance-1234',role:'employee',position_id:position.id}));
  const accountant = f.db.prepare("SELECT id FROM users WHERE username='accountant'").get();
  const workerPosition = f.ok(await f.request('/positions', {name:'登记员',access_mode:'production_only',permissions:['production_register']}));
  f.ok(await f.request('/users', {username:'workerpay',employee_no:'W001',name:'作业成员',password:'Worker-1234',role:'employee',position_id:workerPosition.id}));
  const worker = f.db.prepare("SELECT id FROM users WHERE username='workerpay'").get();
  let order = await f.start(await f.create({ user_ids: [worker.id] }));
  order = f.ok(await f.report(order, 'cut', 3, '', {worker_id:worker.id}));
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

test('daily earnings use the requested time zone including DST, separate currencies and ignore pagination', async t => {
  const f = await fixture(t, { graph: priced });
  const admin = f.db.prepare("SELECT id FROM users WHERE username='routeadmin'").get().id;
  let order = await f.start(await f.create());
  const timestamps = ['2026-03-08T04:30:00.000Z', '2026-03-08T05:30:00.000Z', '2026-03-09T04:30:00.000Z'];
  for (const created of timestamps) {
    order = f.ok(await f.report(order, 'cut', 1));
    f.db.prepare('UPDATE production_operation_reports SET created_at=? WHERE id=?').run(created, order.operation_routes[0].reports[0].id);
  }
  order = f.ok(await f.report(order, 'weld', 1));
  f.db.prepare('UPDATE production_operation_reports SET created_at=? WHERE id=?').run(timestamps[1], order.operation_routes[0].reports[0].id);
  const url = `/payroll?worker_id=${admin}&start_at=2026-03-07T05:00:00.000Z&end_at=2026-03-10T04:00:00.000Z`;
  const stats = f.ok(await f.request(url + '&time_zone=America%2FNew_York&limit=1'));
  assert.equal(stats.time_zone, 'America/New_York');
  assert.equal(stats.reports.length, 1); assert.equal(stats.total, 4);
  assert.deepEqual(stats.daily, [
    { date: '2026-03-07', currency: 'CNY', amount_cents: 250, report_count: 1 },
    { date: '2026-03-08', currency: 'CNY', amount_cents: 250, report_count: 1 },
    { date: '2026-03-08', currency: 'USD', amount_cents: 12, report_count: 1 },
    { date: '2026-03-09', currency: 'CNY', amount_cents: 250, report_count: 1 },
  ]);
  for (const total of stats.currencies) assert.equal(stats.daily.filter(row => row.currency === total.currency).reduce((sum, row) => sum + row.amount_cents, 0), total.amount_cents);
  assert.deepEqual(f.ok(await f.request(url + '&time_zone=America%2FNew_York&limit=1&offset=1')).daily, stats.daily);
  const shanghai = f.ok(await f.request(url + '&time_zone=Asia%2FShanghai'));
  assert.deepEqual(shanghai.daily[0], { date: '2026-03-08', currency: 'CNY', amount_cents: 500, report_count: 2 });
  assert.equal((await f.request(url + '&time_zone=Invalid%2FZone')).status, 400);
  assert.equal((await f.request(url + '&time_zone=')).status, 400);
});

test('sync operation prices updates production order route snapshot and recalculates unpriced payroll', async t => {
  const unpricedSerial = { nodes: [node('cut','下料'),node('weld','焊接'),node('out','检验')], edges: [{from:'cut',to:'weld'},{from:'weld',to:'out'}] };
  const f = await fixture(t, { graph: unpricedSerial });
  const admin = f.db.prepare('SELECT id FROM users WHERE username=?').get('routeadmin').id;
  let order = await f.start(await f.create());
  order = f.ok(await f.report(order, 'cut', 10));
  const url = `/payroll?worker_id=${admin}${period}`;
  let stats = f.ok(await f.request(url));
  assert.equal(stats.summary.unpriced_count, 1);
  assert.equal(stats.currencies.length, 0);

  const withPrice = { ...unpricedSerial, nodes: unpricedSerial.nodes.map(n => n.id === 'cut' ? { ...n, unit_price: 15, currency: 'VND' } : n) };
  f.ok(await f.command(`/process-routes/${f.route.id}`, { name: f.route.name, note: '', enabled: 1, version: f.route.version, graph: withPrice }));

  stats = f.ok(await f.request(url));
  assert.equal(stats.summary.unpriced_count, 1);

  const employeePosition = f.ok(await f.request('/positions', { name: '普通员工', access_mode: 'standard', permissions: ['basic_view'] }));
  f.ok(await f.request('/users', { username: 'basicworker', employee_no: 'B001', name: '普通员工', password: 'Basic-1234', role: 'employee', position_id: employeePosition.id }));
  const basicLogin = await f.request('/auth/login', { username: 'basicworker', password: 'Basic-1234' }, { cookie: ' ' });
  const forbidden = await f.command(`/production-orders/${order.id}/sync-operation-prices`, { version: order.version }, { cookie: basicLogin.cookie });
  assert.equal(forbidden.status, 403);

  const stale = await f.command(`/production-orders/${order.id}/sync-operation-prices`, { version: order.version + 999 });
  assert.equal(stale.status, 409);

  const synced = f.ok(await f.command(`/production-orders/${order.id}/sync-operation-prices`, { version: order.version }));
  assert.equal(synced.operation_routes[0].graph.nodes.find(n => n.id === 'cut').unit_price, 15);
  assert.equal(synced.operation_routes[0].graph.nodes.find(n => n.id === 'cut').currency, 'VND');

  stats = f.ok(await f.request(url));
  assert.equal(stats.summary.unpriced_count, 0);
  assert.deepEqual(stats.currencies, [{ currency: 'VND', amount_cents: 15000 }]);
});

test('payroll production order search and per-worker breakdown aggregate across multiple workers and currencies', async t => {
  const f = await fixture(t, { graph: { ...priced, nodes: priced.nodes.map((n, i) => ({ ...n, ...(i === 0 ? { multiplier: 1.5 } : i === 1 ? { multiplier: 2 } : {}) })) } });
  const admin = f.db.prepare("SELECT id FROM users WHERE username='routeadmin'").get().id;
  const workerPosition = f.ok(await f.request('/positions', { name: '登记员', access_mode: 'production_only', permissions: ['production_register'] }));
  f.ok(await f.request('/users', { username: 'workerA', employee_no: 'WA01', name: '张工', password: 'Worker-1234', role: 'employee', position_id: workerPosition.id }));
  const workerA = f.db.prepare("SELECT id FROM users WHERE username='workerA'").get().id;
  const financePosition = f.ok(await f.request('/positions', { name: '财务', access_mode: 'standard', permissions: ['finance'] }));
  f.ok(await f.request('/users', { username: 'finuser', employee_no: 'FN01', name: '财务员', password: 'Finance-1234', role: 'employee', position_id: financePosition.id }));
  const finLogin = await f.request('/auth/login', { username: 'finuser', password: 'Finance-1234' }, { cookie: ' ' });
  const workerLogin = await f.request('/auth/login', { username: 'workerA', password: 'Worker-1234' }, { cookie: ' ' });

  let order1 = await f.start(await f.create({ user_ids: [workerA] }));
  const order2 = await f.create();
  order1 = f.ok(await f.report(order1, 'cut', 4, '', { worker_id: workerA }));
  order1 = f.ok(await f.report(order1, 'weld', 4));
  order1 = f.ok(await f.complete(order1, 2));

  // Search production orders with finance permission
  const searchAll = f.ok(await f.request('/payroll/production-orders', undefined, { cookie: finLogin.cookie }));
  assert.equal(searchAll.total, 2);
  const found1 = searchAll.orders.find(o => o.id === order1.id);
  assert.equal(found1.active_report_count, 3);
  assert.equal(found1.worker_count, 2);
  assert.equal(found1.status, 'in_progress');
  const found2 = searchAll.orders.find(o => o.id === order2.id);
  assert.equal(found2.active_report_count, 0);
  assert.equal(found2.worker_count, 0);

  const searchByNum = f.ok(await f.request(`/payroll/production-orders?q=${encodeURIComponent(order1.number)}`, undefined, { cookie: finLogin.cookie }));
  assert.equal(searchByNum.total, 1);
  assert.equal(searchByNum.orders[0].id, order1.id);

  // Breakdown for order1
  let orderStats = f.ok(await f.request(`/payroll/production-order?production_id=${order1.id}`, undefined, { cookie: finLogin.cookie }));
  assert.equal(orderStats.order.number, order1.number);
  assert.equal(orderStats.summary.active_count, 3);
  assert.equal(orderStats.summary.worker_count, 2);
  assert.equal(orderStats.summary.unpriced_count, 1);
  assert.deepEqual(orderStats.currencies.sort((a, b) => a.currency.localeCompare(b.currency)), [
    { currency: 'CNY', amount_cents: 1500 },
    { currency: 'USD', amount_cents: 99 },
  ]);
  const wA = orderStats.workers.find(w => w.worker_id === workerA);
  assert.equal(wA.worker_name, '张工');
  assert.equal(wA.employee_no, 'WA01');
  assert.equal(wA.active_count, 1);
  assert.deepEqual(wA.currencies, [{ currency: 'CNY', amount_cents: 1500 }]);
  assert.equal(wA.operations.length, 1);
  assert.equal(wA.operations[0].operation_name, '下料');
  assert.equal(wA.operations[0].quantity, 4);
  assert.equal(wA.operations[0].multiplier, 1.5);
  assert.equal(wA.operations[0].amount_cents, 1500);

  const wAdmin = orderStats.workers.find(w => w.worker_id === admin);
  assert.equal(wAdmin.active_count, 2);
  assert.equal(wAdmin.unpriced_count, 1);
  assert.deepEqual(wAdmin.currencies, [{ currency: 'USD', amount_cents: 99 }]);

  // Filter reports by worker_id while keeping full workers summary
  const filtered = f.ok(await f.request(`/payroll/production-order?production_id=${order1.id}&worker_id=${workerA}`, undefined, { cookie: finLogin.cookie }));
  assert.equal(filtered.workers.length, 2);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.reports[0].worker_id, workerA);

  // Voided report handling
  f.db.prepare("UPDATE production_operation_reports SET status='void',void_reason='作废测试' WHERE node_id='cut'").run();
  orderStats = f.ok(await f.request(`/payroll/production-order?production_id=${order1.id}`, undefined, { cookie: finLogin.cookie }));
  assert.equal(orderStats.summary.void_count, 1);
  assert.equal(orderStats.summary.active_count, 2);
  assert.equal(orderStats.summary.worker_count, 1);
  assert.equal(orderStats.workers.find(w => w.worker_id === workerA).void_count, 1);
  assert.equal(orderStats.workers.find(w => w.worker_id === workerA).active_count, 0);

  // Permissions, warehouse isolation and invalid queries
  for (const path of ['/payroll/production-orders', `/payroll/production-order?production_id=${order1.id}`]) {
    assert.equal((await f.request(path, undefined, { cookie: workerLogin.cookie })).status, 403);
  }
  const warehouse2 = f.ok(await f.request('/warehouses', { name: '二号仓' }));
  assert.equal((await f.request(`/payroll/production-order?production_id=${order1.id}`, undefined, { warehouseId: warehouse2.id })).status, 404);
  for (const bad of ['/payroll/production-orders?limit=0', '/payroll/production-orders?offset=-1', '/payroll/production-order', '/payroll/production-order?production_id=abc', `/payroll/production-order?production_id=${order1.id}&worker_id=abc`]) {
    assert.equal((await f.request(bad)).status, 400);
  }
});

test('operation price list and refresh require route editing rights, preserve costs and enforce assignment scope', async t => {
  const graph = { ...priced, nodes: priced.nodes.map((row, i) => i === 1 ? { ...row, unit_price: 0 } : row) };
  const f = await fixture(t, { graph, multi: true });
  const order = await f.create();
  const pricePath = `/production-orders/${order.id}/operation-prices`;
  const syncPath = `/production-orders/${order.id}/sync-operation-prices`;
  const login = async (username, permissions) => {
    const position = f.ok(await f.request('/positions', { name: username, access_mode: 'standard', permissions }));
    const user = f.ok(await f.request('/users', { username, employee_no: username, password: 'Prices-test-123', role: 'employee', position_id: position.id }));
    const result = await f.request('/auth/login', { username, password: 'Prices-test-123' }, { cookie: ' ' });
    return { cookie: result.cookie, position, user };
  };
  const editor = await login('priceeditor', ['production', 'bom']);
  const manager = await login('pricemanager', ['production', 'finance']);
  const worker = await login('priceworker', ['production_register', 'bom']);
  const get = (path, account, warehouseId = 1) => f.request(path, undefined, { cookie: account.cookie, warehouseId });
  assert.equal((await get(pricePath, manager)).status, 403);
  assert.equal((await f.command(syncPath, { version: order.version }, { cookie: manager.cookie })).status, 403);
  const list = f.ok(await get(pricePath, editor));
  assert.equal(list.routes.length, 2);
  assert.equal(list.routes[0].unit, '件');
  assert.deepEqual(list.routes[0].operations.map(row => row.unit_price), [2.5, 0, null]);
  assert.equal(JSON.stringify(list).includes('cost'), false);
  const ordinary = f.ok(await get(`/production-orders/${order.id}`, editor));
  assert.equal(ordinary.total_cost_cents, undefined);
  assert.equal(ordinary.operation_routes[0].graph.nodes[0].unit_price, undefined);
  const warehouse = f.ok(await f.request('/warehouses', { name: '工价隔离仓' }));
  assert.equal((await get(pricePath, editor, warehouse.id)).status, 404);
  assert.equal((await get(pricePath, worker)).status, 404);
  assert.equal((await f.command(syncPath, { version: order.version }, { cookie: worker.cookie })).status, 404);
  const assigned = f.ok(await f.command(`/production-orders/${order.id}/assign`, { version: order.version, user_ids: [worker.user.id], group_ids: [] }));
  assert.equal(f.ok(await get(pricePath, worker)).routes.length, 2);
  assert.equal((await f.command(syncPath, { version: order.version }, { cookie: editor.cookie })).status, 409);
  const body = { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, version: assigned.version };
  const response = await f.request(syncPath, body, { cookie: worker.cookie });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  f.db.prepare('UPDATE positions SET permissions=? WHERE id=?').run('["production_register"]', worker.position.id);
  assert.equal((await get(pricePath, worker)).status, 403);
  assert.equal((await f.request(syncPath, body, { cookie: worker.cookie })).status, 403, 'revoked edit rights also block replay');
  const current = await f.get(order.id);
  const voided = f.ok(await f.command(`/production-orders/${order.id}/void`, { version: current.version, reason: '工价只读测试' }));
  assert.equal((await get(pricePath, editor)).status, 200);
  assert.equal((await f.command(syncPath, { version: voided.version }, { cookie: editor.cookie })).status, 409);
});
