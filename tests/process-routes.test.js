import { recordAndCancel } from './helpers/pending-registration.js';
import { qualityChartEntries } from '../server/quality-charts.js';
import ExcelJS from 'exceljs';
import { readQualityWorkbook } from '../server/quality-workbook.js';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { migrateProcessRoutes } from '../server/process-routes.js';
import { validateProcessGraph, arrangeProcessGraph } from '../shared/process-routes.js';

const node = (id, name = id) => ({ id, name, note: '', x: 24, y: 24 });
const serial = { nodes: [node('cut','下料'),node('weld','焊接'),node('out','检验')], edges: [{from:'cut',to:'weld'},{from:'weld',to:'out'}] };
const parallel = { nodes: [node('cut'),node('part'),node('out')], edges: [{from:'cut',to:'out'},{from:'part',to:'out'}] };
const modelPrices = { ...serial,
  nodes: serial.nodes.map(n => ({ ...n, multiplier: 2, unit_price: 1, currency: 'CNY' })),
  price_tables: [{ id: 'model-b', name: 'B型号', prices: { cut: { unit_price: 3, currency: 'USD' }, out: { unit_price: 0, currency: 'USD' } } }],
};
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

test('route graph rejects loops, disconnected outputs and malformed nodes and arranges parallel branches',()=>{
  assert.equal(validateProcessGraph(serial).output,'out');
  assert.throws(()=>validateProcessGraph({...serial,edges:[...serial.edges,{from:'out',to:'cut'}]}),/循环/);
  assert.throws(()=>validateProcessGraph({...serial,edges:[]}),/唯一/);
  assert.throws(()=>validateProcessGraph({...serial,nodes:[...serial.nodes,node('cut')]}),/编号/);
  assert.throws(()=>validateProcessGraph({...serial,edges:[{from:'none',to:'cut'}]}),/不存在/);
  assert.equal(new Set(arrangeProcessGraph(parallel).nodes.map(n=>`${n.x},${n.y}`)).size,3);
});

test('BOM-selected model prices drive wages and snapshots; syncing follows the original table', async t => {
  const f = await fixture(t, { graph: modelPrices });
  let defaultOrder = await f.start(await f.create());
  const saveBom = async tableId => Object.assign(f.root, f.ok(await f.command(`/boms/${f.root.id}`, { ...f.root, route_price_table_id: tableId })));
  await saveBom('model-b');
  let modelOrder = await f.start(await f.create());
  const selected = modelOrder.operation_routes[0].graph;
  assert.equal(selected.price_table_id, 'model-b');
  assert.equal(selected.price_table_name, 'B型号');
  assert.equal(selected.price_tables, undefined);
  assert.equal(selected.nodes.find(n => n.id === 'weld').unit_price, undefined);
  assert.equal(selected.nodes.find(n => n.id === 'out').unit_price, 0);
  assert.equal(defaultOrder.operation_routes[0].graph.nodes[0].unit_price, 1);
  const overview = f.ok(await f.request(`/boms/${f.root.id}/process-overview`));
  assert.equal(overview.layers[0].route.graph.price_table_id, 'model-b');
  defaultOrder = f.ok(await f.report(defaultOrder, 'cut', 2));
  modelOrder = f.ok(await f.report(modelOrder, 'cut', 2));
  const payroll = async order => f.ok(await f.request(`/payroll/production-order?production_id=${order.id}`));
  assert.deepEqual((await payroll(defaultOrder)).currencies, [{ currency: 'CNY', amount_cents: 400 }]);
  assert.deepEqual((await payroll(modelOrder)).currencies, [{ currency: 'USD', amount_cents: 1200 }]);
  const changedGraph = structuredClone(modelPrices);
  changedGraph.nodes[0].unit_price = 50;
  changedGraph.price_tables[0].prices.cut.unit_price = 4;
  changedGraph.price_tables[0].name = 'B型号新价';
  f.ok(await f.command(`/process-routes/${f.route.id}`, { ...f.route, graph: changedGraph }));
  await saveBom(null);
  assert.deepEqual((await payroll(modelOrder)).currencies, [{ currency: 'USD', amount_cents: 1200 }]);
  modelOrder = f.ok(await f.command(`/production-orders/${modelOrder.id}/sync-operation-prices`, { version: modelOrder.version }));
  assert.equal(modelOrder.operation_routes[0].graph.price_table_name, 'B型号新价');
  assert.deepEqual((await payroll(modelOrder)).currencies, [{ currency: 'USD', amount_cents: 1600 }]);
  assert.deepEqual((await payroll(defaultOrder)).currencies, [{ currency: 'CNY', amount_cents: 400 }]);
  const backup = f.ok(await f.request('/backup'));
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal((await f.get(modelOrder.id)).operation_routes[0].graph.price_table_id, 'model-b');
  assert.deepEqual((await payroll(modelOrder)).currencies, [{ currency: 'USD', amount_cents: 1600 }]);
});

test('price table bindings validate routes, preserve older clients, and protect referenced tables', async t => {
  const f = await fixture(t, { graph: modelPrices, multi: true });
  const before = f.ok(await f.command('/production-orders/prepare', { bom_id: f.root.id, bom_version: f.root.version, planned_quantity: 10 }));
  const child = f.ok(await f.command(`/boms/${f.child.id}`, { ...f.child, route_price_table_id: 'model-b' }));
  assert.equal((await f.command('/production-orders', { bom_id: f.root.id, bom_version: f.root.version, planned_quantity: 10, note: '', structure_token: before.structure_token })).status, 409);
  const order = await f.create();
  assert.equal(order.operation_routes.find(r => r.path === '1').graph.nodes[0].unit_price, 3);
  assert.equal(order.operation_routes.find(r => r.path === '').graph.nodes[0].unit_price, 1);
  const preserved = f.ok(await f.command(`/boms/${child.id}`, { ...child, route_price_table_id: undefined }));
  assert.equal(preserved.route_price_table_id, 'model-b');
  for (const value of ['missing', 3, '', {}, []])
    assert.equal((await f.command(`/boms/${child.id}`, { ...preserved, route_price_table_id: value })).status, 400);
  const other = f.ok(await f.command('/process-routes', { name: '其他工艺', note: '', enabled: 1, graph: serial }));
  assert.equal((await f.command(`/boms/${child.id}`, { ...preserved, route_override_id: other.id, route_price_table_id: 'model-b' })).status, 400);
  const product = f.db.prepare('SELECT * FROM products WHERE id=?').get(f.half);
  const blocked = await f.request(`/products/${f.half}`, { ...product, customer_part_numbers: [], default_route_id: other.id }, { method: 'PUT' });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(f.db.prepare('SELECT default_route_id FROM products WHERE id=?').get(f.half).default_route_id, f.route.id);
  const remove = await f.command(`/process-routes/${f.route.id}`, { ...f.route, graph: { ...modelPrices, price_tables: [] } });
  assert.equal(remove.status, 409);
  assert.match(remove.data.error, /BOM引用/);
  const olderGraph = structuredClone(modelPrices); delete olderGraph.price_tables;
  const saved = f.ok(await f.command(`/process-routes/${f.route.id}`, { ...f.route, graph: olderGraph }));
  assert.deepEqual(saved.graph.price_tables, modelPrices.price_tables);
  const backup = f.ok(await f.request('/backup'));
  assert.equal(backup.data.boms.find(b => b.id === child.id).route_price_table_id, 'model-b');
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal(f.ok(await f.request(`/boms/${child.id}`)).route_price_table_id, 'model-b');
  for (const mutate of [
    b => b.data.boms.find(row => row.id === child.id).route_price_table_id = 'missing',
    b => { const route = b.data.process_routes.find(row => row.id === f.route.id); const graph = JSON.parse(route.graph); graph.price_tables[0].prices.cut.unit_price = -1; route.graph = JSON.stringify(graph); },
  ]) {
    const bad = structuredClone(backup); mutate(bad);
    assert.equal((await f.request('/backup/preview', { backup: bad })).status, 400);
  }
  const legacy = structuredClone(backup); legacy.version = 54;
  for (const row of legacy.data.boms) delete row.route_price_table_id;
  f.ok(await f.request('/backup/preview', { backup: legacy }));
});

