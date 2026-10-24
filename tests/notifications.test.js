import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApp } from '../server/app.js';
import { notificationEvents } from '../shared/notifications.js';
import { queueDailySummary } from '../server/notifications.js';
import { isPublicAddress, validateWebhookUrl, webhookRequest, sendWebhook } from '../server/webhook-transport.js';

async function fixture(t, options = {}, path = ':memory:') {
  const sent = [];
  const instance = createApp(path, { webhookSend: async (config, event) => { sent.push({ config, event }); }, ...options });
  const { app, db, notifications } = instance;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await notifications.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); };
  t.after(close);
  let cookie;
  const request = async (path, method = 'GET', body, warehouse = 1, session = cookie) => {
    // API clients send arrays; raw SQLite fixtures store this field as JSON.
    if (method === 'PUT' && /^\/products\/\d+$/.test(path) && typeof body?.customer_part_numbers === 'string') body = { ...body, customer_part_numbers: JSON.parse(body.customer_part_numbers) };
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(session ? { Cookie: session } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  let auth = await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' });
  if (auth.status === 409) auth = await request('/auth/login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  cookie = auth.cookie;
  const configure = async (changes = {}) => {
    const current = (await request('/settings/notifications')).data;
    const r = await request('/settings/notifications', 'PUT', { ...current, enabled: true, url: 'https://hooks.example.com/test?key=private-url-token', events: notificationEvents.map(e => e.key).filter(k => k !== 'daily_summary'), ...changes });
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
  };
  const product = async (warehouse = 1) => {
    const r = await request('/products', 'POST', { name: '通知测试物料', barcode: `N-${randomUUID()}`, category: '测试', unit: '个', cost: 10, price: 20, threshold: 2 }, warehouse);
    assert.equal(r.status, 201); return r.data.id;
  };
  const order = (id, type, quantity, extra = {}, warehouse = 1) => request('/orders', 'POST', { request_id: randomUUID(), type, partner: '通知测试单位', items: [{ product_id: id, quantity, price: 10 }], ...extra }, warehouse);
  const command = (path, body, warehouse = 1) => request(path, 'POST', { request_id: randomUUID(), ...body }, warehouse);
  const events = () => db.prepare('SELECT * FROM notification_deliveries ORDER BY rowid').all().map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  return { ...instance, sent, request, configure, product, order, command, events, close };
}

test('internal stock movements retain stock alerts and stay out of purchase/sale notifications and daily totals', async t => {
  const f = await fixture(t);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const id = await f.product();
  const contact = await f.command('/contacts', { role: 'internal', name: '通知内部产线', person: '', phone: '', address: '', note: '', active: 1 });
  assert.equal(contact.status, 200);
  await f.configure({ events: ['purchase_in', 'sale_out', 'out_of_stock', 'daily_summary'], daily_time: '00:00', timezone: 'UTC', include_amounts: true });
  assert.equal((await f.order(id, 'in', 2, { partner: '通知内部产线', partner_id: contact.data.id })).status, 201);
  assert.equal((await f.order(id, 'out', 2, { partner: '通知内部产线', partner_id: contact.data.id })).status, 201);
  assert.ok(!f.events().some(row => ['purchase_in', 'sale_out'].includes(row.event)));
  assert.ok(f.events().some(row => row.event === 'out_of_stock'));
  queueDailySummary(f.db, new Date());
  const summary = f.events().find(row => row.event === 'daily_summary').payload.data.warehouses[0];
  assert.equal(summary.purchase_cents, 0);
  assert.equal(summary.sales_cents, 0);
  assert.equal(summary.purchase_count, 0);
  assert.equal(summary.sales_count, 0);
});

test('notification settings are admin-only, versioned, validated, redact credentials and survive reset/backup restore', async t => {
  const f = await fixture(t);
  const initial = (await f.request('/settings/notifications')).data;
  assert.equal(initial.enabled, false); assert.deepEqual(initial.events, []);
  await f.request('/users', 'POST', { username: 'employee', password: 'Test-employee-123', role: 'employee' });
  const employee = (await f.request('/auth/login', 'POST', { username: 'employee', password: 'Test-employee-123' }, 1, '')).cookie;
  for (const [path, method] of [['', 'GET'], ['', 'PUT'], ['/test', 'POST'], ['/deliveries', 'GET'], ['/deliveries/a/retry', 'POST']]) {
    assert.equal((await f.request(`/settings/notifications${path}`, method, method === 'GET' ? undefined : {}, 1, employee)).status, 403);
  }
  const config = await f.configure({ secret: 'private-signing-secret' });
  assert.equal(config.has_url, true); assert.equal(config.has_secret, true);
  assert.equal(config.destination, 'https://hooks.example.com');
  assert.ok(!JSON.stringify(config).includes('private-')); assert.equal(config.url, undefined); assert.equal(config.secret, undefined);
  assert.equal((await f.request('/settings/notifications', 'PUT', { ...initial, enabled: true })).status, 409);
  for (const changes of [{ url: 'http://example.com' }, { url: 'https://127.0.0.1/x' }, { events: ['invalid'] }, { warehouse_ids: [999] }, { timezone: 'invalid' }, { daily_time: '25:00' }, { secret: 'bad\nsecret' }]) {
    assert.equal((await f.request('/settings/notifications', 'PUT', { ...config, ...changes })).status, 400);
  }
  const preserved = await f.configure({ url: '', secret: '' });
  assert.equal(preserved.has_secret, true);
  const backup = (await f.request('/backup')).data;
  assert.ok(!JSON.stringify(backup).includes('private-url-token')); assert.ok(!JSON.stringify(backup).includes('private-signing-secret'));
  assert.equal((await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' })).status, 200);
  assert.equal(f.events().at(-1).payload.data.action, '重置业务数据');
  const preview = (await f.request('/backup/preview', 'POST', { backup })).data;
  assert.equal((await f.command('/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.deepEqual((await f.request('/settings/notifications')).data, preserved);
  assert.deepEqual(f.events().map(e => e.event), ['admin_action', 'admin_action']);
});

test('stock transitions and orders are transactional, aggregate items, hide amounts, and deduplicate request retries', async t => {
  const f = await fixture(t); await f.configure();
  const id = await f.product();
  const purchase = await f.order(id, 'in', 5); assert.equal(purchase.status, 201);
  assert.deepEqual(f.events().map(e => e.event), ['purchase_in', 'stock_recovered']);
  const body = { request_id: randomUUID(), type: 'out', partner: '通知测试单位', items: [{ product_id: id, quantity: 3, price: 10 }] };
  const sale = await f.request('/orders', 'POST', body); assert.equal(sale.status, 201);
  assert.equal((await f.request('/orders', 'POST', body)).data.id, sale.data.id);
  assert.deepEqual(f.events().slice(2).map(e => e.event), ['sale_out', 'low_stock']);
  await f.order(id, 'out', 1);
  assert.equal(f.events().filter(e => e.event === 'low_stock').length, 1);
  await f.order(id, 'out', 1);
  assert.equal(f.events().filter(e => e.event === 'out_of_stock').length, 1);
  const length = f.events().length;
  assert.equal((await f.order(id, 'out', 1)).status, 400); assert.equal(f.events().length, length);
  for (const event of f.events()) {
    assert.ok(!JSON.stringify(event.payload).includes('total_cents')); assert.ok(!JSON.stringify(event.payload).includes('price'));
    assert.ok(!event.payload.message.includes('¥')); assert.equal(event.payload.actor.username, 'admin');
  }
  // A late failure after stock and outbox writes rolls the entire operation back.
  f.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_requests BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
  assert.equal((await f.order(id, 'in', 5)).status, 400);
  assert.equal(f.events().length, length); assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock, 0);
});

test('inactive products do not trigger stock alerts during clearance and resume alerts when reactivated', async t => {
  const f = await fixture(t);
  const active = await f.product(), inactive = await f.product();
  for (const id of [active, inactive]) assert.equal((await f.order(id, 'in', 5)).status, 201);
  assert.equal((await f.request(`/products/${inactive}/status`, 'POST', { active: 0 })).status, 200);
  await f.configure({ events: ['low_stock', 'out_of_stock', 'stock_recovered'] });
  for (const [type, quantity, event] of [['out', 3, 'low_stock'], ['out', 2, 'out_of_stock'], ['in', 5, 'stock_recovered']]) {
    const result = await f.request('/orders', 'POST', { type, partner: '清库存测试', items: [active, inactive].map(product_id => ({ product_id, quantity, price: 10 })) });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(f.events().at(-1).event, event);
    assert.deepEqual(f.events().at(-1).payload.data.items.map(p => p.id), [active]);
  }
  assert.equal(f.events().length, 3);
  assert.equal((await f.request(`/products/${inactive}/status`, 'POST', { active: 1 })).status, 200);
  assert.equal((await f.order(inactive, 'out', 3)).status, 201);
  assert.equal(f.events().length, 4);
  assert.equal(f.events().at(-1).event, 'low_stock');
  assert.deepEqual(f.events().at(-1).payload.data.items.map(p => p.id), [inactive]);
});

test('daily summary stock counts exclude inactive products and include them after reactivation', async t => {
  const f = await fixture(t);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const low = await f.product(), empty = await f.product();
  assert.equal((await f.order(low, 'in', 1)).status, 201);
  await f.configure({ events: ['daily_summary'], daily_time: '00:00', timezone: 'UTC' });
  const summary = (day, lowCount, emptyCount) => {
    queueDailySummary(f.db, new Date(`2026-10-${day}T12:00:00Z`));
    const row = f.events().at(-1).payload.data.warehouses[0];
    assert.equal(row.low_stock, lowCount);
    assert.equal(row.out_of_stock, emptyCount);
  };
  summary('15', 1, 1);
  for (const id of [low, empty]) assert.equal((await f.request(`/products/${id}/status`, 'POST', { active: 0 })).status, 200);
  summary('16', 0, 0);
  for (const id of [low, empty]) assert.equal((await f.request(`/products/${id}/status`, 'POST', { active: 1 })).status, 200);
  summary('17', 1, 1);
});

test('subscriptions, warehouse filters, and disabling cancel pending deliveries', async t => {
  const f = await fixture(t);
  const other = (await f.request('/warehouses', 'POST', { name: '其他仓库' })).data.id;
  const id = await f.product(), otherId = await f.product(other);
  await f.configure({ events: ['purchase_in'], warehouse_ids: [1], include_amounts: true });
  await f.order(otherId, 'in', 5, {}, other); assert.equal(f.events().length, 0);
  await f.order(id, 'in', 5); await f.order(id, 'out', 3);
  assert.equal(f.events().length, 1); assert.equal(f.events()[0].payload.data.total_cents, 5000);
  await f.configure({ enabled: false });
  assert.equal(f.events()[0].status, 'cancelled'); await f.notifications.tick(); assert.equal(f.sent.length, 0);
  await f.order(id, 'in', 5); assert.equal(f.events().length, 1);
  const version = (await f.request('/settings/notifications')).data.version;
  assert.equal((await f.request('/settings/notifications/test', 'POST', { version })).status, 202);
  await f.notifications.tick(); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].event.event, 'test');
});

test('returns, voids, stocktakes, damage, payments and permission changes produce distinct notifications', async t => {
  const f = await fixture(t); await f.configure({ include_amounts: true });
  const id = await f.product(); await f.order(id, 'in', 10);
  const sale = (await f.order(id, 'out', 4)).data;
  const payment = await f.command(`/orders/${sale.id}/payments`, { amount: 40, method: '现金', note: '' });
  assert.equal(payment.status, 200); assert.equal(f.events().at(-1).payload.data.payment_status, 'paid');
  await f.command(`/payments/${payment.data.id}/reverse`, { reason: '测试撤销' });
  assert.equal(f.events().at(-1).payload.data.due_cents, 4000);
  const returned = (await f.command(`/orders/${sale.id}/returns`, { reason: '退货', items: [{ product_id: id, quantity: 2 }] })).data;
  assert.equal(f.events().at(-1).event, 'order_return'); assert.equal(f.events().at(-1).payload.data.source_number, sale.number);
  await f.command(`/orders/${returned.id}/void`, { reason: '撤销退货' });
  assert.equal(f.events().at(-1).event, 'order_void');
  const count = f.events().length;
  await f.command('/stocktakes', { reason: '无差异盘点', items: [{ product_id: id, expected_stock: 6, counted: 6 }] });
  assert.equal(f.events().length, count);
  await f.command('/stocktakes', { reason: '盘点', items: [{ product_id: id, expected_stock: 6, counted: 5 }] });
  assert.equal(f.events().at(-1).event, 'stock_adjustment');
  await f.command('/stock/reduce/', { product_id: id, quantity: 1, reason: '破损' });
  assert.equal(f.events().at(-1).payload.data.action, '报损／减少库存');
  const employee = (await f.request('/users', 'POST', { username: 'operator', password: 'Test-operator-123', role: 'employee' })).data.id;
  assert.equal((await f.request(`/users/${employee}/permissions`, 'PUT', { permissions: ['purchase'], version: 1 })).status, 200);
  assert.equal(f.events().at(-1).payload.data.target_user, 'operator');
  assert.equal((await f.request(`/users/${employee}`, 'PUT', { role: 'employee', active: 0 })).status, 200);
  assert.equal(f.events().at(-1).payload.data.action, '修改账号角色／状态');
});

test('QR orders share notifications and replaying a preview does not duplicate them', async t => {
  const f = await fixture(t); await f.configure({ events: ['purchase_in'] });
  const id = await f.product();
  const q = await f.request('/stock-qrs', 'POST', { request_id: randomUUID(), name: '通知二维码', type: 'in', partner: '供应商', items: [{ product_id: id, quantity: 5, price_e4: 100000 }], max_scans: 3 });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  const source = f.db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  const preview = await f.request('/stock-qrs/preview', 'POST', { mode: 'in', label: { format: '77erp', version: 1, type: 'stock_operation', source_id: source, warehouse_id: 1, qr_id: q.data.qr_id } });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const body = { request_id: randomUUID(), confirmed: true, preview_token: preview.data.preview_token };
  const r = await f.request(`/stock-qrs/${q.data.qr_id}/execute`, 'POST', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await f.request(`/stock-qrs/${q.data.qr_id}/execute`, 'POST', body);
  assert.deepEqual(f.events().map(e => e.event), ['purchase_in']);
});

test('delivery retries keep event IDs, recover after restart, stop after five attempts and allow manual retry', async t => {
  const directory = mkdtempSync(join(tmpdir(), '77erp-notify-'));
  const path = join(directory, 'test.sqlite');
  const attempts = [];
  const fail = async (_, event) => { attempts.push(event.id); throw new Error('secret-url-token must not appear'); };
  const f = await fixture(t, { webhookSend: fail }, path);
  await f.configure({ events: ['purchase_in'] }); const id = await f.product(); await f.order(id, 'in', 5);
  await Promise.all([f.notifications.tick(), f.notifications.tick()]); assert.equal(attempts.length, 1);
  assert.equal(f.events()[0].status, 'retry'); const eventId = f.events()[0].id;
  f.db.exec("UPDATE notification_deliveries SET status='sending',next_at=0");
  await f.close();
  const g = await fixture(t, { webhookSend: fail }, path);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (let i = 0; i < 4; i++) { g.db.exec('UPDATE notification_deliveries SET next_at=0'); await g.notifications.tick(); }
  assert.equal(g.events()[0].status, 'failed'); assert.equal(g.events()[0].attempts, 5);
  assert.deepEqual([...new Set(attempts)], [eventId]); assert.ok(!g.events()[0].last_error.includes('secret-url-token'));
  await g.notifications.tick(); assert.equal(attempts.length, 5);
  assert.equal((await g.request(`/settings/notifications/deliveries/${eventId}/retry`, 'POST', {})).status, 200);
  await g.notifications.tick(); assert.equal(attempts.length, 6);
});

test('daily summaries use the chosen timezone, net returns, exclude voids, filter warehouses and run once per day', async t => {
  const f = await fixture(t);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const id = await f.product();
  const purchase = (await f.order(id, 'in', 10)).data;
  const sale = (await f.order(id, 'out', 4)).data;
  const ret = (await f.command(`/orders/${sale.id}/returns`, { reason: '退货', items: [{ product_id: id, quantity: 1 }] })).data;
  const voided = (await f.order(id, 'out', 1)).data;
  await f.command(`/orders/${voided.id}/void`, { reason: '汇总排除作废' });
  const other = (await f.request('/warehouses', 'POST', { name: '汇总排除仓库' })).data.id;
  const otherId = await f.product(other);
  const otherOrder = (await f.order(otherId, 'in', 50, {}, other)).data;
  for (const order of [purchase, sale, ret, voided, otherOrder]) f.db.prepare('UPDATE orders SET created_at=? WHERE id=?').run('2026-10-14T16:30:00.000Z', order.id);
  await f.configure({ events: ['daily_summary'], daily_time: '18:00', timezone: 'Asia/Shanghai', warehouse_ids: [1], include_amounts: true });
  queueDailySummary(f.db, new Date('2026-10-15T09:59:00Z')); assert.equal(f.events().length, 0);
  queueDailySummary(f.db, new Date('2026-10-15T10:00:00Z'));
  const summary = f.events()[0].payload.data;
  assert.equal(summary.warehouses.length, 1); assert.equal(summary.warehouses[0].sales_count, 1);
  assert.equal(summary.day, '2026-10-15'); assert.equal(summary.warehouses[0].purchase_cents, 10000); assert.equal(summary.warehouses[0].sales_cents, 3000);
  assert.equal(summary.warehouses[0].sales_returns_cents, 1000);
  queueDailySummary(f.db, new Date('2026-10-15T12:00:00Z')); assert.equal(f.events().length, 1);
  queueDailySummary(f.db, new Date('2026-10-16T12:00:00Z')); assert.equal(f.events().length, 2);
  assert.equal(f.events()[1].payload.data.warehouses[0].sales_cents, 0);
});

test('one stock event aggregates multiple affected products without duplicate alerts', async t => {
  const f = await fixture(t);
  const a = await f.product(), b = await f.product();
  await f.order(a, 'in', 5); await f.order(b, 'in', 5);
  await f.configure({ events: ['low_stock'] });
  const result = await f.request('/orders', 'POST', { type: 'out', partner: '客户', items: [a, b].map(product_id => ({ product_id, quantity: 3, price: 10 })) });
  assert.equal(result.status, 201);
  assert.equal(f.events().length, 1); assert.equal(f.events()[0].payload.data.items.length, 2);
});

test('webhook transport validates public destinations and signs the exact provider payload', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '169.254.169.254', '192.168.0.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true);
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/#secret', 'https://2130706433/x', 'https://[::ffff:127.0.0.1]/x']) assert.throws(() => validateWebhookUrl(url));
  const config = { url: 'https://example.com/hook', secret: 'signing-secret', format: 'json' };
  const event = { id: randomUUID(), event: 'sale_out', message: '77 ERP · 销售出库', data: {} };
  const timestamp = 1792000000000;
  const generic = webhookRequest(config, event, timestamp);
  assert.equal(generic.headers['X-77ERP-Signature'], `sha256=${createHmac('sha256', config.secret).update(`${timestamp}.${generic.body}`).digest('hex')}`);
  assert.deepEqual(JSON.parse(generic.body), event);
  const ding = webhookRequest({ ...config, format: 'dingtalk' }, event, timestamp);
  assert.equal(ding.url.searchParams.get('sign'), createHmac('sha256', config.secret).update(`${timestamp}\n${config.secret}`).digest('base64'));
  assert.equal(JSON.parse(ding.body).text.content, event.message);
  const feishu = JSON.parse(webhookRequest({ ...config, format: 'feishu' }, event, timestamp).body);
  assert.equal(feishu.sign, createHmac('sha256', `${feishu.timestamp}\n${config.secret}`).update('').digest('base64'));
  assert.deepEqual(JSON.parse(webhookRequest({ ...config, format: 'wecom' }, event, timestamp).body), { msgtype: 'text', text: { content: event.message } });
});

test('transport pins validated DNS, rejects private DNS and redirects, and detects robot errors in HTTP 200 responses', async () => {
  const config = { url: 'https://hooks.example.com/send', secret: '', format: 'wecom' };
  const event = { id: randomUUID(), message: '77 ERP · 测试通知' };
  let connections = 0;
  const transport = (status, body) => (_url, options, callback) => {
    connections++;
    options.lookup('hooks.example.com', { all: true }, (error, records) => { assert.equal(error, null); assert.deepEqual(records, [{ address: '8.8.8.8', family: 4 }]); });
    const req = new EventEmitter();
    req.end = () => { const res = new PassThrough(); res.statusCode = status; callback(res); res.end(body); };
    req.destroy = error => req.emit('error', error);
    return req;
  };
  const resolveAddress = async () => [{ address: '8.8.8.8', family: 4 }];
  await assert.rejects(sendWebhook(config, event, { resolveAddress: async () => [{ address: '127.0.0.1', family: 4 }], httpsRequest: transport(200, '{"errcode":0}') }));
  assert.equal(connections, 0);
  await assert.rejects(sendWebhook(config, event, { resolveAddress, httpsRequest: transport(302, '') }));
  assert.equal(connections, 1);
  await assert.rejects(sendWebhook(config, event, { resolveAddress, httpsRequest: transport(200, '{"errcode":40001}') }));
  await sendWebhook(config, event, { resolveAddress, httpsRequest: transport(200, '{"errcode":0}') });
  await sendWebhook({ ...config, format: 'feishu' }, event, { resolveAddress, httpsRequest: transport(200, '{"code":0}') });
  await sendWebhook({ ...config, format: 'json' }, event, { resolveAddress, httpsRequest: transport(204, '') });
});


test('material stock increases notify adjustments and recovered stock once without creating purchase events', async t => {
  const f = await fixture(t); await f.configure();
  const id = await f.product();
  const body = { product_id: id, quantity: 5, expected_stock: 0, reason: '生产余料回库', request_id: randomUUID() };
  assert.equal((await f.request('/stock/increase', 'POST', body)).status, 200);
  assert.equal((await f.request('/stock/increase', 'POST', body)).status, 200);
  assert.deepEqual(f.events().map(e => e.event), ['stock_adjustment', 'stock_recovered']);
  assert.equal(f.events()[0].payload.data.action, '退料／增加库存');
  assert.equal(f.events()[0].payload.data.items[0].stock, 5);
});

test('zero safety stock suppresses empty, low and recovery alerts and daily summary counts until enabled', async t => {
  const f = await fixture(t);
  await f.request('/settings/reset', 'POST', { confirmation: 'RESET_BUSINESS_DATA' });
  const id = await f.product();
  const updateThreshold = async threshold => {
    const product = f.db.prepare('SELECT * FROM products WHERE id=?').get(id);
    assert.equal((await f.request(`/products/${id}`, 'PUT', { ...product, threshold })).status, 200);
  };
  await updateThreshold(0);
  await f.configure({ events: ['low_stock', 'out_of_stock', 'stock_recovered'] });
  for (const [type, quantity] of [['in', 5], ['out', 3], ['out', 2], ['in', 5]])
    assert.equal((await f.order(id, type, quantity)).status, 201);
  assert.deepEqual(f.events(), []);
  await updateThreshold(2);
  assert.equal((await f.order(id, 'out', 3)).status, 201);
  assert.equal(f.events().at(-1).event, 'low_stock');
  await updateThreshold(0);
  assert.equal((await f.order(id, 'out', 2)).status, 201);
  assert.equal(f.events().length, 1);
  await f.configure({ events: ['daily_summary'], daily_time: '00:00', timezone: 'UTC' });
  for (const [day, threshold, expected] of [['20', 0, 0], ['21', 2, 1]]) {
    await updateThreshold(threshold);
    queueDailySummary(f.db, new Date(`2026-10-${day}T12:00:00Z`));
    const row = f.events().at(-1).payload.data.warehouses[0];
    assert.equal(row.low_stock, 0);
    assert.equal(row.out_of_stock, expected);
  }
});
