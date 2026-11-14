import { recordAndCancel } from './helpers/pending-registration.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { allocate } from '../server/commerce.js';
import { migrateProcessRoutes } from '../server/process-routes.js';

async function fixture(t, { staged = false } = {}) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const blocked = new Set([1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
  while (server.address().port < 1024 || blocked.has(server.address().port)) {
    await new Promise(resolve => server.close(resolve));
    server.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: options.cookie ?? cookie ?? '', 'X-Warehouse-ID': String(options.warehouseId ?? 1) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = result => { assert.ok([200, 201].includes(result.status), JSON.stringify(result.data)); return result.data; };
  const command = (path, body, options) => request(path, { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body }, options);
  const save = (path, body, options) => command(path, body, options).then(ok);
  cookie = (await request('/auth/setup', { username: 'packadmin', password: 'Test-pack-123' })).cookie;
  await save('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = (name, options = {}) => request('/products', { name, barcode: name, category: '生产', unit: '件', cost: 1, price: 2, threshold: 0, ...options.product }, options).then(ok);
  const parent = await product('FINISHED'), raw = await product('RAW'), label = await product('LABEL', { product: { unit_round_up: 1 } });
  db.prepare('UPDATE products SET stock=1000,inventory_value_cents=100017 WHERE id IN (?,?)').run(raw.id, label.id);
  const makeBom = (name, product, items) => save('/boms', { name, product_id: product.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items });
  const rawInput = { product_id: raw.id, quantity: 1, unit: '件', note: '' };
  let bom;
  if (staged) {
    const half = await product('HALF');
    const child = await makeBom('半成品', half, [rawInput]);
    bom = await makeBom('成品', parent, [{ ...rawInput, product_id: half.id, usage_mode: 'explode', child_bom_id: child.id }]);
  } else bom = await makeBom('成品', parent, [rawInput]);
  const route = (materials, extra = {}, options) => command(extra.version ? '/process-routes/' + extra.id : '/process-routes', {
    name: '包装', route_kind: 'post_processing', enabled: 1, note: '', graph: {
      nodes: [{ id: 'pack', name: '包装', x: 24, y: 24, note: '', unit_price: 2, currency: 'CNY', materials }], edges: [],
    }, ...extra,
  }, options);
  const create = async (route, planned_quantity = 110) => {
    const input = { bom_id: bom.id, bom_version: bom.version, planned_quantity, note: '' };
    const plan = await save('/production-orders/prepare', input);
    return save('/production-orders', { ...input, structure_token: plan.structure_token,
      post_processing_operations: route.graph.nodes.map(node => ({ route_id: route.id, route_version: route.version, node_id: node.id, product_coefficient: 20 })) });
  };
  const mutate = (order, endpoint, body) => save('/production-orders/' + order.id + endpoint, { version: order.version, ...body });
  const get = id => request('/production-orders/' + id).then(ok);
  const issue = (doc, items) => save('/production-material-documents/' + doc.id + '/confirm', { version: doc.version, items });
  const complete = (order, quantity, path = '', actual = quantity) => mutate(order, staged ? '/stages/complete' : '/complete', {
    path, completed_quantity: quantity, items: staged ? [{ path: path ? '1.1' : '1', quantity: actual }] : [{ product_id: raw.id, quantity: actual }],
    scraps: [], finish_order: false,
  });
  const reportBody = (order, quantity) => ({ version: order.version, path: '@post:1', operation_node_id: 'pack', quantity, request_id: randomUUID() });
  const report = (order, body, options) => command('/production-orders/' + order.id + '/operations/report', body, options);
  return { db, request, ok, command, save, raw, label, product, route, create, mutate, get, issue, complete, reportBody, report, bom, parent };
}

test('post-processing templates validate material identity, four decimals and whole units', async t => {
  const f = await fixture(t), raw = { product_id: f.raw.id, quantity: 0.0001 }, label = { product_id: f.label.id, quantity: 1 };
  const other = await f.save('/warehouses', { name: '隔离仓' });
  const foreign = await f.product('FOREIGN', { warehouseId: other.id });
  const inactive = await f.product('INACTIVE');
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(inactive.id);
  for (const materials of [null, {}, [null], [raw, raw], [{ ...raw, product_id: String(f.raw.id) }], [{ ...raw, product_id: foreign.id }],
    [{ ...raw, product_id: inactive.id }], [{ ...raw, quantity: 0 }], [{ ...raw, quantity: '1' }], [{ ...raw, quantity: 0.00001 }], [{ ...label, quantity: 0.5 }]]) {
    assert.equal((await f.route(materials)).status, 400, JSON.stringify(materials));
  }
  assert.equal((await f.route([raw], { route_kind: 'production' })).status, 400);
  const route = f.ok(await f.route([{ ...raw, name: 'FORGED', unit: 'FORGED', cost_cents: 123 }, label]));
  assert.deepEqual(route.graph.nodes[0].materials.map(row => [row.product_id, row.name, row.barcode, row.unit, row.unit_round_up, row.quantity, row.cost_cents]), [
    [f.raw.id, 'RAW', 'RAW', '件', 0, 0.0001, undefined], [f.label.id, 'LABEL', 'LABEL', '件', 1, 1, undefined],
  ]);
  const extra = await f.product('TO-REMOVE');
  const saved = f.ok(await f.route([{ product_id: extra.id, quantity: 1 }], { id: route.id, version: route.version }));
  const blocked = await f.command('/products/batch/delete/preview', { ids: [extra.id] });
  assert.equal(f.ok(blocked).blocked.length, 1);
  await f.route([], { id: saved.id, version: saved.version }).then(f.ok);
  assert.equal(f.ok(await f.command('/products/batch/delete/preview', { ids: [extra.id] })).deletable.length, 1);
});

test('planned post-processing demands merge with BOM rows and recalculate from the saved snapshot', async t => {
  const f = await fixture(t), route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 0.3333 }, { product_id: f.label.id, quantity: 2 }]));
  let order = await f.create(route);
  assert.equal(order.operation_routes[0].post_processing_planned_runs, 6);
  assert.deepEqual(order.operation_routes[0].post_processing_materials.map(row => [row.quantity, row.planned_quantity]), [[0.3333, 1.9998], [2, 12]]);
  assert.deepEqual(order.items.map(row => [row.planned_quantity, row.post_processing_planned_quantity, row.total_planned_quantity]), [[110, 1.9998, 111.9998], [0, 12, 12]]);
  assert.deepEqual(order.items.map(row => row.net_planned_quantity), [111.9998, 12]);
  assert.equal(order.material_documents.length, 0);
  f.ok(await f.route([{ product_id: f.raw.id, quantity: 8 }], { id: route.id, version: route.version }));
  order = await f.mutate(order, '/sync-operation-prices', {});
  assert.deepEqual(order.operation_routes[0].graph.nodes[0].materials.map(row => row.quantity), [0.3333, 2]);
  order = await f.mutate(order, '', { planned_quantity: 100, note: '' });
  assert.equal(order.operation_routes[0].post_processing_planned_runs, 5);
  assert.deepEqual(order.items.map(row => row.total_planned_quantity), [101.6665, 10]);
  const started = await f.mutate(order, '/start', {});
  assert.deepEqual(started.material_documents[0].items.map(row => row.quantity), [101.6665, 10]);
  assert.deepEqual([f.raw.id, f.label.id].map(id => f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock), [1000, 1000]);
});

