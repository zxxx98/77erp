import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { productionFinishPreview } from '../shared/production.js';
import { exactQuantity, exactCompare } from '../shared/exact-quantity.js';

async function setupFixture(t, { staged = false, routed = false, postProcessing = false, roundUp = false } = {}) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let adminCookie = '';
  const request = async (path, body, { cookie = adminCookie, expected } = {}) => {
    const response = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Warehouse-ID': '1',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    const nextCookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(data));
    return { status: response.status, data, cookie: nextCookie };
  };
  const command = (path, body, opts) => request(path, {
    request_id: randomUUID(),
    schema_version: 2,
    stage_schema_version: 1,
    operation_schema_version: 1,
    ...body,
  }, opts);
  const ok = res => { assert.ok([200, 201].includes(res.status), JSON.stringify(res.data)); return res.data; };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });

  const setupRes = await request('/auth/setup', { username: 'pipelineadmin', password: 'Test-password-123' });
  ok(setupRes);
  adminCookie = setupRes.cookie;
  ok(await request('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' }));

  const createProduct = async name => ok(await request('/products', {
    name,
    barcode: randomUUID(),
    category: '生产',
    unit: 'kg',
    cost: 10,
    price: 20,
    threshold: 0,
    unit_round_up: roundUp ? 1 : 0,
  })).id;

  const output = await createProduct('成品');
  const semi = staged ? await createProduct('半成品') : null;
  const raw = await createProduct('原料');
  const other = await createProduct('辅料');
  db.prepare('UPDATE products SET stock=100, inventory_value_cents=100000 WHERE id IN (?,?)').run(raw, other);

  const route = routed ? ok(await command('/process-routes', {
    name: '工序路线',
    enabled: 1,
    note: '',
    graph: {
      nodes: [
        { id: 'prep', name: '裁剪', x: 0, y: 0, note: '' },
        { id: 'out', name: '组装', x: 200, y: 0, note: '' },
      ],
      edges: [{ from: 'prep', to: 'out' }],
    },
  })) : null;

  const post = postProcessing ? ok(await command('/process-routes', {
    name: '后处理路线',
    route_kind: 'post_processing',
    enabled: 1,
    note: '',
    graph: {
      nodes: [{ id: 'pack', name: '打包', x: 0, y: 0, note: '' }],
      edges: [],
    },
  })) : null;

  const childBom = staged ? ok(await command('/boms', {
    name: '半成品配方',
    product_id: semi,
    base_quantity: 1,
    base_unit: 'kg',
    enabled: 1,
    note: '',
    items: [{ product_id: raw, quantity: 2, unit: 'kg', note: '' }],
  })) : null;

  const bom = ok(await command('/boms', {
    name: '主配方',
    product_id: output,
    base_quantity: 1,
    base_unit: 'kg',
    enabled: 1,
    note: '',
    ...(route ? { route_override_id: route.id } : {}),
    items: staged
      ? [{ product_id: semi, quantity: 1, unit: 'kg', note: '', usage_mode: 'explode', child_bom_id: childBom.id }]
      : [
          { product_id: raw, quantity: 1, unit: 'kg', note: '' },
          { product_id: other, quantity: 1, unit: 'kg', note: '' },
        ],
  }));

  const createOrder = async (planned = 5) => {
    const body = {
      bom_id: bom.id,
      bom_version: bom.version,
      planned_quantity: planned,
      note: '',
      ...(post ? { post_processing_operations: [{ route_id: post.id, route_version: post.version, node_id: 'pack', product_coefficient: 2 }] } : {}),
    };
    const plan = ok(await command('/production-orders/prepare', body));
    return ok(await command('/production-orders', { ...body, structure_token: plan.structure_token }));
  };

  const get = id => request(`/production-orders/${id}`).then(ok);
  const stock = id => db.prepare('SELECT stock, inventory_value_cents FROM products WHERE id=?').get(id);

  const createWorker = async (username, permissions) => {
    const position = ok(await command('/positions', { name: `岗位-${username}`, permissions })).id;
    ok(await command('/users', { username, employee_no: username, password: 'Worker-password-123', position_id: position }));
    const loginRes = await request('/auth/login', { username, password: 'Worker-password-123' }, { cookie: '' });
    ok(loginRes);
    return loginRes.cookie;
  };

  return { db, request, command, ok, output, semi, raw, other, createOrder, get, stock, createWorker };
}

