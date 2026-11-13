import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

export async function productionIssuesFixture(t, { staged = false, routed = false, postProcessing = false } = {}) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  const request = async (path, body, options = {}) => {
    const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(options.warehouseId ?? 1), Cookie: options.cookie ?? cookie ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const ok = response => { assert.ok([200,201].includes(response.status), JSON.stringify(response.data)); return response.data; };
  const command = (path, body, options) => request(path, { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body }, options);
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); };
  t?.after(close);
  cookie = (await request('/auth/setup', { username: 'issueadmin', password: 'Test-admin-123' })).cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));
  const product = async name => {
    const response = await request('/products', { name, barcode: randomUUID(), category: '生产', unit: 'kg', cost: 1, price: 2, threshold: 0 });
    assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.id;
  };
  const output = await product('成品'), semi = await product('半成品'), raw = await product('原料'), other = await product('辅料');
  for (const id of [raw, other]) db.prepare('UPDATE products SET stock=1000,inventory_value_cents=100001 WHERE id=?').run(id);
  const route = routed ? ok(await command('/process-routes', { name: '生产工序', enabled: 1, note: '', graph: {
    nodes: [{ id: 'cut', name: '下料', x: 0, y: 0, note: '' }, { id: 'output', name: '组装', x: 220, y: 0, note: '' }], edges: [{ from: 'cut', to: 'output' }] } })) : null;
  const post = postProcessing ? ok(await command('/process-routes', { name: '包装工艺', route_kind: 'post_processing', enabled: 1, note: '', graph: {
    nodes: [{ id: 'pack', name: '打包', x: 0, y: 0, note: '', materials: [{ product_id: other, quantity: 1 }] }], edges: [] } })) : null;
  const bomBody = (product_id, items) => ({ name: `配方-${product_id}`, product_id, base_quantity: 1, base_unit: 'kg', enabled: 1, note: '', items });
  const item = (product_id, quantity) => ({ product_id, quantity, unit: 'kg', note: '' });
  const child = staged ? ok(await command('/boms', bomBody(semi, [item(raw, 3)]))) : null;
  const bom = ok(await command('/boms', { ...bomBody(output, staged
    ? [{ ...item(semi, 2), usage_mode: 'explode', child_bom_id: child.id }]
    : [item(raw, 2), item(other, 1)]), ...(route ? { route_override_id: route.id } : {}) }));
  const body = { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '',
    ...(post ? { post_processing_operations: [{ route_id: post.id, route_version: post.version, node_id: 'pack', product_coefficient: 2 }] } : {}) };
  const plan = ok(await request('/production-orders/prepare', { ...body, schema_version: 2 }));
  let order = ok(await command('/production-orders', { ...body, structure_token: plan.structure_token }));
  const get = () => request(`/production-orders/${order.id}`).then(ok);
  order = ok(await command(`/production-orders/${order.id}/start`, { version: order.version }));
  ok(await command(`/production-material-documents/${order.material_documents[0].id}/confirm`, { version: order.material_documents[0].version }));
  order = await get();
  const complete = (o, quantity, items, extra = {}) => command(`/production-orders/${o.id}/${staged ? 'stages/' : ''}complete`, {
    version: o.version, path: '', completed_quantity: quantity,
    items: items.map(([key, quantity]) => ({ [staged ? 'path' : 'product_id']: key, quantity, variance_reason: '' })),
    scraps: [], note: '', finish_order: false, ...(routed ? { operation_node_id: 'output' } : {}), ...extra });
  const supplement = async (o, items) => {
    const updated = ok(await command(`/production-orders/${o.id}/material-requests`, { version: o.version, type: 'out', items: items.map(([product_id, quantity]) => ({ product_id, quantity })), note: '' }));
    const doc = updated.material_documents.find(row => row.status === 'pending');
    return { order: updated, doc };
  };
  const confirm = async doc => { ok(await command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version })); return get(); };
  const reconcile = o => command(`/production-orders/${o.id}/operations/registrations/reconcile`, { version: o.version });
  const cancel = (o, row) => command(`/production-orders/${o.id}/operations/registrations/${row.id}/cancel`, { version: o.version });
  const report = (o, node, quantity, path = '') => command(`/production-orders/${o.id}/operations/report`, { version: o.version, path, operation_node_id: node, quantity, note: '' });
  return { db, base, cookie, close, request, command, ok, get, order, output, semi, raw, other, bom, child, route, post, complete, supplement, confirm, reconcile, cancel, report };
}