for (const staged of [false, true]) test('post reports share the issued pool, restore exact cost on void and round-trip backup (' + (staged ? 'staged' : 'ordinary') + ')', async t => {
  const f = await fixture(t, { staged }), route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 2 }, { product_id: f.label.id, quantity: 1 }]));
  let order = await f.mutate(await f.create(route), '/start', {});
  let doc = order.material_documents[0];
  await f.issue(doc, [{ product_id: f.raw.id, quantity: 122 }, { product_id: f.label.id, quantity: 4 }]);
  order = await f.get(order.id);
  if (staged) order = await f.complete(order, 110, '1');
  order = await f.complete(order, 100);
  assert.equal(order.operation_routes.at(-1).post_processing_limit, 5);
  const rejected = await f.report(order, f.reportBody(order, 5));
  order = await recordAndCancel(f, rejected);
  assert.deepEqual((await f.get(order.id)).items.map(row => row.available_quantity), staged ? [12, 4] : [22, 4]);
  assert.equal((await f.get(order.id)).operation_routes.at(-1).report_count, 0);
  order = await f.complete(order, 10);
  assert.equal(order.operation_routes.at(-1).post_processing_limit, 6);
  doc = order.material_documents[0];
  await f.issue(doc, [{ product_id: f.label.id, quantity: 2 }]);
  const receipt = order.receipt_documents.at(-1);
  await f.save('/production-receipts/' + receipt.id + '/confirm', { version: receipt.version });
  order = await f.get(order.id);
  const postedCost = order.receipt_documents.at(-1).total_cost_cents;
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.label.id);
  assert.equal((await f.report(order, f.reportBody(order, 6))).status, 409);
  f.db.prepare("UPDATE products SET active=1,unit='盒' WHERE id=?").run(f.label.id);
  assert.equal((await f.report(order, f.reportBody(order, 6))).status, 409);
  f.db.prepare("UPDATE products SET unit='件' WHERE id=?").run(f.label.id);
  const initialCosts = order.items.map(row => row.available_cost_cents);
  const stock = () => [f.raw.id, f.label.id].map(id => f.db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(id));
  const warehouse = stock();
  const payload = f.reportBody(order, 5);
  order = f.ok(await f.report(order, payload));
  const first = order.operation_routes.at(-1).reports[0];
  assert.deepEqual(first.post_processing_materials.map(row => [row.product_id, row.quantity, row.cost_cents]), [
    [f.raw.id, 10, allocate(initialCosts[0], 10, 12)], [f.label.id, 5, allocate(initialCosts[1], 5, 6)],
  ]);
  assert.deepEqual(f.ok(await f.report(order, payload)), order);
  order = f.ok(await f.report(order, f.reportBody(order, 1)));
  assert.deepEqual(order.items.map(row => row.available_quantity), [0, 0]);
  assert.equal(order.post_processing_material_cost_cents, initialCosts[0] + initialCosts[1]);
  assert.equal(order.total_consumed_cost_cents, order.total_cost_cents + order.post_processing_material_cost_cents);
  assert.equal(order.receipt_documents.at(-1).total_cost_cents, postedCost);
  assert.deepEqual(stock(), warehouse);
  order = await f.mutate(order, '/finish', {});
  const backup = f.ok(await f.request('/backup'));
  assert.equal(backup.version, 57);
  const tampered = structuredClone(backup);
  const row = tampered.data.production_operation_reports.find(row => row.id === first.id);
  const materials = JSON.parse(row.post_materials);
  materials[0].quantity += 1;
  row.post_materials = JSON.stringify(materials);
  assert.equal((await f.request('/backup/preview', { backup: tampered })).status, 400);
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  await f.save('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' });
  order = await f.get(order.id);
  const final = order.operation_routes.at(-1).reports[0];
  order = await f.mutate(order, '/operations/' + final.id + '/void', { reason: '纠正登记' });
  assert.equal(order.operation_routes.at(-1).operations[0].available_quantity, 1);
  assert.equal(order.operation_routes.at(-1).reports[0].status, 'void');
  assert.deepEqual(order.items.map(row => row.available_quantity), [2, 1]);
  assert.deepEqual(order.items.map(row => row.available_cost_cents), final.post_processing_materials.map(row => row.cost_cents));
  assert.deepEqual(stock(), warehouse);
  const position = await f.save('/positions', { name: '生产无财务', permissions: ['production'] });
  await f.save('/users', { username: 'operator', employee_no: 'operator', password: 'Test-oper-123', role: 'employee', position_id: position.id });
  const login = await f.request('/auth/login', { username: 'operator', password: 'Test-oper-123' }, { cookie: '' });
  const noCosts = f.ok(await f.request('/production-orders/' + order.id, undefined, login));
  assert.equal(Object.hasOwn(noCosts, 'post_processing_material_cost_cents'), false);
  assert.equal(Object.hasOwn(noCosts.items[0], 'post_processing_consumed_cost_cents'), false);
  const reports = f.ok(await f.request('/production-orders/' + order.id + '/operations/reports?snapshot_id=' + order.operation_routes.at(-1).id, undefined, login));
  assert.deepEqual(reports.reports[0].post_processing_materials.map(row => row.quantity), [2, 1]);
  assert.equal(Object.hasOwn(reports.reports[0], 'post_materials'), false);
  assert.equal(Object.hasOwn(reports.reports[0].post_processing_materials[0], 'cost_cents'), false);
  await f.save('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_operation_reports').get().n, 0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('separate post operations consume the same exact pool and void reopens finish rounding', async t => {
  const f = await fixture(t), material = { product_id: f.raw.id, quantity: 0.3333 };
  const operation = id => ({ id, name: id, x: 24, y: 24, note: '', materials: [material] });
  const route = f.ok(await f.route(undefined, { graph: { nodes: [operation('pack'), operation('label')], edges: [{ from: 'pack', to: 'label' }] } }));
  f.db.prepare('UPDATE products SET stock=21, inventory_value_cents=21000000 WHERE id=?').run(f.raw.id);
  let order = await f.mutate(await f.create(route, 20), '/start', {});
  assert.equal(order.material_documents[0].items[0].quantity, 20.6666);
  await f.issue(order.material_documents[0], [{ product_id: f.raw.id, quantity: 21 }]);
  order = await f.complete(await f.get(order.id), 20, '', '1/3');
  const receipt = order.receipt_documents[0];
  await f.save('/production-receipts/' + receipt.id + '/confirm', { version: receipt.version });
  order = await f.get(order.id);
  order = f.ok(await f.report(order, f.reportBody(order, 1)));
  const first = order.items[0];
  order = f.ok(await f.report(order, { ...f.reportBody(order, 1), path: '@post:2', operation_node_id: 'label' }));
  const second = order.operation_routes[1].reports[0];
  assert.equal(order.items[0].post_processing_consumed_quantity, 0.6666);
  assert.equal(second.post_processing_material_cost_cents, allocate(first.available_cost_cents, 0.3333, first.available_quantity_fraction));
  assert.equal(order.receipt_documents[0].total_cost_cents, receipt.total_cost_cents);
  order = await f.mutate(order, '/finish', {});
  const rounding = order.quantity_rounding.find(row => row.kind === 'material');
  assert.equal(rounding.quantity_fraction, '1/15000');
  assert.ok(rounding.cost_cents > 0);
  const backup = f.ok(await f.request('/backup'));
  f.ok(await f.request('/backup/preview', { backup }));
  order = await f.mutate(order, '/operations/' + second.id + '/void', { reason: '撤销第二道后处理' });
  assert.deepEqual(order.quantity_rounding, []);
  assert.equal(order.items[0].available_quantity_fraction, first.available_quantity_fraction);
  assert.equal(order.items[0].available_cost_cents, first.available_cost_cents);
  assert.equal(order.receipt_documents[0].total_cost_cents, receipt.total_cost_cents);
  assert.deepEqual(order.operation_routes.map(row => row.operations[0].available_quantity), [0, 1]);
});

