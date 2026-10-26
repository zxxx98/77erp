import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

const graph = { nodes: [{ id: 'out', name: '产出', note: '', x: 0, y: 0 }], edges: [] };
async function fixture(t) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: options.cookie || cookie || '', 'X-Warehouse-ID': String(options.warehouseId || 1) },
      body: body === undefined ? undefined : JSON.stringify({ request_id: randomUUID(), ...body }),
    });
    const text = await response.text();
    return { status: response.status, data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = response => { assert.ok([200, 201].includes(response.status), JSON.stringify(response.data)); return response.data; };
  cookie = (await request('/auth/setup', { username: 'overviewadmin', password: 'Overview-test-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const route = ok(await request('/process-routes', { name: '默认路线', note: '', enabled: 1, graph }));
  const product = async (name, default_route_id = null) => ok(await request('/products', { name, barcode: randomUUID(), category: '生产', unit: '件', cost: 1, price: 2, threshold: 0, default_route_id })).id;
  const raw = await product('原料'), half = await product('半成品', route.id), output = await product('成品');
  const bom = async (product_id, name, items) => ok(await request('/boms', { product_id, name, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items }));
  const stock = product_id => ({ product_id, quantity: 2, unit: '件', note: '', usage_mode: 'stock' });
  const child = await bom(half, '子配方', [stock(raw)]);
  const root = await bom(output, '根配方', [{ ...stock(half), usage_mode: 'explode', child_bom_id: child.id }, stock(raw)]);
  const overview = () => request(`/boms/${root.id}/process-overview`);
  return { db, request, ok, route, product, bom, stock, raw, half, output, child, root, overview };
}

test('BOM overview keeps saved layers, direct stock inputs, default and override routes', async t => {
  const f = await fixture(t);
  let result = f.ok(await f.overview());
  assert.equal(result.bom_id, f.root.id);
  assert.deepEqual(result.layers.map(layer => [layer.path, layer.parent_path, layer.route_source]), [['', null, null], ['1', '', 'product']]);
  assert.equal(result.layers[0].route, null);
  assert.deepEqual(result.layers[0].materials.map(material => material.name), ['原料']);
  assert.deepEqual(result.layers[1].route.graph, graph);
  assert.equal(result.layers[1].unit, '件');
  const other = f.ok(await f.request('/process-routes', { name: '覆盖路线', note: '', enabled: 1, graph }));
  f.db.prepare('UPDATE boms SET route_override_id=?,enabled=0 WHERE id=?').run(other.id, f.child.id);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.half);
  f.db.prepare('UPDATE process_routes SET enabled=0 WHERE id=?').run(other.id);
  result = f.ok(await f.overview());
  assert.equal(result.layers[1].route_source, 'bom');
  assert.equal(result.layers[1].route.id, other.id);
  assert.equal(result.layers[1].route.enabled, 0);
  assert.equal(result.layers[1].enabled, 0);
  assert.equal(result.layers[1].product_active, 0);
});

test('BOM overview preserves repeated occurrences and never expands stock material recipes', async t => {
  const f = await fixture(t);
  const branchProduct = await f.product('分支');
  const branch = await f.bom(branchProduct, '分支配方', [{ ...f.stock(f.half), usage_mode: 'explode', child_bom_id: f.child.id }]);
  f.db.prepare('INSERT INTO bom_items(bom_id,product_id,quantity,unit,note,position,usage_mode,child_bom_id) VALUES(?,?,?,?,?,?,?,?)').run(f.root.id, branchProduct, 1, '件', '', 2, 'explode', branch.id);
  const layers = f.ok(await f.overview()).layers;
  assert.deepEqual(layers.map(layer => layer.path), ['', '1', '3', '3.1']);
  assert.equal(layers[1].bom_id, layers[3].bom_id);
  f.db.prepare("UPDATE bom_items SET usage_mode='stock',child_bom_id=NULL WHERE bom_id=? AND product_id=?").run(f.root.id, f.half);
  assert.deepEqual(f.ok(await f.overview()).layers.map(layer => layer.path), ['', '3', '3.1']);
});

test('BOM overview fails configured missing, malformed and foreign warehouse routes without partial layers', async t => {
  const f = await fixture(t);
  f.db.prepare("UPDATE process_routes SET graph='{}' WHERE id=?").run(f.route.id);
  assert.equal((await f.overview()).status, 400);
  f.db.prepare('UPDATE process_routes SET graph=? WHERE id=?').run(JSON.stringify(graph), f.route.id);
  const warehouse = f.ok(await f.request('/warehouses', { name: '其他仓库' }));
  f.db.prepare('UPDATE process_routes SET warehouse_id=? WHERE id=?').run(warehouse.id, f.route.id);
  assert.equal((await f.overview()).status, 400);
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE products SET default_route_id=999999 WHERE id=?').run(f.half);
  f.db.exec('PRAGMA foreign_keys=ON');
  assert.equal((await f.overview()).status, 400);
  // A configured override must fail even when the product has a valid default.
  f.db.prepare('UPDATE products SET default_route_id=? WHERE id=?').run(f.route.id, f.half);
  f.db.prepare('UPDATE process_routes SET warehouse_id=1 WHERE id=?').run(f.route.id);
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE boms SET route_override_id=999999 WHERE id=?').run(f.child.id);
  f.db.exec('PRAGMA foreign_keys=ON');
  assert.equal((await f.overview()).status, 400);
  assert.equal((await f.request(`/boms/${f.root.id}/process-overview`, undefined, { warehouseId: warehouse.id })).status, 404);
});

test('BOM overview fails selected missing or foreign child recipes', async t => {
  const f = await fixture(t);
  const warehouse = f.ok(await f.request('/warehouses', { name: '子配方隔离仓' }));
  f.db.prepare('UPDATE boms SET warehouse_id=? WHERE id=?').run(warehouse.id, f.child.id);
  assert.equal((await f.overview()).status, 404);
  f.db.prepare('UPDATE boms SET warehouse_id=1 WHERE id=?').run(f.child.id);
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE bom_items SET child_bom_id=999999 WHERE bom_id=? AND usage_mode=?').run(f.root.id, 'explode');
  f.db.exec('PRAGMA foreign_keys=ON');
  assert.equal((await f.overview()).status, 404);
});

test('BOM overview enforces BOM permissions and rejects cycles and excessive depth', async t => {
  const f = await fixture(t);
  const position = f.ok(await f.request('/positions', { name: '仅物料', permissions: ['products'] }));
  f.ok(await f.request('/users', { username: 'overviewreader', password: 'Overview-test-123', role: 'employee', position_id: position.id }));
  const login = await f.request('/auth/login', { username: 'overviewreader', password: 'Overview-test-123' }, { cookie: 'no-session' });
  assert.equal((await f.request(`/boms/${f.root.id}/process-overview`, undefined, { cookie: login.cookie })).status, 403);
  f.db.prepare("UPDATE bom_items SET product_id=?,usage_mode='explode',child_bom_id=? WHERE bom_id=?").run(f.output, f.root.id, f.child.id);
  let response = await f.overview();
  assert.equal(response.status, 400); assert.match(response.data.error, /循环/);
  f.db.prepare("UPDATE bom_items SET product_id=?,usage_mode='stock',child_bom_id=NULL WHERE bom_id=?").run(f.raw, f.child.id);
  const chain = [f.child];
  for (let index = 0; index < 10; index++) {
    const product = await f.product(`深层${index}`);
    const next = await f.bom(product, `深层配方${index}`, [f.stock(f.raw)]);
    chain.push(next);
  }
  for (let index = 1; index < chain.length; index++) {
    f.db.prepare("UPDATE bom_items SET product_id=?,usage_mode='explode',child_bom_id=? WHERE bom_id=?").run(chain[index].product_id, chain[index].id, chain[index - 1].id);
  }
  response = await f.overview();
  assert.equal(response.status, 400); assert.match(response.data.error, /最多支持/);
});