test('productionFinishPreview accurately flags Step 1 blockers, Step 2 balances, and rounding deductions', async t => {
  const f = await setupFixture(t, { staged: true, routed: true, postProcessing: true });
  let order = await f.createOrder(4);
  order = f.ok(await f.command(`/production-orders/${order.id}/start`, { version: order.version }));
  let preview = productionFinishPreview(order);
  assert.equal(preview.has_output, false);
  assert.equal(preview.pending_material_documents.length, 1);
  assert.equal(preview.step1_blocked, true);

  // Partially issue raw materials so a pending material doc remains while production begins.
  const initialDoc = order.material_documents[0];
  f.ok(await f.command(`/production-material-documents/${initialDoc.id}/confirm`, {
    version: initialDoc.version,
    items: [{ product_id: f.raw, quantity: 6 }],
  }));
  order = await f.get(order.id);
  preview = productionFinishPreview(order);
  assert.equal(preview.pending_material_documents.length, 1);
  assert.equal(preview.step1_blocked, true);

  // Close remaining request.
  f.ok(await f.command(`/production-material-documents/${initialDoc.id}/cancel`, {
    version: order.material_documents[0].version,
    reason: '少领部分材料',
  }));
  order = await f.get(order.id);
  preview = productionFinishPreview(order);
  assert.equal(preview.pending_material_documents.length, 0);

  // Produce semi-finished and report prep operation on root without final output -> operation WIP + no output.
  order = f.ok(await f.command(`/production-orders/${order.id}/stages/complete`, {
    version: order.version,
    path: '1',
    completed_quantity: 2,
    items: [{ path: '1.1', quantity: 4 }],
    finish_order: false,
  }));
  order = f.ok(await f.command(`/production-orders/${order.id}/operations/report`, {
    version: order.version,
    path: '',
    operation_node_id: 'prep',
    quantity: 2,
    note: '',
  }));
  preview = productionFinishPreview(order);
  assert.equal(preview.has_output, false);
  assert.equal(preview.operation_wip.length, 1);
  assert.equal(preview.operation_wip[0].wip_quantity, 2);
  assert.equal(preview.step1_blocked, true);

  // Register partial root output (1 < 2 -> still WIP 1, waiting_for_output = true, can_confirm_output_completion = true).
  order = f.ok(await f.command(`/production-orders/${order.id}/stages/complete`, {
    version: order.version,
    path: '',
    operation_node_id: 'out',
    completed_quantity: 1,
    items: [{ path: '1', quantity: 1 }],
    scraps: [],
    finish_order: false,
  }));
  preview = productionFinishPreview(order);
  assert.equal(preview.has_output, true);
  assert.equal(preview.operation_wip.length, 1);
  assert.equal(preview.operation_wip[0].wip_quantity, 1);
  assert.equal(preview.waiting_for_output, true);
  assert.equal(preview.can_confirm_output_completion, true);
  assert.equal(preview.step1_blocked, true);

  // Complete remaining root output -> WIP clears, post-processing gap appears (1 run needed).
  order = f.ok(await f.command(`/production-orders/${order.id}/stages/complete`, {
    version: order.version,
    path: '',
    operation_node_id: 'out',
    completed_quantity: 1,
    items: [{ path: '1', quantity: 1 }],
    scraps: [],
    finish_order: false,
  }));
  order = f.ok(await f.command(`/production-orders/${order.id}/output-completion`, { version: order.version, completed: true }));
  preview = productionFinishPreview(order);
  assert.equal(preview.operation_wip.length, 0);
  assert.equal(preview.waiting_for_output, false);
  assert.equal(preview.post_processing_gaps.length, 1);
  assert.equal(preview.post_processing_gaps[0].remaining, 1);
  assert.equal(preview.step1_blocked, true);

  // Report post-processing -> Step 1 clears; Step 2 shows returnable raw material (6 - 4 = 2).
  order = f.ok(await f.command(`/production-orders/${order.id}/operations/report`, {
    version: order.version,
    path: '@post:1',
    operation_node_id: 'pack',
    quantity: 1,
    note: '',
  }));
  preview = productionFinishPreview(order);
  assert.equal(preview.step1_blocked, false);
  assert.equal(preview.step1_has_items, false);
  assert.equal(preview.step2_blocked, false);
  assert.equal(preview.step2_has_items, true);
  assert.equal(preview.returnable_materials.length, 1);
  assert.equal(preview.returnable_materials[0].returnable_quantity, 2);
});