test('partially voiding post-processing restores proportional materials and preserves costs in backup', async t => {
  const f = await fixture(t), route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 0.3333 }]));
  let order = await f.mutate(await f.create(route, 100), '/start', {});
  await f.issue(order.material_documents[0], [{ product_id: f.raw.id, quantity: 102 }]);
  order = await f.complete(await f.get(order.id), 100);
  order = f.ok(await f.report(order, f.reportBody(order, 5)));
  const report = order.operation_routes[0].reports[0], before = order.items[0];
  order = await f.mutate(order, `/operations/${report.id}/void`, { quantity: 2, reason: '纠正' });
  const rows = order.operation_routes[0].reports;
  const active = rows.find(row => row.status === 'active'), removed = rows.find(row => row.status === 'void');
  assert.equal(active.quantity, 3); assert.equal(removed.quantity, 2);
  assert.equal(active.post_processing_materials[0].quantity, 0.9999);
  assert.equal(removed.post_processing_materials[0].quantity, 0.6666);
  assert.equal(active.post_processing_material_cost_cents + removed.post_processing_material_cost_cents, report.post_processing_material_cost_cents);
  assert.equal(order.items[0].available_cost_cents, before.available_cost_cents + removed.post_processing_material_cost_cents);
  const backup = f.ok(await f.request('/backup')), preview = f.ok(await f.request('/backup/preview', { backup }));
  await f.save('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' });
  order = await f.get(order.id);
  assert.equal(order.operation_routes[0].operations[0].completed_quantity, 3);
  order = await f.mutate(order, `/operations/${report.id}/void`, { quantity: 1, reason: '再次纠正' });
  assert.equal(order.operation_routes[0].operations[0].completed_quantity, 2);
  f.ok(await f.request('/backup/preview', { backup: f.ok(await f.request('/backup')) }));
});