test('model price tables reject invalid pricing and do not silently substitute deleted tables during sync', async t => {
  const f = await fixture(t, { graph: modelPrices });
  for (const mutate of [
    graph => graph.price_tables.push(structuredClone(graph.price_tables[0])),
    graph => graph.price_tables[0].prices.cut.unit_price = -1,
    graph => graph.price_tables[0].prices.cut.currency = 'BAD',
    graph => graph.price_tables[0].prices.unknown = { unit_price: 1, currency: 'CNY' },
    graph => graph.price_tables[0].prices.cut.multiplier = 3,
  ]) {
    const graph = structuredClone(modelPrices); mutate(graph);
    assert.equal((await f.command(`/process-routes/${f.route.id}`, { ...f.route, graph })).status, 400);
  }
  Object.assign(f.root, f.ok(await f.command(`/boms/${f.root.id}`, { ...f.root, route_price_table_id: 'model-b' })));
  const order = await f.create();
  f.ok(await f.command(`/boms/${f.root.id}`, { ...f.root, route_price_table_id: null }));
  f.ok(await f.command(`/process-routes/${f.route.id}`, { ...f.route, graph: { ...modelPrices, price_tables: [] } }));
  const sync = await f.command(`/production-orders/${order.id}/sync-operation-prices`, { version: order.version });
  assert.equal(sync.status, 400);
  assert.match(sync.data.error, /单价表不存在/);
  assert.equal((await f.get(order.id)).operation_routes[0].graph.nodes[0].unit_price, 3);
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
  order=await recordAndCancel(f,await f.report(order,'weld',1));
  order=f.ok(await f.report(order,'cut',6)); assert.equal(order.completed_quantity,null);assert.equal(order.receipt_documents.length,0);assert.equal(order.items[0].available_quantity,20);
  order=await recordAndCancel(f,await f.report(order,'weld',7));
  order=f.ok(await f.report(order,'weld',4));
  const before=f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n;
  order=await recordAndCancel(f,await f.complete(order,5));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n,before);
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

test('partial operation void preserves downstream progress, payroll and backup history', async t => {
  const f = await fixture(t, { graph: modelPrices }); let order = await f.start(await f.create());
  order = f.ok(await f.report(order, 'cut', 6));
  order = f.ok(await f.report(order, 'weld', 4));
  assert.deepEqual(f.ok(await f.request(`/payroll/production-order?production_id=${order.id}`)).currencies, [{ currency: 'CNY', amount_cents: 2000 }]);
  const report = order.operation_routes[0].reports.find(row => row.node_id === 'cut');
  const path = `/production-orders/${order.id}/operations/${report.id}/void`;
  for (const quantity of [0, 7, -1]) assert.equal((await f.command(path, { version: order.version, quantity, reason: '纠正' })).status, 400);
  assert.equal((await f.command(path, { version: order.version, quantity: 3, reason: '纠正' })).status, 409);
  order = f.ok(await f.command(path, { version: order.version, quantity: 2, reason: '纠正' }));
  assert.equal(order.operation_routes[0].operations.find(row => row.id === 'cut').completed_quantity, 4);
  assert.deepEqual(f.ok(await f.request(`/payroll/production-order?production_id=${order.id}`)).currencies, [{ currency: 'CNY', amount_cents: 1600 }]);
  const rows = order.operation_routes[0].reports.filter(row => row.node_id === 'cut');
  assert.deepEqual(rows.map(row => [row.status, row.quantity]).sort(), [['active', 4], ['void', 2]]);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.command('/backup/preview', { backup }));
  const original = backup.data.production_operation_reports.find(row => row.id === report.id);
  assert.equal(original.quantity, 4);
  const legacy = structuredClone(backup);
  for (const row of legacy.data.production_operation_reports) if (row.split_from_id === null) delete row.split_from_id;
  f.ok(await f.command('/backup/preview', { backup: legacy }));
  assert.equal((await f.command(path, { version: order.version, quantity: 1, reason: '纠正' })).status, 409);
});

test('partial operation void retains exact fractional quantities and a replayable audit trail', async t => {
  const f = await fixture(t); let order = await f.start(await f.create());
  order = f.ok(await f.report(order, 'cut', '1/3'));
  const report = order.operation_routes[0].reports[0];
  const path = `/production-orders/${order.id}/operations/${report.id}/void`;
  order = f.ok(await f.command(path, { version: order.version, quantity: '1/6', reason: '部分修正' }));
  assert.equal(order.operation_routes[0].operations.find(row => row.id === 'cut').completed_quantity_fraction, '1/6');
  order = f.ok(await f.command(path, { version: order.version, reason: '全部修正' }));
  assert.equal(order.operation_routes[0].operations.find(row => row.id === 'cut').completed_quantity, 0);
  f.ok(await f.command('/backup/preview', { backup: f.ok(await f.request('/backup')) }));
});