test('finish atomically creates pending return after rounding deduction and survives warehouse confirmation and restore', async t => {
  const f = await setupFixture(t, { roundUp: false });
  let order = await f.createOrder(2);
  order = f.ok(await f.command(`/production-orders/${order.id}/start`, { version: order.version }));
  f.ok(await f.command(`/production-material-documents/${order.material_documents[0].id}/confirm`, {
    version: order.material_documents[0].version,
  }));
  order = await f.get(order.id);
  // Consume '1/3' of raw (rounding delta 1/15000, returnable = 2 - 0.3334 = 1.6666) and 1 of other (returnable = 1).
  order = f.ok(await f.command(`/production-orders/${order.id}/complete`, {
    version: order.version,
    completed_quantity: '1/3',
    items: [
      { product_id: f.raw, quantity: '1/3', variance_reason: '' },
      { product_id: f.other, quantity: 1, variance_reason: '' },
    ],
    scraps: [],
    finish_order: false,
  }));

  const preview = productionFinishPreview(order);
  assert.equal(preview.product.settled_quantity, 0.3334);
  const rawPreview = preview.returnable_materials.find(item => item.product_id === f.raw);
  assert.equal(exactCompare(exactQuantity(rawPreview, 'returnable_quantity'), 1.6666), 0);

  // Attempting to return more than post-rounding balance rolls back finish completely.
  const overReturn = await f.command(`/production-orders/${order.id}/finish`, {
    version: order.version,
    return_items: [{ product_id: f.raw, quantity: 1.6667 }],
  });
  assert.equal(overReturn.status, 400);
  order = await f.get(order.id);
  assert.equal(order.status, 'in_progress');
  assert.equal(order.quantity_rounding.length, 0);

  // Returning exact post-rounding balance completes order and creates a pending return document.
  const finishBody = {
    request_id: randomUUID(),
    schema_version: 2,
    stage_schema_version: 1,
    operation_schema_version: 1,
    version: order.version,
    return_items: [
      { product_id: f.raw, quantity: 1.6666 },
      { product_id: f.other, quantity: 1 },
    ],
    return_note: '完结自动退余料',
    confirm_return: false,
  };
  const finished = f.ok(await f.request(`/production-orders/${order.id}/finish`, finishBody));
  assert.equal(finished.status, 'completed');
  assert.equal(finished.settled_completed_quantity, 0.3334);
  const returnDoc = finished.material_documents.at(-1);
  assert.equal(returnDoc.type, 'in');
  assert.equal(returnDoc.kind, 'return');
  assert.equal(returnDoc.status, 'pending');
  assert.equal(returnDoc.note, '完结自动退余料');
  assert.equal(f.stock(f.raw).stock, 98);
  assert.equal(f.stock(f.other).stock, 98);

  // Idempotent replay returns identical finished order without creating another return doc.
  const replay = f.ok(await f.request(`/production-orders/${order.id}/finish`, finishBody));
  assert.equal(replay.material_documents.length, finished.material_documents.length);

  // Warehouse confirms the pending return document afterwards.
  f.ok(await f.command(`/production-material-documents/${returnDoc.id}/confirm`, { version: returnDoc.version }));
  const after = await f.get(order.id);
  assert.equal(after.items.find(i => i.product_id === f.raw).available_quantity, 0);
  assert.equal(after.items.find(i => i.product_id === f.raw).available_cost_cents, 0);
  assert.equal(f.stock(f.raw).stock, 99.6666);
  assert.equal(f.stock(f.other).stock, 99);

  // Backup and restore preserve everything cleanly.
  const backup = f.ok(await f.request('/backup'));
  const backupPreview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...backupPreview, confirmation: 'RESTORE_BUSINESS_DATA' }));
  assert.equal((await f.get(order.id)).status, 'completed');
});