test('v52 backups and on-disk orders keep old post reports material-free', async t => {
  const f = await fixture(t), route = f.ok(await f.route(undefined));
  let order = await f.mutate(await f.create(route, 20), '/start', {});
  await f.issue(order.material_documents[0]);
  order = await f.complete(await f.get(order.id), 20);
  order = f.ok(await f.report(order, f.reportBody(order, 1)));
  const backup = f.ok(await f.request('/backup'));
  backup.version = 52;
  for (const report of backup.data.production_operation_reports) delete report.post_materials;
  // Before v53, arbitrary node properties were accepted without semantics.
  for (const row of [...backup.data.process_routes, ...backup.data.production_routes]) {
    const graph = JSON.parse(row.graph);
    graph.nodes[0].materials = [{ product_id: f.raw.id, quantity: 3 }];
    row.graph = JSON.stringify(graph);
  }
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  await f.save('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' });
  order = await f.get(order.id);
  assert.equal(order.operation_routes[0].operations[0].completed_quantity, 1);
  assert.deepEqual(order.operation_routes[0].reports[0].post_processing_materials, []);
  assert.deepEqual(order.items.map(row => row.total_planned_quantity), [20]);
  assert.equal(order.post_processing_material_cost_cents, 0);
  f.db.exec('DROP TRIGGER data_revision_production_operation_reports_UPDATE; ALTER TABLE production_operation_reports DROP COLUMN post_materials');
  f.db.prepare('UPDATE process_routes SET graph=? WHERE id=?').run(backup.data.process_routes[0].graph, route.id);
  f.db.prepare('UPDATE production_routes SET graph=? WHERE production_id=?').run(backup.data.production_routes[0].graph, order.id);
  migrateProcessRoutes(f.db);
  order = await f.get(order.id);
  assert.deepEqual(order.operation_routes[0].reports[0].post_processing_materials, []);
  assert.deepEqual(order.items.map(row => row.total_planned_quantity), [20]);
});