test('operation multiplier is configured on process route nodes, snapshotted onto reports, and survives backup', async t => {
  const f = await fixture(t, { graph: { ...serial, nodes: serial.nodes.map(n => n.id === 'cut' ? { ...n, multiplier: 2 } : n.id === 'out' ? { ...n, multiplier: 1.5 } : n) } });
  for (const multiplier of [0, -1, null, '2', 1.00001]) {
    assert.equal((await f.command(`/process-routes/${f.route.id}`, { name: f.route.name, note: '', enabled: 1, version: f.route.version, graph: { ...serial, nodes: serial.nodes.map(n => n.id === 'cut' ? { ...n, multiplier } : n) } })).status, 400);
  }
  let order = await f.start(await f.create());
  order = f.ok(await f.report(order, 'cut', 2));
  order = f.ok(await f.report(order, 'weld', 2));
  order = f.ok(await f.complete(order, 2));
  assert.equal(order.operation_routes[0].operations.find(node => node.id === 'cut').completed_quantity, 2);
  assert.deepEqual(order.operation_routes[0].reports.map(report => report.multiplier), [1.5, 1, 2]);
  const backup = f.ok(await f.request('/backup'));
  const preview = f.ok(await f.command('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, token: preview.token, current_token: preview.current_token, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.deepEqual((await f.get(order.id)).operation_routes[0].reports.map(report => report.multiplier), [1.5, 1, 2]);
  const old = structuredClone(backup); old.version = 44; for (const report of old.data.production_operation_reports) delete report.multiplier;
  const oldPreview = f.ok(await f.command('/backup/preview', { backup: old }));
  f.ok(await f.command('/backup/restore', { backup: old, token: oldPreview.token, current_token: oldPreview.current_token, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.ok((await f.get(order.id)).operation_routes[0].reports.every(report => report.multiplier === 1));
  const invalid = structuredClone(backup); invalid.data.production_operation_reports[0].multiplier = 0;
  assert.equal((await f.command('/backup/preview', { backup: invalid })).status, 400);
});

test('parallel join waits for all predecessors and partial output can complete an order with balanced operations',async t=>{
  const f=await fixture(t,{graph:parallel});let order=await f.start(await f.create());
  order=f.ok(await f.report(order,'cut',4));order=await recordAndCancel(f,await f.complete(order,1));
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
  const backup=f.ok(await f.request('/backup'));assert.equal(backup.version, 58);
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
  order=await recordAndCancel(f,await f.report(order, 'weld', 17, paths[0], { auto_overflow: true }));
  assert.ok((await f.get(order.id)).version > before);
  order = f.ok(await f.report(order, 'weld', 16, paths[1], { auto_overflow: true }));
  const allocations = [{path:paths[0],quantity:16,items:[{path:paths[0]+'.1',quantity:32}]}];
  const body = { request_id:randomUUID(),version:order.version,path:paths[0],operation_node_id:'out',completed_quantity:16,finish_order:false,note:'线盘 R001',scraps:[],auto_overflow:true,allocations };
  const invalid = structuredClone(body); invalid.request_id=randomUUID(); invalid.allocations[0].items[0].quantity=9999;
  order=await recordAndCancel(f,await f.command(`/production-orders/${order.id}/stages/complete`,invalid));
  order = await f.get(order.id);
  body.version=order.version;
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

async function acceptanceFixture(t, config={}) {
  const objects=new Map();
  const storage={async put(c,key,bytes){objects.set(key,Buffer.from(bytes));},async get(c,key){if(!objects.has(key))throw new Error('missing');return objects.get(key);},async remove(c,key){objects.delete(key);}};
  const f=await fixture(t,{...config,qualityStorage:storage});
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('验收');sheet.getCell('A1').value='测量值';sheet.getCell('B1').value=10;
  const buffer=Buffer.from(await book.xlsx.writeBuffer()),workbook=await readQualityWorkbook(buffer);
  const definition={sheetName:'验收',fields:[{id:'measurement',name:'测量值',type:'number',labelRegion:'A1',valueRegion:'B1',required:true}]};
  const credentials={account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret'};
  const settings=f.ok(await f.request('/settings/r2-backup'));
  f.ok(await f.request('/settings/r2-backup',{...settings,...credentials},{method:'PUT'}));
  const now=new Date().toISOString();objects.set('excel/templates/source.xlsx',buffer);
  const fid=Number(f.db.prepare('INSERT INTO quality_template_files(warehouse_id,account_id,bucket,object_key,filename,size,sha256,workbook,created_at) VALUES (1,?,?,?,?,?,?,?,?)').run(credentials.account_id,credentials.bucket,'excel/templates/source.xlsx','工序验收.xlsx',buffer.length,createHash('sha256').update(buffer).digest('hex'),JSON.stringify(workbook),now).lastInsertRowid);
  const templateId=Number(f.db.prepare('INSERT INTO quality_templates(warehouse_id,name,file_id,definition,enabled,created_by_name,updated_by_name,created_at,updated_at) VALUES (1,?,?,?,1,?,?,?,?)').run('工序测量',fid,JSON.stringify(definition),'routeadmin','routeadmin',now,now).lastInsertRowid);
  const revisionId=Number(f.db.prepare('INSERT INTO quality_template_revisions(template_id,revision,file_id,name,definition,created_by_name,created_at) VALUES (?,1,?,?,?,?,?)').run(templateId,fid,'工序测量',JSON.stringify(definition),'routeadmin',now).lastInsertRowid);
  f.db.prepare('UPDATE quality_templates SET published_revision=? WHERE id=?').run(revisionId,templateId);
  const graph=structuredClone(serial);for(const node of graph.nodes)node.acceptance_template_id=templateId;
  f.route=f.ok(await f.command(`/process-routes/${f.route.id}`,{...f.route,graph}));
  const acceptance={revision_id:revisionId,values:{B1:'12'},passed:true};
  return {...f,storage,objects,templateId,revisionId,acceptance};
}

test('operation acceptance validates binding, fixes revisions and enforces a separate permission on reports and final output',async t=>{
  const f=await acceptanceFixture(t);
  const group=f.ok(await f.command('/production-groups',{name:'验收组'}));
  const position=f.ok(await f.command('/positions',{name:'验收登记岗位',access_mode:'production_only',permissions:['production_register']}));
  const user=f.ok(await f.command('/users',{username:'inspector',employee_no:'inspector',password:'Worker-test-123',role:'employee',position_id:position.id,production_group_id:group.id}));
  const login=await f.request('/auth/login',{username:'inspector',password:'Worker-test-123'},{cookie:'no-session'}),options={cookie:login.cookie};
  let order=await f.start(await f.create({production_group_id:group.id}));
  assert.equal(order.operation_routes[0].operations[0].acceptance_revision_id,f.revisionId);
  const templatePath=`/production-orders/${order.id}/operations/acceptance-template?path=&node_id=cut`;
  for(const response of [await f.request(templatePath,undefined,options)]){
    assert.equal(response.status,403);assert.equal(response.data.error,'该工序需要验收，请通知验收员');
  }
  assert.equal(f.objects.size,1);
  f.ok(await f.request(`/positions/${position.id}`,{...position,permissions:['production_register','operation_accept']},{method:'PUT'}));
  f.ok(await f.request(templatePath,undefined,options));
  assert.equal((await f.request('/quality/templates',undefined,options)).status,403);
  assert.equal((await f.request(`/production-orders/${order.id}/operations/acceptances/9999`,undefined,options)).status,404);
  assert.equal((await f.report(order,'cut',1,'',{operation_acceptance:{...f.acceptance,passed:false}},options)).status,400);
  assert.equal((await f.report(order,'cut',1,'',{operation_acceptance:{...f.acceptance,values:{B1:''}}},options)).status,400);
  assert.equal((await f.report(order,'cut',1,'',{operation_acceptance:{...f.acceptance,values:{A1:'绕过标题',B1:'1'}}},options)).status,400);
  assert.equal(f.objects.size,1);
  // The production snapshot retains the old published revision even after disabling.
  f.db.prepare('UPDATE quality_templates SET enabled=0 WHERE id=?').run(f.templateId);
  const request_id=randomUUID(),body={request_id,operation_acceptance:f.acceptance};
  const before=order;
  order=f.ok(await f.report(order,'cut',2,'',body,options));
  assert.deepEqual(f.ok(await f.report(before,'cut',2,'',body,options)),order);
  const report=order.operation_routes[0].reports[0];assert.ok(report.acceptance_id);
  const detail=f.ok(await f.request(`/production-orders/${order.id}/operations/acceptances/${report.acceptance_id}`,undefined,options));
  assert.equal(detail.result.sheets[0].value.测量值,12);assert.equal(detail.created_by_name,'inspector');
  const saved=f.ok(await f.request(`/quality/acceptances/${report.acceptance_id}`));
  assert.equal(saved.revision_id,f.revisionId);assert.equal(saved.bindings[0].product_id,f.half);
  assert.equal(f.objects.size,2);
  const file=f.db.prepare('SELECT f.* FROM quality_template_files f JOIN quality_acceptances a ON a.file_id=f.id WHERE a.id=?').get(report.acceptance_id);
  const actual=new ExcelJS.Workbook();await actual.xlsx.load(f.objects.get(file.object_key));assert.equal(actual.getWorksheet('验收').getCell('B1').value,12);
  assert.equal((await f.request(`/quality/acceptances/${report.acceptance_id}`,{}, {method:'DELETE'})).status,409);
  order=f.ok(await f.report(order,'weld',2,'',{operation_acceptance:f.acceptance},options));
  // Inspection is retained independently when output still awaits settlement.
  const objectsBefore=f.objects.size;
  order=await recordAndCancel(f,await f.complete(order,3,'',{operation_acceptance:f.acceptance},options));
  assert.equal(f.objects.size,objectsBefore+1);
  order=f.ok(await f.complete(order,1,'',{operation_acceptance:f.acceptance},options));assert.equal(order.completed_quantity,1);
  assert.ok(order.operation_routes[0].reports.find(r=>r.node_id==='out').acceptance_id);
  f.db.prepare('UPDATE positions SET permissions=? WHERE id=?').run(JSON.stringify(['production_register']),position.id);
  assert.equal((await f.report(before,'cut',2,'',body,options)).status,403);
  assert.equal(user.id,report.worker_id);
});

test('acceptance is retained on missing predecessors, survives void and backup restore, and preserves old backups',async t=>{
  const f=await acceptanceFixture(t);let order=await f.start(await f.create());
  order=await recordAndCancel(f,await f.report(order,'weld',1,'',{operation_acceptance:f.acceptance}));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n,1);assert.equal(f.objects.size,2);
  order=f.ok(await f.report(order,'cut',2,'',{operation_acceptance:f.acceptance}));
  const report=order.operation_routes[0].reports[0];
  assert.equal(qualityChartEntries(f.db,1,f.templateId).length,1);
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/${report.id}/void`,{version:order.version,reason:'重新检验'}));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n,2);
  const detail=f.ok(await f.request(`/quality/acceptances/${report.acceptance_id}`));assert.equal(detail.operation_reports[0].status,'void');
  assert.equal(qualityChartEntries(f.db,1,f.templateId).length,0);
  const backup=f.ok(await f.request('/backup')),preview=f.ok(await f.command('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,token:preview.token,current_token:preview.current_token,confirmation:'RESTORE_BUSINESS_DATA'}));
  assert.equal((await f.get(order.id)).operation_routes[0].reports[0].acceptance_id,report.acceptance_id);
  for(const mutate of [b=>b.data.production_operation_reports[0].acceptance_id=null,b=>b.data.production_routes[0].graph=JSON.stringify({...JSON.parse(b.data.production_routes[0].graph),nodes:JSON.parse(b.data.production_routes[0].graph).nodes.map(n=>({...n,acceptance_revision_id:9999}))})]){
    const bad=structuredClone(backup);mutate(bad);assert.equal((await f.command('/backup/preview',{backup:bad})).status,400);
  }
  f.db.prepare("UPDATE production_orders SET status='void' WHERE id=?").run(order.id);
  const voided=await f.get(order.id);
  assert.equal((await f.command(`/production-orders/${order.id}/delete`,{version:voided.version})).status,409);
  f.ok(await f.command('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'}));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n,0);
});

test('acceptance storage failure and permission revocation during upload leave no report or acceptance',async t=>{
  const f=await acceptanceFixture(t);let order=await f.start(await f.create());
  const realPut=f.storage.put;
  f.storage.put=async()=>{throw new Error('storage unavailable');};
  assert.equal((await f.report(order,'cut',1,'',{operation_acceptance:f.acceptance})).status,502);
  assert.equal(f.objects.size,1);assert.equal((await f.get(order.id)).version,order.version);
  const position=f.ok(await f.command('/positions',{name:'可撤销验收岗位',permissions:['production','operation_accept']}));
  f.storage.put=async(...args)=>{await realPut(...args);f.db.prepare("UPDATE users SET role='employee',position_id=? WHERE username='routeadmin'").run(position.id);f.db.prepare('UPDATE positions SET permissions=? WHERE id=?').run('["production"]',position.id);};
  const result=await f.report(order,'cut',1,'',{operation_acceptance:f.acceptance});
  assert.equal(result.status,403);assert.equal(result.data.error,'该工序需要验收，请通知验收员');
  assert.equal(f.objects.size,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n,0);
});

test('route acceptance bindings reject drafts, disabled and foreign templates, and new orders capture the current publication',async t=>{
  const f=await acceptanceFixture(t);
  const bind=id=>f.command(`/process-routes/${f.route.id}`,{...f.route,graph:{...serial,nodes:serial.nodes.map(n=>({...n,acceptance_template_id:id}))}});
  assert.equal((await bind(-1)).status,400);assert.equal((await bind(9999)).status,400);
  f.db.prepare('UPDATE quality_templates SET enabled=0 WHERE id=?').run(f.templateId);
  assert.equal((await bind(f.templateId)).status,400);
  await assert.rejects(()=>f.create(),/停用|未发布/);
  f.db.prepare('UPDATE quality_templates SET enabled=1 WHERE id=?').run(f.templateId);
  const old=await f.create();
  const r=f.db.prepare('SELECT * FROM quality_template_revisions WHERE id=?').get(f.revisionId);
  const next=Number(f.db.prepare('INSERT INTO quality_template_revisions(template_id,revision,file_id,name,definition,created_by_name,created_at) VALUES (?,2,?,?,?,?,?)').run(r.template_id,r.file_id,r.name,r.definition,r.created_by_name,r.created_at).lastInsertRowid);
  f.db.prepare('UPDATE quality_templates SET published_revision=? WHERE id=?').run(next,f.templateId);
  const newer=await f.create();
  assert.equal((await f.get(old.id)).operation_routes[0].operations[0].acceptance_revision_id,f.revisionId);
  assert.equal(newer.operation_routes[0].operations[0].acceptance_revision_id,next);
  const warehouse=f.ok(await f.request('/warehouses',{name:'跨仓模板验证'}));
  assert.equal((await f.command('/process-routes',{name:'跨仓工艺',note:'',enabled:1,graph:f.route.graph},{warehouseId:warehouse.id})).status,400);
});

test('revoking production management during acceptance upload cannot end an order using group registration rights',async t=>{
  const f=await acceptanceFixture(t),group=f.ok(await f.command('/production-groups',{name:'权限竞态生产组'}));
  f.db.prepare("UPDATE users SET production_group_id=? WHERE username='routeadmin'").run(group.id);
  let order=await f.start(await f.create({production_group_id:group.id}));
  order=f.ok(await f.report(order,'cut',1,'',{operation_acceptance:f.acceptance}));
  order=f.ok(await f.report(order,'weld',1,'',{operation_acceptance:f.acceptance}));
  const position=f.ok(await f.command('/positions',{name:'仅验收登记',access_mode:'production_only',permissions:['production_register','operation_accept']}));
  const realPut=f.storage.put,objectsBefore=f.objects.size;
  f.storage.put=async(...args)=>{await realPut(...args);f.db.prepare("UPDATE users SET role='employee',position_id=? WHERE username='routeadmin'").run(position.id);};
  const result=await f.complete(order,1,'',{finish_order:true,operation_acceptance:f.acceptance});
  assert.equal(result.status,403);assert.match(result.data.error,/不能结束生产/);
  assert.equal(f.objects.size,objectsBefore);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n,0);
});

test('process routes filter by output product production_type and search by route name or output product name, barcode and id',async t=>{
  const f=await fixture(t,{routed:false});
  const finishedRoute=f.route;
  const semiRoute=f.ok(await f.command('/process-routes',{name:'半成品喷涂路线',note:'',enabled:1,graph:serial}));
  const bomRoute=f.ok(await f.command('/process-routes',{name:'BOM专属覆写路线',note:'',enabled:1,graph:serial}));
  const unsetRoute=f.ok(await f.command('/process-routes',{name:'未设类型路线',note:'',enabled:1,graph:serial}));
  const unusedRoute=f.ok(await f.command('/process-routes',{name:'未绑定空闲路线',note:'',enabled:1,graph:serial}));
  const createProduct=async(name,barcode,production_type,default_route_id=null)=>{
    const res=await f.request('/products',{name,barcode,category:'生产',unit:'件',cost:1,price:2,threshold:0,production_type,default_route_id});
    assert.equal(res.status,201,JSON.stringify(res.data));return res.data;
  };
  const finishedProd=await createProduct('豪华餐椅','FIN-CHAIR-001','成品',finishedRoute.id);
  const semiProd=await createProduct('喷涂椅架','SEMI-FRAME-002','半成品',semiRoute.id);
  const bomProd=await createProduct('定制圆桌','FIN-TABLE-003','成品',null);
  const unsetProd=await createProduct('打样配件','UNSET-PART-004','',unsetRoute.id);
  f.ok(await f.command('/boms',{name:'定制圆桌BOM',product_id:bomProd.id,base_quantity:1,base_unit:'件',note:'',enabled:1,route_override_id:bomRoute.id,items:[{product_id:f.raw,quantity:1,unit:'件',note:''}]}));
  const list=async(params={})=>{
    const qs=new URLSearchParams(params).toString();
    const res=await f.request(`/process-routes${qs?`?${qs}`:''}`);
    assert.equal(res.status,200,JSON.stringify(res.data));
    return res.data.routes;
  };
  const allIds=(await list()).map(r=>r.id);
  assert.deepEqual(new Set(allIds),new Set([finishedRoute.id,semiRoute.id,bomRoute.id,unsetRoute.id,unusedRoute.id]));
  const finishedRoutes=await list({production_type:'成品'});
  assert.deepEqual(new Set(finishedRoutes.map(r=>r.id)),new Set([finishedRoute.id,bomRoute.id]));
  assert.deepEqual(finishedRoutes.find(r=>r.id===finishedRoute.id).products,[{id:finishedProd.id,name:'豪华餐椅',barcode:'FIN-CHAIR-001',production_type:'成品'}]);
  assert.deepEqual(finishedRoutes.find(r=>r.id===bomRoute.id).products,[{id:bomProd.id,name:'定制圆桌',barcode:'FIN-TABLE-003',production_type:'成品'}]);
  assert.deepEqual((await list({production_type:'半成品'})).map(r=>r.id),[semiRoute.id]);
  assert.deepEqual((await list({production_type:'原料'})).map(r=>r.id),[]);
  assert.deepEqual(new Set((await list({production_type:'unset'})).map(r=>r.id)),new Set([unsetRoute.id,unusedRoute.id]));
  assert.deepEqual((await list({q:'喷涂椅架'})).map(r=>r.id),[semiRoute.id]);
  assert.deepEqual((await list({q:'FIN-TABLE-003'})).map(r=>r.id),[bomRoute.id]);
  assert.deepEqual((await list({q:`#${finishedProd.id}`})).map(r=>r.id),[finishedRoute.id]);
  assert.deepEqual((await list({production_type:'成品',q:'定制圆桌'})).map(r=>r.id),[bomRoute.id]);
  assert.deepEqual((await list({production_type:'成品',q:'喷涂椅架'})).map(r=>r.id),[]);
  assert.equal((await f.request('/process-routes?production_type=invalid')).status,400);
  const names=rows=>rows.map(r=>r.name);
  const asc=names(await list({production_type:'all',sort:'name_asc'})), desc=names(await list({production_type:'all',sort:'name_desc'}));
  assert.deepEqual(asc,[...asc].sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0));
  assert.deepEqual(desc,[...asc].reverse());
  const created=(await list({production_type:'all',sort:'created_asc'})).map(r=>r.id);
  assert.deepEqual((await list({production_type:'all',sort:'created_desc'})).map(r=>r.id),[...created].reverse());
  assert.equal((await f.request('/process-routes?sort=name%3Bdrop')).status,400);
});

test('custom route order puts new routes first, persists drags and keeps other rows in place when a subset moves', async t => {
  const f = await fixture(t, { routed: false });
  const make = async name => f.ok(await f.command('/process-routes', { name, note: '', enabled: 1, graph: serial })).id;
  const [b, c, d, e] = [await make('B'), await make('C'), await make('D'), await make('E')];
  const ids = async (params = '') => (await f.request(`/process-routes${params}`)).data.routes.map(r => r.id);
  const a = f.route.id;
  assert.deepEqual(await ids(), [e, d, c, b, a], 'new routes appear first');
  // Move the fifth to the first position.
  assert.equal((await f.command('/process-routes/reorder', { ids: [a, e, d, c, b] })).status, 200);
  assert.deepEqual(await ids(), [a, e, d, c, b]);
  assert.deepEqual(await ids('?sort=custom'), [a, e, d, c, b]);
  // Editing or toggling a route must not disturb the manual order.
  const row = (await f.request(`/process-routes/${c}`)).data;
  f.ok(await f.command(`/process-routes/${c}/status`, { version: row.version, enabled: 0 }));
  assert.deepEqual(await ids(), [a, e, d, c, b]);
  // Reordering a subset keeps the other rows' slots.
  assert.equal((await f.command('/process-routes/reorder', { ids: [b, e] })).status, 200);
  assert.deepEqual(await ids(), [a, b, d, c, e]);
  const created = f.ok(await f.command('/process-routes', { name: 'F', note: '', enabled: 1, graph: serial })).id;
  assert.deepEqual(await ids(), [created, a, b, d, c, e]);
  for (const bad of [[a], [a, a], [a, 0], [a, 'x'], 'x', Array.from({ length: 101 }, (_, i) => i + 1)])
    assert.equal((await f.command('/process-routes/reorder', { ids: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await f.command('/process-routes/reorder', { ids: [a, 99999] })).status, 409);
  const other = f.ok(await f.request('/warehouses', { name: '路线分仓' })).id;
  assert.equal((await f.command('/process-routes/reorder', { ids: [a, b] }, { warehouseId: other })).status, 409);
  assert.deepEqual(await ids(), [created, a, b, d, c, e]);
});

test('post-processing price tables snapshot per binding and sync the original table without changing materials', async t => {
  const f = await fixture(t, { routed: false });
  let route = f.ok(await f.command('/process-routes', { name: '包装型号工艺', note: '', enabled: 1, route_kind: 'post_processing',
    graph: { nodes: [{ ...node('pack'), unit_price: 2, currency: 'CNY', multiplier: 2, materials: [{ product_id: f.raw, quantity: 1 }] }, node('label')],
      edges: [{ from: 'pack', to: 'label' }], price_tables: [{ id: 'model-b', name: 'B型号', prices: { pack: { unit_price: 3, currency: 'USD' } } }] } }));
  const binding = (price_table_id, node_id = 'pack') => ({ route_id: route.id, route_version: route.version, node_id, price_table_id, product_coefficient: 2 });
  const plan = f.ok(await f.command('/production-orders/prepare', { bom_id: f.root.id, bom_version: f.root.version, planned_quantity: 10 }));
  for (const invalid of ['missing', 3, {}, '']) {
    assert.equal((await f.command('/production-orders', { bom_id: f.root.id, bom_version: f.root.version, planned_quantity: 10, note: '', structure_token: plan.structure_token,
      post_processing_operations: [binding(invalid)] })).status, 400);
  }
  assert.equal((await f.command('/production-orders', { bom_id: f.root.id, bom_version: f.root.version, planned_quantity: 10, note: '', structure_token: plan.structure_token,
    post_processing_operations: [binding(null), binding('model-b')] })).status, 400);
  let defaultOrder = await f.start(await f.create({ post_processing_operations: [binding(undefined)] }));
  let modelOrder = await f.start(await f.create({ post_processing_operations: [binding('model-b'), binding('model-b', 'label')] }));
  const snapshot = modelOrder.operation_routes[0];
  assert.equal(snapshot.graph.price_table_id, 'model-b');
  assert.equal(snapshot.graph.price_table_name, 'B型号');
  assert.equal(snapshot.graph.price_tables, undefined);
  assert.equal(snapshot.graph.nodes[0].unit_price, 3);
  assert.equal(snapshot.product_coefficient, 2);
  assert.equal(modelOrder.operation_routes[1].graph.nodes[0].unit_price, undefined);
  const materials = structuredClone(snapshot.graph.nodes[0].materials);
  const output = order => f.complete(order, 10, '', { operation_node_id: undefined });
  defaultOrder = f.ok(await output(defaultOrder));
  modelOrder = f.ok(await output(modelOrder));
  defaultOrder = f.ok(await f.report(defaultOrder, 'pack', 2, defaultOrder.operation_routes[0].path));
  modelOrder = f.ok(await f.report(modelOrder, 'pack', 2, snapshot.path));
  const payroll = async order => f.ok(await f.request(`/payroll/production-order?production_id=${order.id}`)).currencies;
  assert.deepEqual(await payroll(defaultOrder), [{ currency: 'CNY', amount_cents: 800 }]);
  assert.deepEqual(await payroll(modelOrder), [{ currency: 'USD', amount_cents: 1200 }]);
  const graph = structuredClone(route.graph);
  graph.nodes[0].unit_price = 50;
  graph.nodes[0].materials[0].quantity = 9;
  graph.price_tables[0].name = 'B型号新价';
  graph.price_tables[0].prices.pack.unit_price = 4;
  route = f.ok(await f.command(`/process-routes/${route.id}`, { ...route, graph }));
  assert.deepEqual(await payroll(modelOrder), [{ currency: 'USD', amount_cents: 1200 }]);
  modelOrder = f.ok(await f.command(`/production-orders/${modelOrder.id}/sync-operation-prices`, { version: modelOrder.version }));
  assert.equal(modelOrder.operation_routes[0].graph.price_table_name, 'B型号新价');
  assert.deepEqual(modelOrder.operation_routes[0].graph.nodes[0].materials, materials);
  assert.equal(modelOrder.operation_routes[0].product_coefficient, 2);
  assert.deepEqual(await payroll(modelOrder), [{ currency: 'USD', amount_cents: 1600 }]);
  assert.deepEqual(await payroll(defaultOrder), [{ currency: 'CNY', amount_cents: 800 }]);
  const backup = f.ok(await f.request('/backup'));
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal((await f.get(modelOrder.id)).operation_routes[0].graph.price_table_id, 'model-b');
  assert.deepEqual(await payroll(modelOrder), [{ currency: 'USD', amount_cents: 1600 }]);
  route = f.ok(await f.request(`/process-routes/${route.id}`));
  modelOrder = await f.get(modelOrder.id);
  route = f.ok(await f.command(`/process-routes/${route.id}`, { ...route, graph: { ...graph, price_tables: [] } }));
  assert.equal((await f.command(`/production-orders/${modelOrder.id}/sync-operation-prices`, { version: modelOrder.version })).status, 400);
  assert.deepEqual(await payroll(modelOrder), [{ currency: 'USD', amount_cents: 1600 }]);
});

test('post-processing counts cumulative root output and gates both production finish paths', async t => {
  const f = await fixture(t, { routed: false });
  const route = f.ok(await f.command('/process-routes', { name: '包装工艺', note: '', enabled: 1,
    route_kind: 'post_processing', graph: { nodes: [{ ...node('pack'), unit_price: 2, currency: 'CNY' }, node('label')], edges: [{ from: 'pack', to: 'label' }] } }));
  assert.equal(route.route_kind, 'post_processing');
  assert.deepEqual(f.ok(await f.request('/process-routes?route_kind=post_processing')).routes.map(r => r.id), [route.id]);
  const binding = (node_id, product_coefficient) => ({ route_id: route.id, route_version: route.version, node_id, product_coefficient });
  let o = await f.start(await f.create({ planned_quantity: 110, post_processing_operations: [binding('pack', 20), binding('label', 30)] }));
  const output = (quantity, extra) => f.complete(o, quantity, '', { operation_node_id: undefined, ...extra });
  const report = (quantity, index = 0, extra) => f.report(o, ['pack', 'label'][index], quantity, o.operation_routes[index].path, extra);
  const finish = () => f.command(`/production-orders/${o.id}/finish`, {version:o.version});
  const limits = () => o.operation_routes.map(r => r.post_processing_limit);
  assert.deepEqual(limits(), [0, 0]);
  for (const [quantity, expected] of [[19,0],[1,1],[19,1],[61,5],[1,5]]) {
    o = f.ok(await output(quantity));
    assert.equal(limits()[0], expected);
  }
  assert.equal((await report(1.5)).status, 400);
  o = f.ok(await report(5));
  o=await recordAndCancel(f,await report(1));
  assert.equal((await finish()).status, 409);
  assert.equal((await output(9, {finish_order:true})).status, 409);
  assert.equal((await output(9, {finish_order:undefined})).status, 409);
  assert.equal((await f.get(o.id)).completed_quantity, 101);
  o = f.ok(await output(9));
  assert.equal(o.output_completed, true);
  assert.deepEqual(limits(), [6, 4]);
  o = f.ok(await report(1));
  assert.equal((await finish()).status, 409);
  assert.equal((await f.command(`/production-orders/${o.id}/batches/${o.batches.at(-1).id}/void`, {version:o.version,reason:'回退'})).status, 409);
  o = f.ok(await report(4, 1, {auto_overflow:true}));
  o = f.ok(await finish());
  assert.equal(o.status, 'completed');
  assert.equal(o.completed_quantity, 110);
  assert.equal(o.operation_routes[0].unit, '次');
  const stats = f.ok(await f.request(`/payroll/production-order?production_id=${o.id}`));
  const paid = stats.workers[0].operations.find(report => report.operation_name === 'pack');
  assert.deepEqual([paid.unit, paid.quantity, paid.amount_cents], ['次',6,1200]);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.request('/backup/preview', {backup}));
  for (const coefficient of [25, 20.00001, '20']) {
    const invalid = structuredClone(backup);
    invalid.data.production_routes.find(r => r.product_coefficient === 20).product_coefficient = coefficient;
    assert.equal((await f.request('/backup/preview', {backup:invalid})).status, 400);
  }
  const preview = f.ok(await f.request('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  assert.deepEqual((await f.get(o.id)).operation_routes.map(r => [r.product_coefficient,r.post_processing_limit,r.operations[0].completed_quantity]), [[20,6,6],[30,4,4]]);
});

test('short production confirmation releases the final count and protects reopening', async t => {
  const f = await fixture(t, { routed: false, multi: true });
  const route = f.ok(await f.command('/process-routes', { name: '贴标工艺', note: '', enabled: 1,
    route_kind: 'post_processing', graph: { nodes: [node('label')], edges: [] } }));
  let o = await f.start(await f.create({ post_processing_operations: [{ route_id: route.id, route_version: route.version, node_id: 'label', product_coefficient: 3 }] }));
  const output = (quantity, path, extra) => f.complete(o, quantity, path, {operation_node_id:undefined,...extra});
  o = f.ok(await output(5,'1'));
  assert.equal(o.operation_routes[0].post_processing_limit,0);
  assert.equal((await output(5,'',{finish_order:true})).status,409);
  o = f.ok(await output(5,''));
  const completionPath = `/production-orders/${o.id}/output-completion`;
  const confirm = {version:o.version,completed:true,request_id:randomUUID()};
  const pos = f.ok(await f.command('/positions', {name:'后处理登记员',permissions:['production_register'],access_mode:'production_only'}));
  f.ok(await f.command('/users', {username:'post-worker',employee_no:'post-worker',password:'Worker-test-123',position_id:pos.id}));
  const login = await f.request('/auth/login', {username:'post-worker',password:'Worker-test-123'}, {cookie:'no-session'});
  assert.equal((await f.command(completionPath, confirm, {cookie:login.cookie})).status,403);
  o = f.ok(await f.command(completionPath, confirm));
  assert.deepEqual(f.ok(await f.command(completionPath, confirm)),o);
  assert.equal(o.output_completion_confirmed,true);
  assert.equal(o.operation_routes[0].post_processing_limit,2);
  assert.equal((await output(1,'')).status,409);
  o = f.ok(await f.report(o,'label',2,o.operation_routes[0].path));
  const reopen = () => f.command(completionPath,{version:o.version,completed:false});
  assert.equal((await reopen()).status,409);
  const rootBatch = f.ok(await f.request(`/production-orders/${o.id}/stages/batches?path=`)).batches[0];
  assert.equal((await f.command(`/production-orders/${o.id}/stages/batches/${rootBatch.id}/void`,{version:o.version,reason:'回退'})).status,409);
  const report = o.operation_routes[0].reports[0];
  o = f.ok(await f.command(`/production-orders/${o.id}/operations/${report.id}/void`,{version:o.version,reason:'回退'}));
  o = f.ok(await reopen());
  assert.equal(o.output_completed,false);
  assert.equal(o.operation_routes[0].post_processing_limit,1);
});

test('post-processing templates are scoped to order bindings and v50 backups restore ordinary routes', async t => {
  const f = await fixture(t);
  let legacyOrder = await f.start(await f.create());
  legacyOrder = f.ok(await f.report(legacyOrder,'cut',1));
  const legacy = f.ok(await f.request('/backup'));
  legacy.version = 50;
  for (const row of legacy.data.process_routes) delete row.route_kind;
  for (const row of legacy.data.production_routes) {
    delete row.product_coefficient;
    row.additional_quantity = null;
    row.additional_materials = '[]';
  }
  for (const row of legacy.data.production_orders) delete row.output_completion_confirmed;
  for (const row of legacy.data.production_operation_reports) row.material_items = '[]';
  const preview = f.ok(await f.request('/backup/preview',{backup:legacy}));
  f.ok(await f.command('/backup/restore',{backup:legacy,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  assert.equal(f.ok(await f.request(`/process-routes/${f.route.id}`)).route_kind,'production');
  const restored = await f.get(legacyOrder.id);
  assert.equal(restored.output_completion_confirmed,false);
  assert.equal(restored.operation_routes[0].product_coefficient,null);
  const bom = f.ok(await f.request(`/boms/${f.root.id}`));

  const route = f.ok(await f.command('/process-routes', {name:'包装档案',note:'',enabled:1,route_kind:'post_processing',
    graph:{nodes:[node('pack')],edges:[]}}));
  assert.equal((await f.request('/products',{name:'错误绑定',barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,default_route_id:route.id})).status,400);
  assert.equal((await f.command('/boms',{name:'错误覆盖',product_id:f.half,base_quantity:1,base_unit:'件',note:'',enabled:1,
    route_override_id:route.id,items:[{product_id:f.raw,quantity:1,unit:'件',note:''}]})).status,400);
  const binding = {route_id:route.id,route_version:route.version,node_id:'pack',product_coefficient:1};
  const create = post_processing_operations => f.command('/production-orders',{bom_id:f.root.id,bom_version:bom.version,planned_quantity:10,note:'',post_processing_operations});
  for (const coefficient of [0, -1, 0.00001, '0.1']) assert.equal((await create([{...binding,product_coefficient:coefficient}])).status,400);
  assert.equal((await create([binding,binding])).status,400);
  assert.equal((await create([{...binding,route_version:route.version-1}])).status,409);
  const order = f.ok(await create([{...binding,product_coefficient:0.0001}]));
  assert.equal(order.operation_routes.find(r=>r.product_coefficient != null).product_coefficient,0.0001);
});

test('production rejects retired additional operations and exposes no dedicated data fields', async t => {
  const f = await fixture(t);
  const binding = {route_id:f.route.id,route_version:f.route.version,node_id:'out',quantity:2};
  await assert.rejects(() => f.create({additional_operations:[binding]}), /附加工序功能已移除/);
  let order = await f.start(await f.create());
  assert.equal(Object.hasOwn(order.operation_routes[0],'additional_quantity'),false);
  assert.equal(Object.hasOwn(order.operation_routes[0],'additional_materials'),false);
  assert.equal(Object.hasOwn(order,'additional_material_cost_cents'),false);
  assert.equal(Object.hasOwn(order.items[0],'additional_consumed_quantity'),false);
  const rejected = await f.report(order,'cut',1,'',{material_items:[{product_id:f.raw,quantity:1}]});
  assert.equal(rejected.status,400);
  assert.match(rejected.data.error,/工序报工不支持独立材料耗用/);
  order = f.ok(await f.report(order,'cut',1));
  assert.equal(Object.hasOwn(order.operation_routes[0].reports[0],'material_items'),false);
  const backup = f.ok(await f.request('/backup'));
  assert.equal(backup.version, 58);
  assert.equal(Object.hasOwn(backup.data.production_routes[0],'additional_quantity'),false);
  assert.equal(Object.hasOwn(backup.data.production_operation_reports[0],'material_items'),false);
});

test('removal drops unused SQLite columns while retaining ordinary operation reports', async t => {
  const f = await fixture(t);
  let order = await f.start(await f.create());
  order = f.ok(await f.report(order,'cut',1));
  const reports = order.operation_routes[0].reports;
  f.db.exec(`ALTER TABLE production_routes ADD COLUMN additional_quantity REAL CHECK(additional_quantity>0);
    ALTER TABLE production_routes ADD COLUMN additional_materials TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE production_operation_reports ADD COLUMN material_items TEXT NOT NULL DEFAULT '[]';`);
  migrateProcessRoutes(f.db);
  assert.deepEqual((await f.get(order.id)).operation_routes[0].reports,reports);
  assert.equal(f.db.prepare('PRAGMA table_info(production_routes)').all().some(c => c.name.startsWith('additional_')),false);
  assert.equal(f.db.prepare('PRAGMA table_info(production_operation_reports)').all().some(c => c.name === 'material_items'),false);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('registration without acceptance permission stays pending until a separate inspector approves it exactly once',async t=>{
  const f=await acceptanceFixture(t);
  const group=f.ok(await f.command('/production-groups',{name:'先登记后验收组'}));
  const position=f.ok(await f.command('/positions',{name:'普通报工员',access_mode:'production_only',permissions:['production_register']}));
  const worker=f.ok(await f.command('/users',{username:'reporter',employee_no:'reporter',password:'Worker-test-123',name:'原登记员',role:'employee',position_id:position.id,production_group_id:group.id}));
  const login=await f.request('/auth/login',{username:'reporter',password:'Worker-test-123'},{cookie:'no-session'}),options={cookie:login.cookie};
  let order=await f.start(await f.create({production_group_id:group.id}));
  const original=order,request_id=randomUUID();
  order=f.ok(await f.report(order,'cut',2,'',{request_id},options));
  assert.deepEqual(f.ok(await f.report(original,'cut',2,'',{request_id},options)),order);
  assert.equal(order.registration_status,'pending');
  const pending=order.operation_registrations[0];
  assert.equal(pending.status,'pending');assert.equal(pending.quantity,2);
  assert.equal(order.operation_routes[0].operations[0].completed_quantity,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n,0);
  assert.equal(f.objects.size,1);
  order=await recordAndCancel(f,await f.report(order,'weld',1,'',{},options));
  const approve=`/production-orders/${order.id}/operations/registrations/${pending.id}/approve`;
  const body={version:order.version,operation_acceptance:f.acceptance,request_id:randomUUID()};
  assert.equal((await f.command(approve,body,options)).status,403);
  const warehouse=f.ok(await f.command('/warehouses',{name:'验收隔离仓'}));
  assert.equal((await f.command(approve,body,{warehouseId:warehouse.id})).status,404);
  assert.equal((await f.command(approve,{...body,operation_acceptance:{...f.acceptance,values:{B1:''}}})).status,400);
  assert.equal(f.objects.size,1);
  const before=order;
  order=f.ok(await f.command(approve,body));
  assert.deepEqual(f.ok(await f.command(approve,body)),order);
  assert.equal(order.operation_registrations.find(row=>row.id===pending.id).status,'approved');
  assert.equal(order.operation_registrations.find(row=>row.id===pending.id).resolved_by_name,'routeadmin');
  const report=order.operation_routes[0].reports[0];
  assert.equal(report.registered_by,worker.id);assert.equal(report.worker_id,worker.id);assert.equal(report.registered_by_name,'原登记员');
  assert.equal(report.created_at,pending.created_at);
  assert.equal(order.operation_routes[0].operations[0].completed_quantity,2);
  assert.equal(f.db.prepare('SELECT created_by_name FROM quality_acceptances WHERE id=?').get(report.acceptance_id).created_by_name,'routeadmin');
  assert.equal((await f.command(approve,{...body,version:order.version,request_id:randomUUID()})).status,409);
  assert.equal((await f.report(before,'cut',1,'',{},options)).status,409);
  // Normal output is also deferred: neither materials nor a warehouse receipt move until acceptance passes.
  order=f.ok(await f.report(order,'weld',2,'',{operation_acceptance:f.acceptance}));
  order=f.ok(await f.complete(order,1,'',{},options));
  const output=order.operation_registrations[0];
  assert.equal(output.status,'pending');assert.equal(order.completed_quantity,null);assert.equal(order.receipt_documents.length,0);
  assert.equal(order.items[0].available_quantity,20);
  const backup=f.ok(await f.request('/backup'));
  const preview=f.ok(await f.command('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,token:preview.token,current_token:preview.current_token,confirmation:'RESTORE_BUSINESS_DATA'}));
  order=await f.get(order.id);assert.equal(order.operation_registrations[0].id,output.id);
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${output.id}/approve`,{version:order.version,operation_acceptance:f.acceptance}));
  assert.equal(order.completed_quantity,1);assert.equal(order.receipt_documents.length,1);assert.equal(order.items[0].available_quantity,18);
  assert.equal(order.batches[0].created_by,worker.id);assert.equal(order.batches[0].created_by_name,'原登记员');
  const saved=f.ok(await f.request('/backup'));f.ok(await f.command('/backup/preview',{backup:saved}));
});

test('pending registrations can be cancelled without production side effects and block order completion',async t=>{
  const f=await acceptanceFixture(t);let order=await f.start(await f.create());
  order=f.ok(await f.report(order,'cut',2));const pending=order.operation_registrations[0];
  assert.equal((await f.command(`/production-orders/${order.id}/finish`,{version:order.version})).status,409);
  assert.equal((await f.command(`/production-orders/${order.id}/void`,{version:order.version,reason:'取消生产'})).status,409);
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${pending.id}/cancel`,{version:order.version}));
  assert.equal(order.operation_registrations[0].status,'void');assert.equal(f.objects.size,1);
  assert.equal((await f.command(`/production-orders/${order.id}/operations/registrations/${pending.id}/approve`,{version:order.version,operation_acceptance:f.acceptance})).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n,0);
});

test('pending acceptance covers child and root stage output without consuming materials early',async t=>{
  const f=await acceptanceFixture(t,{multi:true});let order=await f.start(await f.create());
  const approve=async()=>{
    const row=order.operation_registrations.find(r=>r.status==='pending');
    order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${row.id}/approve`,{version:order.version,operation_acceptance:f.acceptance}));
  };
  for(const path of ['1','']) {
    for(const node of ['cut','weld']) {order=f.ok(await f.report(order,node,1,path));await approve();}
    const before=order;
    order=f.ok(await f.complete(order,1,path));
    assert.equal(order.operation_registrations.find(r=>r.status==='pending').quantity,1);
    assert.equal(order.stages.find(s=>s.path===path).completed_quantity,0);
    assert.deepEqual(order.stages.find(s=>s.path===path).items.map(i=>i.consumed_quantity),before.stages.find(s=>s.path===path).items.map(i=>i.consumed_quantity));
    await approve();
    assert.equal(order.stages.find(s=>s.path===path).completed_quantity,1);
  }
  assert.equal(order.completed_quantity,1);assert.equal(order.receipt_documents.length,1);
  const backup=f.ok(await f.request('/backup'));f.ok(await f.command('/backup/preview',{backup}));
});

test('approval preserves inspection when current balances still prevent settlement',async t=>{
  const f=await acceptanceFixture(t);let order=await f.start(await f.create());
  for(const node of ['cut','weld']) order=f.ok(await f.report(order,node,2,'',{operation_acceptance:f.acceptance}));
  order=f.ok(await f.complete(order,2));
  const first=order.operation_registrations[0];
  order=f.ok(await f.complete(order,2));
  const second=order.operation_registrations.find(r=>r.id!==first.id),stale=order.version;
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${first.id}/approve`,{version:order.version,operation_acceptance:f.acceptance}));
  const count=f.objects.size;
  const endpoint=`/production-orders/${order.id}/operations/registrations/${second.id}/approve`;
  assert.equal((await f.command(endpoint,{version:stale,operation_acceptance:f.acceptance})).status,409);
  order=f.ok(await f.command(endpoint,{version:order.version,operation_acceptance:f.acceptance}));
  assert.ok(order.operation_registrations.find(r=>r.id===second.id).acceptance_id);
  assert.equal(f.objects.size,count+1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n,1);
  assert.equal((await f.get(order.id)).operation_registrations.find(r=>r.id===second.id).status,'pending');
});

test('post-processing reports with templates stay pending without changing product output',async t=>{
  const f=await acceptanceFixture(t,{routed:false});
  const route=f.ok(await f.command('/process-routes',{name:'包装验收',note:'',enabled:1,route_kind:'post_processing',graph:{nodes:[{...node('pack','包装'),acceptance_template_id:f.templateId}],edges:[]}}));
  let order=await f.start(await f.create({post_processing_operations:[{route_id:route.id,route_version:route.version,node_id:'pack',product_coefficient:5}]}));
  order=f.ok(await f.complete(order,10,'',{operation_node_id:undefined}));
  const stock=order.items[0].available_quantity;
  order=f.ok(await f.report(order,'pack',1,'@post:1'));
  assert.equal(order.completed_quantity,10);assert.equal(order.operation_routes[0].operations[0].completed_quantity,0);
  assert.equal(order.items[0].available_quantity,stock);
  const row=order.operation_registrations[0];
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${row.id}/approve`,{version:order.version,operation_acceptance:f.acceptance}));
  assert.equal(order.operation_routes[0].operations[0].completed_quantity,1);
  assert.equal(order.completed_quantity,10);assert.equal(order.batches.length,1);
  f.ok(await f.command('/backup/preview',{backup:f.ok(await f.request('/backup'))}));
});

test('revoking acceptance permission during pending approval leaves the registration and storage unchanged',async t=>{
  const f=await acceptanceFixture(t);let order=await f.start(await f.create());
  order=f.ok(await f.report(order,'cut',1));
  const row=order.operation_registrations[0];
  const position=f.ok(await f.command('/positions',{name:'撤销验收资格',permissions:['production']}));
  const put=f.storage.put,count=f.objects.size;
  f.storage.put=async(...args)=>{await put(...args);f.db.prepare("UPDATE users SET role='employee',position_id=? WHERE username='routeadmin'").run(position.id);};
  const response=await f.command(`/production-orders/${order.id}/operations/registrations/${row.id}/approve`,{version:order.version,operation_acceptance:f.acceptance});
  assert.equal(response.status,403);assert.match(response.data.error,/工序验收权限/);
  assert.equal(f.objects.size,count);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quality_acceptances').get().n,0);
  assert.equal(f.db.prepare('SELECT status FROM production_operation_registrations WHERE id=?').get(row.id).status,'pending');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n,0);
});

test('shortage registration preserves mandatory inspection and migrates historical acceptance records',async t=>{
  const f=await acceptanceFixture(t);let order=await f.start(await f.create());
  order=f.ok(await f.report(order,'weld',1));const pending=order.operation_registrations[0];
  assert.equal(pending.kind,'acceptance');assert.equal(pending.initial_issues[0].kind,'predecessor');
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/reconcile`,{version:order.version}));
  assert.equal(order.pending_registration_count,1);assert.equal(order.operation_routes[0].reports.length,0);
  order=f.ok(await f.report(order,'cut',1,'',{operation_acceptance:f.acceptance}));
  assert.equal(order.registration_issues.length,0);
  const url=`/production-orders/${order.id}/operations/registrations/${pending.id}/approve`;
  assert.equal((await f.command(url,{version:order.version})).status,400);
  order=f.ok(await f.command(url,{version:order.version,operation_acceptance:f.acceptance}));
  assert.equal(order.pending_registration_count,0);assert.equal(order.operation_routes[0].operations.find(row=>row.id==='weld').completed_quantity,1);
  const backup=f.ok(await f.request('/backup'));backup.version=55;
  for(const row of backup.data.production_operation_registrations) {delete row.kind;delete row.initial_issues;}
  f.ok(await f.request('/backup/preview',{backup}));
});

test('inspector confirms material-deficient output; progress flows before accounting and settlement reuses the inspection',async t=>{
  const f=await acceptanceFixture(t,{multi:true});let order=await f.start(await f.create());
  for(const path of ['1','']) for(const node of ['cut','weld'])
    order=f.ok(await f.report(order,node,12,path,{operation_acceptance:f.acceptance}));
  order=f.ok(await f.complete(order,12,'1'));
  const row=order.operation_registrations.find(r=>r.status==='pending');
  assert.equal(order.flow_progress.stages.find(s=>s.path==='1').completed_quantity,0);
  order=f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${row.id}/approve`,{version:order.version,operation_acceptance:f.acceptance}));
  const inspected=order.operation_registrations.find(r=>r.id===row.id);
  assert.equal(inspected.status,'pending');assert.ok(inspected.acceptance_id);
  assert.equal(order.flow_progress.stages.find(s=>s.path==='1').completed_quantity,12);
  assert.equal(order.stages.find(s=>s.path==='1').completed_quantity,0);
  assert.equal(order.flow_progress.stages.find(s=>s.path==='').items[0].available_quantity,12);
  const detail=f.ok(await f.request(`/production-orders/${order.id}/operations/acceptances/${inspected.acceptance_id}`));
  assert.equal(detail.id,inspected.acceptance_id);
  assert.equal((await f.request(`/quality/acceptances/${inspected.acceptance_id}`,{}, {method:'DELETE'})).status,409);
  order=f.ok(await f.complete(order,12,'',{operation_acceptance:f.acceptance}));
  assert.equal(order.flow_progress.completed_quantity,12);assert.equal(order.pending_registration_count,2);
  const backup=f.ok(await f.request('/backup')),preview=f.ok(await f.command('/backup/preview',{backup}));
  f.ok(await f.command('/backup/restore',{backup,...preview,confirmation:'RESTORE_BUSINESS_DATA'}));
  order=await f.get(order.id);
  assert.equal(order.flow_progress.completed_quantity,12);
  order=f.ok(await f.command(`/production-orders/${order.id}/material-requests`,{version:order.version,type:'out',items:[{product_id:f.raw,quantity:4}],note:''}));
  const doc=order.material_documents.find(d=>d.status==='pending');
  f.ok(await f.command(`/production-material-documents/${doc.id}/confirm`,{version:doc.version}));order=await f.get(order.id);
  const count=f.objects.size;
  // Production management can settle a stored inspection without inspecting again.
  const position=f.ok(await f.command('/positions',{name:'仅结算管理',permissions:['production']}));
  const admin=f.db.prepare("SELECT id FROM users WHERE username='routeadmin'").get();
  f.db.prepare("UPDATE users SET role='employee',position_id=? WHERE id=?").run(position.id,admin.id);
  order=f.ok(await f.command(`/production-orders/${order.id}/finish`,{version:order.version}));
  assert.equal(order.status,'completed');assert.equal(order.completed_quantity,12);
  assert.equal(order.pending_registration_count,0);assert.equal(order.flow_progress.completed_quantity,12);
  assert.equal(f.objects.size,count);
  assert.equal(order.operation_routes.find(r=>r.path==='1').reports.find(r=>r.node_id==='out').acceptance_id,inspected.acceptance_id);
});