test('finish with confirm_return=true confirms return into stock when permitted and enforces permissions/active state', async t => {
  const f = await setupFixture(t);
  let order = await f.createOrder(3);
  order = f.ok(await f.command(`/production-orders/${order.id}/start`, { version: order.version }));
  f.ok(await f.command(`/production-material-documents/${order.material_documents[0].id}/confirm`, {
    version: order.material_documents[0].version,
  }));
  order = f.ok(await f.command(`/production-orders/${await f.get(order.id).then(o => o.id)}/complete`, {
    version: (await f.get(order.id)).version,
    completed_quantity: 1,
    items: [
      { product_id: f.raw, quantity: 1 },
      { product_id: f.other, quantity: 1 },
    ],
    scraps: [],
    finish_order: false,
  }));

  // Production-only user cannot pass confirm_return=true; transaction rolls back completely.
  const producerCookie = await f.createWorker('onlyprod', ['basic_view', 'production']);
  const denied = await f.command(`/production-orders/${order.id}/finish`, {
    version: order.version,
    return_items: [{ product_id: f.raw, quantity: 2 }],
    confirm_return: true,
  }, { cookie: producerCookie });
  assert.equal(denied.status, 403);
  assert.equal((await f.get(order.id)).status, 'in_progress');

  // Deactivated return material is rejected and rolled back.
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.raw);
  const inactiveRes = await f.command(`/production-orders/${order.id}/finish`, {
    version: order.version,
    return_items: [{ product_id: f.raw, quantity: 2 }],
  });
  assert.equal(inactiveRes.status, 400);
  assert.equal((await f.get(order.id)).status, 'in_progress');
  f.db.prepare('UPDATE products SET active=1 WHERE id=?').run(f.raw);

  // Admin with stock_approve can finish and immediately confirm return into inventory.
  const finished = f.ok(await f.command(`/production-orders/${order.id}/finish`, {
    version: order.version,
    return_items: [
      { product_id: f.raw, quantity: 2 },
      { product_id: f.other, quantity: 2 },
    ],
    return_note: '立即入库',
    confirm_return: true,
  }));
  assert.equal(finished.status, 'completed');
  const returnDoc = finished.material_documents.at(-1);
  assert.equal(returnDoc.status, 'confirmed');
  assert.equal(f.stock(f.raw).stock, 99);
  assert.equal(f.stock(f.other).stock, 99);
  assert.equal(finished.items.find(i => i.product_id === f.raw).available_quantity, 0);
  assert.equal(finished.items.find(i => i.product_id === f.raw).available_cost_cents, 0);
});

test('stage-receipts confirm=true immediately stocks remaining semi-finished output and checks permissions/registrations', async t => {
  const f = await setupFixture(t, { staged: true });
  let order = await f.createOrder(3);
  order = f.ok(await f.command(`/production-orders/${order.id}/start`, { version: order.version }));
  f.ok(await f.command(`/production-material-documents/${order.material_documents[0].id}/confirm`, {
    version: order.material_documents[0].version,
  }));
  order = await f.get(order.id);
  order = f.ok(await f.command(`/production-orders/${order.id}/stages/complete`, {
    version: order.version,
    path: '1',
    completed_quantity: 3,
    items: [{ path: '1.1', quantity: 6 }],
    finish_order: false,
  }));
  order = f.ok(await f.command(`/production-orders/${order.id}/stages/complete`, {
    version: order.version,
    path: '',
    completed_quantity: 1,
    items: [{ path: '1', quantity: 1 }],
    scraps: [],
    finish_order: false,
  }));

  const producerCookie = await f.createWorker('stageprod', ['basic_view', 'production']);
  const denied = await f.command(`/production-orders/${order.id}/stage-receipts`, {
    version: order.version,
    path: '1',
    quantity: 2,
    confirm: true,
  }, { cookie: producerCookie });
  assert.equal(denied.status, 403);

  order = f.ok(await f.command(`/production-orders/${order.id}/stage-receipts`, {
    version: order.version,
    path: '1',
    quantity: 2,
    confirm: true,
  }));
  assert.equal(order.stages.find(s => s.path === '1').available_quantity, 0);
  assert.equal(order.receipt_documents.find(d => d.kind === 'stage').status, 'confirmed');
  assert.equal(f.stock(f.semi).stock, 2);
  assert.equal(f.stock(f.semi).inventory_value_cents, 4000);

  const finished = f.ok(await f.command(`/production-orders/${order.id}/finish`, { version: order.version }));
  assert.equal(finished.status, 'completed');
  const backup = f.ok(await f.request('/backup'));
  const backupPreview = f.ok(await f.request('/backup/preview', { backup }));
  f.ok(await f.command('/backup/restore', { backup, ...backupPreview, confirmation: 'RESTORE_BUSINESS_DATA' }));
});