test('merged planned quantities enforce the cap without saving an oversized draft', async t => {
  const f = await fixture(t), route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 90000000 }]));
  const created = await f.create(route, 20);
  await assert.rejects(() => f.create(route), /后处理材料数量超出范围/);
  await assert.rejects(() => f.mutate(created, '', { planned_quantity: 21, note: '' }), /后处理材料数量超出范围/);
  assert.equal((await f.get(created.id)).planned_quantity, 20);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_orders').get().n, 1);
});

for (const labelCost of [Number.MAX_SAFE_INTEGER, Math.floor(Number.MAX_SAFE_INTEGER / 2)])
  test('post reports roll back on unsafe ' + (labelCost === Number.MAX_SAFE_INTEGER ? 'report' : 'order') + ' cost totals', async t => {
    const f = await fixture(t), route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 2 }, { product_id: f.label.id, quantity: 1 }]));
    f.db.prepare('UPDATE products SET stock=?, inventory_value_cents=? WHERE id=?').run(122, Number.MAX_SAFE_INTEGER, f.raw.id);
    f.db.prepare('UPDATE products SET stock=?, inventory_value_cents=? WHERE id=?').run(6, labelCost, f.label.id);
    let order = await f.mutate(await f.create(route), '/start', { items: [{ product_id: f.raw.id, quantity: 122 }] });
    await f.issue(order.material_documents[0]);
    order = await f.complete(await f.get(order.id), 110);
    order = await f.mutate(order, '/material-requests', { type: 'out', items: [{ product_id: f.label.id, quantity: 6 }], note: '' });
    await f.issue(order.material_documents.at(-1));
    order = await f.get(order.id);
    const request = f.reportBody(order, 6);
    const result = await f.report(order, request);
    assert.equal(result.status, 400);
    assert.match(result.data.error, /生产材料成本超出范围/);
    const after = await f.get(order.id);
    assert.equal(after.version, order.version);
    assert.equal(after.operation_routes[0].report_count, 0);
    assert.deepEqual(after.items.map(row => row.available_cost_cents), order.items.map(row => row.available_cost_cents));
  });


