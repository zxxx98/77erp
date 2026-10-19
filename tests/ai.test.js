import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

async function fixture(t) {
  const calls = [], replies = [];
  const { app, db } = createApp(':memory:', { aiEncryptionKey: 'ab'.repeat(32), aiFetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const reply = replies.shift();
    if (typeof reply === 'function') return await reply();
    return new Response(JSON.stringify({ choices: [{ message: reply || { content: '已生成操作预览，请核对并确认。' } }] }), { status: 200 });
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); });
  const request = async (cookie, path, body, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = (await request(null, '/auth/setup', { username: 'owner', password: 'Strong-password-123' })).cookie;
  const id = (await request(admin, '/users', { username: 'staff', password: 'Strong-password-123' })).data.id;
  const staff = (await request(null, '/auth/login', { username: 'staff', password: 'Strong-password-123' })).cookie;
  const permissions = async values => {
    const version = db.prepare('SELECT permissions_version FROM users WHERE id=?').get(id).permissions_version;
    assert.equal((await request(admin, `/users/${id}/permissions`, { permissions: values, version }, 'PUT')).status, 200);
  };
  const settings = { enabled: true, writes: true, base_url: 'https://model.example/v1', model: 'test-model', secret: 'secret-test-key', daily_limit: 100 };
  assert.equal((await request(admin, '/settings/ai', settings, 'PUT')).status, 200);
  const use = (name, args) => replies.push({ content: null, tool_calls: [{ id: `call-${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const chat = (cookie, extra = {}) => request(cookie, '/ai/chat', { message: '请按要求操作', ...extra });
  const order = (type = 'in', quantity = 2, product_id = 1) => ({ warehouse_id: 1, type, partner: 'AI测试单位', items: [{ product_id, quantity, price: 12.5 }] });
  return { db, request, admin, staff, id, permissions, settings, calls, replies, use, chat, order };
}

test('AI configuration encrypts credentials, remains admin-only and requires separate usage permission', async t => {
  const f = await fixture(t);
  assert.equal((await f.chat(null)).status, 401);
  assert.equal((await f.chat(f.staff)).status, 403);
  assert.equal((await f.request(f.staff, '/settings/ai')).status, 403);
  const config = (await f.request(f.admin, '/settings/ai')).data;
  assert.equal(config.has_secret, true); assert.equal(config.secret, undefined);
  assert.ok(!f.db.prepare('SELECT secret FROM ai_settings').get().secret.includes('secret-test-key'));
  assert.equal((await f.request(f.admin, '/settings/ai', { ...f.settings, base_url: 'https://other.example/v1', secret: '' }, 'PUT')).status, 400);
  await f.permissions(['ai']);
  assert.equal((await f.chat(f.staff)).status, 200);
  f.use('preview_orders', { orders: [f.order()] });
  assert.equal((await f.chat(f.staff)).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_actions').get().n, 0);
});

test('cross-warehouse comparison matches identity and distinguishes absent products and incompatible units', async t => {
  const f = await fixture(t);
  const b = (await f.request(f.admin, '/warehouses', { name: 'B库', reuse_catalog: true })).data.id;
  const source = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  f.db.prepare('UPDATE products SET stock=7 WHERE warehouse_id=? AND sync_key=?').run(b, source.sync_key);
  f.use('compare_stock', { product_id: 1, warehouse_a: 1, warehouse_b: b });
  const r = await f.chat(f.admin); assert.equal(r.status, 200);
  const result = JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content);
  assert.equal(result.b.stock, 7); assert.equal(result.difference_a_minus_b, source.stock - 7);
  f.db.prepare("UPDATE products SET unit='不同单位' WHERE warehouse_id=? AND sync_key=?").run(b, source.sync_key);
  f.use('compare_stock', { product_id: 1, warehouse_a: 1, warehouse_b: b }); await f.chat(f.admin);
  assert.equal(JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content).difference_a_minus_b, null);
  const empty = (await f.request(f.admin, '/warehouses', { name: '空仓' })).data.id;
  f.use('compare_stock', { product_id: 1, warehouse_a: 1, warehouse_b: empty }); await f.chat(f.admin);
  assert.equal(JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content).b.stock, null);
});

test('AI identifies internal units and preserves their identity and accounting through preview and confirmation', async t => {
  const f = await fixture(t);
  const contact = await f.request(f.admin, '/contacts', { request_id: randomUUID(), role: 'internal', name: 'AI内部产线', person: '', phone: '', address: '', note: '', active: 1 });
  assert.equal(contact.status, 200);
  const before = (await f.request(f.admin, '/dashboard')).data.today;
  f.use('search_contacts', { query: 'AI内部产线' });
  await f.chat(f.admin);
  const found = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(found[0].role, 'internal');
  const count = f.db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  f.use('preview_orders', { orders: [{ ...f.order('out', 2), partner: 'AI内部产线', partner_id: contact.data.id }] });
  const preview = await f.chat(f.admin);
  const action = preview.data.actions[0];
  assert.ok(action);
  assert.equal(action.preview.orders[0].kind, 'internal');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, count);
  const confirmed = await f.request(f.admin, '/ai/confirm', { action_id: action.id });
  assert.equal(confirmed.status, 200);
  const order = f.db.prepare('SELECT * FROM orders WHERE id=?').get(confirmed.data.orders[0].id);
  assert.equal(order.kind, 'internal');
  assert.equal(order.partner_id, contact.data.id);
  assert.equal(order.settlement_tracked, 0);
  assert.deepEqual((await f.request(f.admin, '/dashboard')).data.today, before);
});

test('batch orders preview without writes, confirm atomically, attribute to current user and deduplicate retries', async t => {
  const f = await fixture(t); await f.permissions(['ai','purchase','sale']);
  const before = f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock;
  const count = f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  f.use('preview_orders', { orders: [{ ...f.order('in', 5), created_by: 1 }, f.order('out', 3)] });
  const r = await f.chat(f.staff); assert.equal(r.status, 200);
  const action = r.data.actions[0]; assert.ok(action);
  assert.equal(action.preview.orders[1].items[0].stock, before + 5);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, count);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: action.id })).status, 404);
  const confirmed = await f.request(f.staff, '/ai/confirm', { action_id: action.id }); assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.orders.length, 2);
  for (const o of confirmed.data.orders) assert.equal(f.db.prepare('SELECT created_by FROM orders WHERE id=?').get(o.id).created_by, f.id);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before + 2);
  const retry = await f.request(f.staff, '/ai/confirm', { action_id: action.id }); assert.deepEqual(retry.data, confirmed.data);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, count + 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_audit WHERE tool='confirm_orders' AND status='success'").get().n, 1);
});

test('previews reject changed stock, revoked permissions, expired actions and wrong owners', async t => {
  const f = await fixture(t); await f.permissions(['ai','purchase']);
  f.use('preview_orders', { orders: [f.order()] }); const r = await f.chat(f.staff), a = r.data.actions[0];
  assert.equal((await f.request(f.admin, `/ai/conversations/${r.data.conversation_id}`)).status, 404);
  f.db.prepare('UPDATE products SET stock=stock+1 WHERE id=1').run();
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 409);
  f.db.prepare('UPDATE products SET stock=stock-1 WHERE id=1').run();
  f.db.prepare('UPDATE ai_actions SET expires_at=0 WHERE id=?').run(a.id);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 409);
  await f.permissions(['ai']);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 403);
  assert.equal((await f.request(f.staff, `/ai/conversations/${r.data.conversation_id}`)).status, 403);
});

test('bad batch is rolled back entirely and AI cannot invoke confirmation as a tool', async t => {
  const f = await fixture(t), before = f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock;
  f.use('preview_orders', { orders: [f.order('in', 1), f.order('out', 999999)] });
  const r = await f.chat(f.admin); assert.equal(r.data.actions.length, 0);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE name='AI测试单位'").get().n, 0);
  f.use('confirm', { action_id: 'anything' }); const bad = await f.chat(f.admin);
  assert.equal(bad.data.actions.length, 0);
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /不支持/);
});

test('Excel column mapping imports exact full table after confirmation, preserves text barcodes and detects duplicates', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const table = [['名称','编码','计量','采购价','销售价','数量'], ...Array.from({length:8}, (_,i) => [`测试物料${i}`, `00${i}`, '个', 2, 3, i + 1])];
  const args = { warehouse_id: 1, mapping: { name: 0, barcode: 1, unit: 2, cost: 3, price: 4, stock: 5 } };
  f.use('preview_import', args); const r = await f.chat(f.staff, { table, message: '新增物料，数量为期初库存，安全库存默认0' });
  assert.equal(r.status, 200); assert.ok(r.data.actions[0], JSON.stringify(f.calls.at(-1).body.messages)); assert.equal(r.data.actions[0].preview.rows.length, 8);
  assert.ok(!f.calls[0].body.messages[0].content.includes('测试物料7'));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM products WHERE barcode='007'").get().n, 0);
  const a = r.data.actions[0], result = await f.request(f.staff, '/ai/confirm', { action_id: a.id });
  assert.equal(result.status, 200); assert.equal(result.data.count, 8);
  assert.equal(f.db.prepare("SELECT stock FROM products WHERE barcode='007'").get().stock, 8);
  assert.deepEqual((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).data, result.data);
  f.use('preview_import', args); const duplicate = await f.chat(f.staff, { table });
  assert.equal(duplicate.data.actions.length, 0);
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /条码重复/);
});

test('Excel mapping recognises a fixed-asset column and stores the flag on import', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const table = [['名称','单位','固定资产'], ['巡检仪','台','是'], ['螺丝','个','否'], ['电脑','台','true'], ['扳手','把','']];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, is_fixed_asset: 2 } });
  const r = await f.chat(f.staff, { table });
  assert.equal(r.status, 200); const a = r.data.actions[0]; assert.ok(a, JSON.stringify(f.calls.at(-1).body.messages));
  assert.deepEqual(a.preview.rows.map(row => row.is_fixed_asset), [1, 0, 1, 0]);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 200);
  const flags = Object.fromEntries(f.db.prepare('SELECT name,is_fixed_asset FROM products').all().map(p => [p.name, p.is_fixed_asset]));
  assert.equal(flags['巡检仪'], 1); assert.equal(flags['螺丝'], 0); assert.equal(flags['电脑'], 1); assert.equal(flags['扳手'], 0);
});

test('Excel mapping rejects an unrecognised fixed-asset value', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const table = [['名称','单位','固定资产'], ['螺丝','个','也许']];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, is_fixed_asset: 2 } });
  const r = await f.chat(f.staff, { table });
  assert.equal(r.status, 200);
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /固定资产标记无法识别/);
});

test('permissions and sessions are revalidated after model latency, and quotas are enforced', async t => {
  const f = await fixture(t); await f.permissions(['ai','purchase']);
  f.replies.push(async () => {
    f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.id);
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call', type: 'function', function: { name: 'preview_orders', arguments: JSON.stringify({ orders: [f.order()] }) } }] } }] }));
  });
  assert.equal((await f.chat(f.staff)).status, 401);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_actions').get().n, 0);
  f.db.prepare('UPDATE ai_settings SET daily_limit=1').run();
  assert.equal((await f.chat(f.admin)).status, 200); assert.equal((await f.chat(f.admin)).status, 429);
});

test('confirmation failure rolls back earlier orders, and reset invalidates pending imports and conversations', async t => {
  const f = await fixture(t);
  const before = f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock;
  f.use('preview_orders', { orders: [f.order(), { ...f.order(), partner: '失败测试' }] });
  const r = await f.chat(f.admin); assert.equal(r.data.actions.length, 1);
  f.db.exec("CREATE TRIGGER ai_test_failure BEFORE INSERT ON orders WHEN NEW.partner='失败测试' BEGIN SELECT RAISE(ABORT,'模拟提交失败'); END;");
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: r.data.actions[0].id })).status, 400);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE partner='AI测试单位'").get().n, 0);
  assert.equal(f.db.prepare('SELECT result FROM ai_actions WHERE id=?').get(r.data.actions[0].id).result, null);
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1 } });
  const imported = await f.chat(f.admin, { table: [['名称','单位'],['新增物料','个']] });
  assert.equal(imported.data.actions.length, 1);
  assert.equal((await f.request(f.admin, '/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' })).status, 200);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: imported.data.actions[0].id })).status, 403);
  assert.equal((await f.request(f.admin, `/ai/conversations/${imported.data.conversation_id}`)).status, 403);
});

test('AI transfer previews target creation, preserves total stock/value, attributes both legs and deduplicates confirmation', async t => {
  const f = await fixture(t); await f.permissions(['ai', 'transfer']);
  const to = (await f.request(f.admin, '/warehouses', { name: '调入仓' })).data.id;
  const before = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  f.use('preview_transfer', { warehouse_id: 1, to_warehouse_id: to, reason: '补货', items: [{ product_id: 1, quantity: 2 }] });
  const r = await f.chat(f.staff), a = r.data.actions[0]; assert.ok(a, JSON.stringify(r.data));
  assert.equal(a.preview.transfer.items[0].creates_product, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM products WHERE warehouse_id=?').get(to).n, 0);
  assert.ok(f.calls[0].body.tools.some(t => t.function.name === 'preview_transfer'));
  assert.ok(!f.calls[0].body.tools.some(t => t.function.name === 'preview_stocktake'));
  const result = await f.request(f.staff, '/ai/confirm', { action_id: a.id }); assert.equal(result.status, 200);
  const source = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  const target = f.db.prepare('SELECT * FROM products WHERE warehouse_id=?').get(to);
  assert.equal(source.stock, before.stock - 2); assert.equal(target.stock, 2);
  assert.equal(source.inventory_value_cents + target.inventory_value_cents, before.inventory_value_cents);
  const legs = f.db.prepare('SELECT created_by FROM orders WHERE transfer_id=?').all(result.data.transfer_id);
  assert.equal(legs.length, 2); assert.ok(legs.every(o => o.created_by === f.id));
  assert.deepEqual((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).data, result.data);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(target.id).stock, 2);
  assert.equal(f.db.prepare("SELECT user_id FROM ai_audit WHERE tool='confirm_transfer' AND status='success'").get().user_id, f.id);
});

test('AI transfer rejects stale destinations, mismatched units, wrong warehouse, insufficient stock and missing permission', async t => {
  const f = await fixture(t), to = (await f.request(f.admin, '/warehouses', { name: '调入仓', reuse_catalog: true })).data.id;
  const source = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  const target = f.db.prepare('SELECT * FROM products WHERE warehouse_id=? AND sync_key=?').get(to, source.sync_key);
  const args = { warehouse_id: 1, to_warehouse_id: to, reason: '补货', items: [{ product_id: 1, quantity: 1 }] };
  await f.permissions(['ai']); f.use('preview_transfer', args);
  assert.equal((await f.chat(f.staff)).status, 403);
  await f.permissions(['ai', 'transfer']); f.use('preview_transfer', args);
  const r = await f.chat(f.staff), a = r.data.actions[0]; assert.ok(a);
  f.db.prepare('UPDATE products SET stock=stock+1 WHERE id=?').run(target.id);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 409);
  f.db.prepare("UPDATE products SET unit='不同单位' WHERE id=?").run(target.id);
  f.use('preview_transfer', args); assert.equal((await f.chat(f.staff)).data.actions.length, 0);
  f.db.prepare('UPDATE products SET unit=? WHERE id=?').run(source.unit, target.id);
  for (const bad of [{ ...args, to_warehouse_id: 1 }, { ...args, items: [{ product_id: target.id, quantity: 1 }] }, { ...args, items: [{ product_id: 1, quantity: source.stock + 1 }] }]) {
    f.use('preview_transfer', bad); assert.equal((await f.chat(f.staff)).data.actions.length, 0);
  }
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, source.stock);
});

test('AI stocktake uses server expected stock, records exact counts and batch owner, leaves omitted products untouched', async t => {
  const f = await fixture(t); await f.permissions(['ai', 'stocktake']);
  const before = f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock;
  const untouched = f.db.prepare('SELECT stock FROM products WHERE id=2').get().stock;
  f.use('preview_stocktake', { warehouse_id: 1, reason: '月末实盘', items: [{ product_id: 1, counted: 0, expected_stock: 999 }] });
  const r = await f.chat(f.staff), a = r.data.actions[0]; assert.ok(a, JSON.stringify(r.data));
  assert.equal(a.preview.stocktake.items[0].before_stock, before);
  assert.equal(a.preview.stocktake.items[0].difference, -before);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before);
  const result = await f.request(f.staff, '/ai/confirm', { action_id: a.id }); assert.equal(result.status, 200);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, 0);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=2').get().stock, untouched);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_adjustments WHERE batch=?').get(result.data.batch).n, 1);
  assert.equal(f.db.prepare("SELECT user_id FROM ai_audit WHERE tool='confirm_stocktake' AND status='success'").get().user_id, f.id);
  assert.deepEqual((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).data, result.data);
});

test('AI stocktake blocks stale stock, revoked permission, invalid counts and cross-warehouse items', async t => {
  const f = await fixture(t); await f.permissions(['ai', 'stocktake']);
  const args = { warehouse_id: 1, reason: '实盘', items: [{ product_id: 1, counted: 3.25 }] };
  f.use('preview_stocktake', args); const r = await f.chat(f.staff), a = r.data.actions[0]; assert.ok(a);
  f.db.prepare('UPDATE products SET stock=stock+1 WHERE id=1').run();
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 409);
  await f.permissions(['ai']);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 403);
  f.use('preview_stocktake', args); assert.equal((await f.chat(f.staff)).status, 403);
  const other = (await f.request(f.admin, '/warehouses', { name: '其他仓库' })).data.id;
  for (const bad of [{ ...args, warehouse_id: other }, { ...args, reason: '' }, { ...args, items: [{ product_id: 1, counted: -1 }] }, { ...args, items: [{ product_id: 1, counted: 0.0000001 }] }, { ...args, items: [args.items[0], args.items[0]] }]) {
    f.use('preview_stocktake', bad); assert.equal((await f.chat(f.admin)).data.actions.length, 0);
  }
});

test('AI transfer and stocktake confirmation failures roll back all stock, archives and audit success records', async t => {
  const f = await fixture(t), to = (await f.request(f.admin, '/warehouses', { name: '原子调拨目标' })).data.id;
  const stocks = () => f.db.prepare('SELECT id,stock,inventory_value_cents FROM products ORDER BY id').all();
  const before = stocks();
  f.use('preview_transfer', { warehouse_id: 1, to_warehouse_id: to, reason: '补货', items: [{ product_id: 1, quantity: 1 }] });
  const transfer = (await f.chat(f.admin)).data.actions[0]; assert.ok(transfer);
  f.db.exec("CREATE TRIGGER ai_transfer_failure BEFORE INSERT ON orders WHEN NEW.kind='transfer' AND NEW.type='in' BEGIN SELECT RAISE(ABORT,'模拟调入失败'); END;");
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: transfer.id })).status, 400);
  assert.deepEqual(stocks(), before);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE kind='transfer'").get().n, 0);
  f.use('preview_stocktake', { warehouse_id: 1, reason: '实盘', items: [{ product_id: 1, counted: 1 }, { product_id: 2, counted: 2 }] });
  const stocktake = (await f.chat(f.admin)).data.actions[0]; assert.ok(stocktake);
  f.db.exec("CREATE TRIGGER ai_stocktake_failure BEFORE INSERT ON stock_adjustments WHEN NEW.kind='stocktake' AND NEW.product_id=2 BEGIN SELECT RAISE(ABORT,'模拟盘点失败'); END;");
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: stocktake.id })).status, 400);
  assert.deepEqual(stocks(), before);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_audit WHERE tool IN ('confirm_transfer','confirm_stocktake') AND status='success'").get().n, 0);
});

test('conversation history only lists the current user and current permission context', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(null, '/ai/conversations')).status, 401);
  assert.equal((await f.request(f.staff, '/ai/conversations')).status, 403);
  await f.permissions(['ai']);
  const own = await f.chat(f.staff, { message: '我的库存查询' });
  await f.chat(f.admin, { message: '管理员的私人对话' });
  const list = await f.request(f.staff, '/ai/conversations');
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].id, own.data.conversation_id);
  assert.equal(list.data[0].title, '我的库存查询');
  assert.equal(list.data[0].messages, undefined);
  await f.permissions(['ai', 'purchase']);
  assert.deepEqual((await f.request(f.staff, '/ai/conversations')).data, []);
  assert.equal((await f.request(f.staff, `/ai/conversations/${own.data.conversation_id}`)).status, 403);
});