for (const staged of [false, true]) test('BOM inherits per-finished-unit post materials without consuming them on output (' + (staged ? 'staged' : 'ordinary') + ')', async t => {
  const f = await fixture(t, { staged });
  const route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 9 }, { product_id: f.label.id, quantity: 1 }]));
  const materials = [{ product_id: f.raw.id, quantity: 0.25 }, { product_id: f.label.id, quantity: 2 }];
  const binding = { route_id: route.id, route_version: route.version, node_id: 'pack', product_coefficient: 1, materials };
  let bom = await f.save('/boms/' + f.bom.id, { ...f.bom, post_processing_operations: [binding] });
  assert.deepEqual(bom.post_processing_operations[0].materials.map(row => row.quantity), [0.25, 2]);
  assert.equal((await f.command('/process-routes/' + route.id + '/delete', { version: route.version })).status, 409);
  // Older clients preserve the new BOM field.
  const old = { ...bom, note: 'legacy edit' }; delete old.post_processing_operations;
  bom = await f.save('/boms/' + bom.id, old);
  const prepare = () => f.save('/production-orders/prepare', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 4 });
  const plan = await prepare();
  assert.deepEqual(plan.post_processing_operations[0].materials.map(row => row.quantity), [0.25, 2]);
  let order = await f.save('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 4, note: '', structure_token: plan.structure_token,
    // An older caller cannot replace the configured BOM quantities.
    post_processing_operations: [{ ...binding, product_coefficient: 20, materials: [{ product_id: f.raw.id, quantity: 99 }] }] });
  assert.equal(order.operation_routes[0].product_coefficient, 1);
  assert.deepEqual(order.items.map(row => row.total_planned_quantity), [5, 8]);
  const backup = f.ok(await f.request('/backup'));
  assert.equal(backup.version, 57);
  const tampered = structuredClone(backup);
  const config = JSON.parse(tampered.data.boms.find(row => row.id === bom.id).post_processing_operations);
  config[0].materials[0].quantity = 0;
  tampered.data.boms.find(row => row.id === bom.id).post_processing_operations = JSON.stringify(config);
  assert.equal((await f.request('/backup/preview', { backup: tampered })).status, 400);
  const preview = f.ok(await f.request('/backup/preview', { backup }));
  await f.save('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' });
  bom = f.ok(await f.request('/boms/' + bom.id));
  assert.deepEqual(bom.post_processing_operations[0].materials.map(row => row.quantity), [0.25, 2]);
  await f.save('/boms/' + bom.id, { ...bom, post_processing_operations: [] });
  order = await f.mutate(await f.get(order.id), '/start', {});
  await f.issue(order.material_documents[0]);
  order = await f.get(order.id);
  if (staged) order = await f.complete(order, 4, '1');
  order = await f.complete(order, 4);
  assert.deepEqual(order.items.map(row => row.available_quantity), [1, 8]);
  assert.deepEqual(order.items.map(row => row.post_processing_consumed_quantity), [0, 0]);
  order = f.ok(await f.report(order, f.reportBody(order, 4)));
  assert.deepEqual(order.items.map(row => row.available_quantity), [0, 0]);
  assert.deepEqual(order.items.map(row => row.post_processing_consumed_quantity), [1, 8]);
  assert.equal(order.completed_quantity, 4);
});

test('BOM validates bound materials, per-unit quantities and stale post-processing plans atomically', async t => {
  const f = await fixture(t);
  const route = f.ok(await f.route([{ product_id: f.raw.id, quantity: 1 }, { product_id: f.label.id, quantity: 1 }]));
  const binding = { route_id: route.id, route_version: route.version, node_id: 'pack', product_coefficient: 1, materials: [{ product_id: f.raw.id, quantity: 0.25 }, { product_id: f.label.id, quantity: 1 }] };
  for (const row of [null, { ...binding, product_coefficient: 20 }, { ...binding, materials: [] },
    { ...binding, materials: [{ product_id: f.label.id, quantity: 1 }] },
    { ...binding, materials: [{ product_id: f.raw.id, quantity: 0.00001 }] }]) {
    assert.equal((await f.command('/boms/' + f.bom.id, { ...f.bom, post_processing_operations: [row] })).status >= 400, true);
    assert.equal(f.ok(await f.request('/boms/' + f.bom.id)).version, f.bom.version);
  }
  let bom = await f.save('/boms/' + f.bom.id, { ...f.bom, post_processing_operations: [binding] });
  const plan = await f.save('/production-orders/prepare', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 4 });
  const updated = f.ok(await f.route([{ product_id: f.raw.id, quantity: 8 }, { product_id: f.label.id, quantity: 1 }], { id: route.id, version: route.version }));
  const input = { bom_id: bom.id, bom_version: bom.version, planned_quantity: 4, note: '', structure_token: plan.structure_token };
  assert.equal((await f.command('/production-orders', input)).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM production_orders').get().n, 0);
  const refreshed = await f.save('/production-orders/prepare', input);
  assert.equal(refreshed.post_processing_operations[0].materials[0].quantity, 0.25);
  assert.equal(refreshed.post_processing_operations[0].route_version, updated.version);
  const changed = f.ok(await f.route([{ product_id: f.raw.id, quantity: 1 }], { id: route.id, version: updated.version }));
  assert.equal((await f.command('/production-orders/prepare', input)).status, 409);
  // A removed template material remains protected by the saved BOM reference.
  assert.equal(f.ok(await f.command('/products/batch/delete/preview', { ids: [f.label.id] })).blocked.length, 1);
  assert.equal(changed.graph.nodes[0].materials[0].product_id, f.raw.id);
});
