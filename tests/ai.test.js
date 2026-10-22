import ExcelJS from 'exceljs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { inspectionToday, nextInspectionDate } from '../shared/inspection.js';

async function fixture(t, dbPath = ':memory:') {
  const calls = [], replies = [];
  const { app, db } = createApp(dbPath, { aiEncryptionKey: 'ab'.repeat(32), qualityStorage:{async put(){},async head(){},async get(){return Buffer.alloc(0);},async remove(){}}, aiFetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const reply = replies.shift();
    if (typeof reply === 'function') return await reply();
    return new Response(JSON.stringify({ choices: [{ message: reply || { content: '已生成操作预览，请核对并确认。' } }] }), { status: 200 });
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); });
  const request = async (cookie, path, body, method = body === undefined ? 'GET' : 'POST', warehouseId=1) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { ...(body instanceof FormData?{}:{'Content-Type': 'application/json'}), 'X-Warehouse-ID':String(warehouseId), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : body instanceof FormData?body:JSON.stringify(body) });
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

test('AI material search resolves customer part numbers with customer identity and warehouse scope', async t => {
  const f = await fixture(t);
  const customer = (await f.request(f.admin, '/contacts', { request_id: randomUUID(), role: 'customer', name: '料号客户', person: '', phone: '', address: '', note: '', active: 1 })).data;
  const parts = [{ customer_id: customer.id, part_number: 'CPN-AI-001' }];
  const created = await f.request(f.admin, '/products', { name: '料号搜索物料', category: '测试', unit: '件', cost: 10, price: 20, threshold: 0, customer_part_numbers: parts });
  assert.equal(created.status, 201);
  f.use('search_products', { warehouse_id: 1, query: 'CPN-AI' });
  assert.equal((await f.chat(f.admin)).status, 200);
  const found = JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, created.data.id);
  assert.deepEqual(found[0].customer_part_numbers, [{ ...parts[0], customer_name: '料号客户' }]);
  assert.equal(found[0].cost, undefined);
  const other = (await f.request(f.admin, '/warehouses', { name: '无料号仓库' })).data;
  f.use('search_products', { warehouse_id: other.id, query: 'CPN-AI' });
  await f.chat(f.admin);
  assert.deepEqual(JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content), []);
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

test('continuing a conversation supersedes unconfirmed previews while preserving completed results and other conversations', async t => {
  const f = await fixture(t); await f.permissions(['ai', 'purchase']);
  const before = f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock;
  f.use('preview_orders', { orders: [f.order()] });
  const first = (await f.chat(f.staff)).data, old = first.actions[0];
  assert.equal(old.turn_index, 0);
  const cid = first.conversation_id;
  assert.equal((await f.chat(f.staff, { conversation_id: cid, message: ' ' })).status, 400);
  await f.chat(f.staff); // A new, unrelated conversation must leave the original preview available.
  assert.deepEqual((await f.request(f.staff, `/ai/conversations/${cid}`)).data.actions.map(a => a.id), [old.id]);

  f.use('preview_orders', { orders: [f.order('in', 3)] });
  const next = await f.chat(f.staff, { conversation_id: cid, message: '改成入库3个' });
  assert.equal(next.status, 200);
  assert.equal(next.data.actions.length, 1);
  const replacement = next.data.actions[0];
  assert.equal(replacement.turn_index, 1);
  assert.notEqual(replacement.id, old.id);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before);
  const cancelled = await f.request(f.staff, '/ai/confirm', { action_id: old.id });
  assert.equal(cancelled.status, 409);
  assert.match(cancelled.data.error, /已取消/);
  assert.deepEqual((await f.request(f.staff, `/ai/conversations/${cid}`)).data.actions.map(a => a.id), [replacement.id]);

  const confirmed = await f.request(f.staff, '/ai/confirm', { action_id: replacement.id });
  assert.equal(confirmed.status, 200);
  const continued = await f.chat(f.staff, { conversation_id: cid, message: '谢谢' });
  assert.equal(continued.data.actions.length, 1);
  assert.deepEqual(continued.data.actions[0].result, confirmed.data);
  assert.equal(continued.data.actions[0].turn_index, 1);
  assert.equal((await f.request(f.staff, `/ai/conversations/${cid}`)).data.actions[0].turn_index, 1);
  assert.deepEqual((await f.request(f.staff, '/ai/confirm', { action_id: replacement.id })).data, confirmed.data);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, before + 3);
});

test('provider failures do not restore superseded previews or discard previews from the current turn', async t => {
  const f = await fixture(t);
  f.use('preview_orders', { orders: [f.order()] });
  const first = (await f.chat(f.admin)).data, old = first.actions[0];
  const failure = () => { throw new Error('测试模型暂时不可用'); };
  f.replies.push(failure);
  const failed = await f.chat(f.admin, { conversation_id: first.conversation_id, message: '先不要操作' });
  assert.equal(failed.status, 200);
  assert.match(failed.data.error, /AI 服务连接失败/);
  assert.deepEqual(failed.data.actions, []);
  assert.deepEqual((await f.request(f.admin, `/ai/conversations/${first.conversation_id}`)).data.actions, []);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: old.id })).status, 409);

  f.use('preview_orders', { orders: [f.order()] });
  f.replies.push(failure);
  const regenerated = await f.chat(f.admin, { conversation_id: first.conversation_id, message: '重新生成' });
  assert.match(regenerated.data.error, /AI 服务连接失败/);
  assert.equal(regenerated.data.actions.length, 1);
  assert.equal(regenerated.data.actions[0].turn_index, 2);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: regenerated.data.actions[0].id })).status, 200);
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

test('a second upload in the same conversation uses the new table and drops the previous mapping context', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const first = [['名称','单位','数量'], ['甲','个',1]];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, stock: 2 } });
  const r1 = await f.chat(f.staff, { table: first, message: '导入上传表' });
  const cid = r1.data.conversation_id;
  const second = [['编码','物料名称','单位','数量'], ['B001','乙','台',5]];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 1, barcode: 0, unit: 2, stock: 3 } });
  const from = f.calls.length;
  const r2 = await f.chat(f.staff, { table: second, conversation_id: cid, message: '再导入这个上传表' });
  assert.equal(r2.data.actions.length, 1);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: r1.data.actions[0].id })).status, 409);
  const latest = r2.data.actions.at(-1).preview.rows;
  assert.deepEqual(latest.map(r => r.name), ['乙']);
  assert.equal(latest[0].barcode, 'B001');
  const context = f.calls[from].body.messages;
  assert.ok(!context.some(m => m.role === 'tool'), 'previous import tool results must be dropped from the model context');
  assert.ok(!context.some(m => m.role === 'assistant' && m.tool_calls?.some(c => c.function?.name === 'preview_import')), 'previous import tool calls must be dropped');
  assert.ok(context.find(m => m.role === 'system').content.includes('B001'), 'system prompt must expose the newly uploaded sample');
});

test('older completed imports recover their original turns after upload context replacement and restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), '77erp-ai-turns-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'app.sqlite'), f = await fixture(t, dbPath);
  // This conversation has a text-only turn before either action.
  const start = await f.chat(f.admin, { message: '准备导入物料' }), cid = start.data.conversation_id;
  const table = [['名称','单位'], ['甲','个']];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1 } });
  const first = await f.chat(f.admin, { table, conversation_id: cid });
  const old = first.data.actions[0];assert.equal(old.turn_index, 1);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: old.id })).status, 200);
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1 } });
  const next = await f.chat(f.admin, { table: [['名称','单位'], ['乙','台']], conversation_id: cid });
  assert.deepEqual(next.data.actions.map(action => action.turn_index), [1, 2]);
  const stored = JSON.parse(f.db.prepare('SELECT messages FROM ai_conversations WHERE id=?').get(cid).messages);
  assert.ok(!stored.some(message => message.role === 'tool' && JSON.parse(message.content).action_id === old.id));
  // Simulate the schema before turn associations were introduced.
  f.db.exec('ALTER TABLE ai_actions DROP COLUMN turn_index');
  const { db: reopened } = createApp(dbPath);
  t.after(() => reopened.close());
  const recovered = await f.request(f.admin, `/ai/conversations/${cid}`);
  assert.deepEqual(recovered.data.actions.map(action => action.turn_index), [1, 2]);
  assert.ok(recovered.data.actions[0].result);
});

test('uploaded table metadata is shown in the transcript, persisted for reopening and stripped from the model payload', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const table = [['名称','单位'], ['甲','个'], ['乙','个']];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1 } });
  const r = await f.chat(f.staff, { table, table_name: '进货明细.xlsx', message: '导入上传表' });
  const user = r.data.messages.find(m => m.role === 'user');
  assert.deepEqual(user.attachment, { name: '进货明细.xlsx', rows: 2 });
  assert.ok(f.calls.every(call => call.body.messages.every(m => m.attachment === undefined)), 'attachment metadata must never be sent to the model');
  const reopened = await f.request(f.staff, `/ai/conversations/${r.data.conversation_id}`);
  assert.deepEqual(reopened.data.messages.find(m => m.role === 'user').attachment, { name: '进货明细.xlsx', rows: 2 });
  const named = await f.chat(f.staff, { table, message: '再导入' });
  assert.equal(named.data.messages.find(m => m.role === 'user').attachment.name, '表格');
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

test('AI reads the full uploaded table, writes back a cleaned table and imports from it', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const raw = [
    ['2026年6月进货清单', null, null],
    ['说明：仅统计本月新增', null, null],
    ['品名', '单位', '数量'],
    ['螺丝', '个', 5],
    ['合计', null, 5],
    ['垫片', '盒', 3],
  ];
  f.use('read_import_table', {});
  f.use('replace_import_table', { rows: [['物料名称', '单位', '期初库存'], ['螺丝', '个', 5], ['垫片', '盒', 3]] });
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, stock: 2 } });
  const r = await f.chat(f.staff, { table: raw, message: '去掉标题和合计行，整理后导入' });
  const readResult = JSON.parse(f.calls.find(c => c.body.messages.some(m => m.role === 'tool' && /品名/.test(m.content)))?.body.messages.find(m => m.role === 'tool' && /品名/.test(m.content)).content);
  assert.equal(readResult.row_count, 5);
  assert.equal(readResult.rows[0][0], '2026年6月进货清单');
  const a = r.data.actions.at(-1);
  assert.deepEqual(a.preview.rows.map(row => row.name), ['螺丝', '垫片']);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 200);
  assert.equal(f.db.prepare("SELECT stock FROM products WHERE name='垫片'").get().stock, 3);
});

test('replace_import_table rejects an invalid table and requires data_io permission', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const raw = [['名称', '单位'], ['螺丝', '个']];
  f.use('replace_import_table', { rows: [['']] });
  await f.chat(f.staff, { table: raw, message: '整理' });
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /表格需为表头加1–1000行/);
  await f.permissions(['ai']);
  f.use('read_import_table', {});
  const denied = await f.chat(f.staff, { table: raw, message: '整理' });
  assert.equal(denied.status, 403);
});

test('AI import assigns an existing category chosen by id for rows without a category column', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  f.use('categories', { warehouse_id: 1 }); await f.chat(f.staff);
  const categories = JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content);
  const office = categories.find(c => c.path === '办公文具');
  assert.ok(office);
  const table = [['名称','单位'], ['订书机', '个'], ['文件夹', '个']];
  f.use('preview_import', { warehouse_id: 1, default_category_id: office.id, mapping: { name: 0, unit: 1 } });
  const r = await f.chat(f.staff, { table });
  const a = r.data.actions[0]; assert.ok(a, JSON.stringify(f.calls.at(-1).body.messages));
  assert.equal(a.preview.default_category.path, '办公文具');
  assert.deepEqual(a.preview.rows.map(row => row.category), ['办公文具', '办公文具']);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 200);
  assert.equal(f.db.prepare("SELECT category FROM products WHERE name='订书机'").get().category, '办公文具');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM categories WHERE warehouse_id=1").get().n, 3);
});

test('AI import matches a category column against existing categories and reports new ones', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const table = [['名称','单位','分类'], ['蓝牙耳机','个','数码配件'], ['键盘','个','电脑外设'], ['鼠标','个','数码配件']];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, category: 2 } });
  const r = await f.chat(f.staff, { table });
  const a = r.data.actions[0]; assert.ok(a, JSON.stringify(f.calls.at(-1).body.messages));
  assert.deepEqual(a.preview.rows.map(row => row.category), ['数码配件', '电脑外设', '数码配件']);
  assert.deepEqual(a.preview.created_categories, ['电脑外设']);
  const existing = f.db.prepare("SELECT category_id FROM products WHERE id=2").get().category_id;
  assert.equal(a.preview.rows[0].category_id, existing);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).status, 200);
  assert.equal(f.db.prepare("SELECT category FROM products WHERE name='蓝牙耳机'").get().category, '数码配件');
  assert.equal(f.db.prepare("SELECT category_id FROM products WHERE name='蓝牙耳机'").get().category_id, existing);
  assert.equal(f.db.prepare("SELECT category FROM products WHERE name='键盘'").get().category, '电脑外设');
});

test('AI import rejects an unknown default category and an over-long category name', async t => {
  const f = await fixture(t); await f.permissions(['ai','data_io']);
  const table = [['名称','单位'], ['订书机', '个']];
  f.use('preview_import', { warehouse_id: 1, default_category_id: 999, mapping: { name: 0, unit: 1 } });
  await f.chat(f.staff, { table });
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /默认分类不存在/);
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, category: 2 } });
  const long = '超'.repeat(101);
  const wide = [['名称', '单位', '分类'], ['订书机', '个', long]];
  await f.chat(f.staff, { table: wide });
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /分类名称超过100字/);
});

test('AI lists due inspections and only flags products that already reached the inspection date', async t => {
  const f = await fixture(t); await f.permissions(['ai','products']);
  f.db.prepare("UPDATE products SET inspection_date='2020-01-01',inspection_interval=1,inspection_unit='month' WHERE id=1").run();
  f.db.prepare("UPDATE products SET inspection_date='2999-01-01',inspection_interval=0 WHERE id=2").run();
  f.use('search_inspections', { warehouse_id: 1, due: true });
  await f.chat(f.staff);
  const due = JSON.parse(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content);
  assert.equal(due.total, 1); assert.equal(due.products[0].id, 1);
  const mark = { warehouse_id: 1, items: [{ product_id: 2 }] };
  f.use('preview_mark_inspected', mark); await f.chat(f.staff);
  assert.match(f.calls.at(-1).body.messages.find(m => m.role === 'tool').content, /尚未到校验日期/);
  f.use('preview_mark_inspected', { warehouse_id: 1, items: [{ product_id: 1 }] });
  const r = await f.chat(f.staff);
  const a = r.data.actions[0]; assert.ok(a, JSON.stringify(f.calls.at(-1).body.messages));
  assert.equal(a.preview.last_inspected_on, inspectionToday());
  assert.equal(a.preview.items[0].after_date, nextInspectionDate(inspectionToday(), 1, 'month'));
});

test('AI backdates inspections with the same dates in preview and confirmation, including manual and overdue schedules', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-05T12:00:00Z') });
  const f = await fixture(t); await f.permissions(['ai', 'products']);
  f.db.prepare("UPDATE products SET inspection_date='2000-01-01',inspection_interval=1,inspection_unit='month' WHERE id=1").run();
  f.db.prepare("UPDATE products SET inspection_date='2000-01-01',inspection_interval=0 WHERE id=2").run();
  const before = f.db.prepare('SELECT * FROM products WHERE id IN (1,2) ORDER BY id').all();
  const args = { warehouse_id: 1, items: [{ product_id: 1 }, { product_id: 2 }], inspected_on: '2030-01-31', next_date: '2030-04-01' };
  f.use('preview_mark_inspected', args);
  const response = await f.chat(f.staff), action = response.data.actions[0];
  assert.ok(action, JSON.stringify(response.data));
  assert.equal(action.preview.last_inspected_on, args.inspected_on);
  assert.deepEqual(action.preview.items.map(item => item.after_date), ['2030-02-28', '2030-04-01']);
  assert.equal(action.preview.items[0].interval, 1);
  assert.deepEqual(f.db.prepare('SELECT * FROM products WHERE id IN (1,2) ORDER BY id').all(), before);
  const confirmed = await f.request(f.staff, '/ai/confirm', { action_id: action.id });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.last_inspected_on, args.inspected_on);
  assert.deepEqual(f.db.prepare('SELECT inspection_date,last_inspected_on FROM products WHERE id IN (1,2) ORDER BY id').all().map(row => ({ ...row })), [
    { inspection_date: '2030-02-28', last_inspected_on: args.inspected_on },
    { inspection_date: '2030-04-01', last_inspected_on: args.inspected_on },
  ]);
  assert.deepEqual((await f.request(f.staff, '/ai/confirm', { action_id: action.id })).data, confirmed.data);
});

test('AI rejects invalid or future actual inspection dates and manual dates at or before the actual date', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-05T12:00:00Z') });
  const f = await fixture(t); await f.permissions(['ai', 'products']);
  f.db.prepare("UPDATE products SET inspection_date='2000-01-01',inspection_interval=0 WHERE id=1").run();
  for (const extra of [
    { inspected_on: '' }, { inspected_on: null }, { inspected_on: '2030-02-30' }, { inspected_on: '2030-03-06' },
    { inspected_on: '2030-02-01', next_date: '2030-02-01' },
    { inspected_on: '2030-02-01', next_date: '2030-01-31' },
  ]) {
    f.use('preview_mark_inspected', { warehouse_id: 1, items: [{ product_id: 1 }], next_date: '2030-04-01', ...extra });
    const response = await f.chat(f.staff);
    assert.deepEqual(response.data.actions, []);
    assert.match(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content, /实际校验日期/);
    assert.equal(f.db.prepare('SELECT last_inspected_on FROM products WHERE id=1').get().last_inspected_on, '');
  }
});

test('AI default inspection date stays fixed when confirming after midnight', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-05T23:59:00Z') });
  const f = await fixture(t); await f.permissions(['ai', 'products']);
  f.db.prepare("UPDATE products SET inspection_date='2000-01-01',inspection_interval=1,inspection_unit='month' WHERE id=1").run();
  f.use('preview_mark_inspected', { warehouse_id: 1, items: [{ product_id: 1 }] });
  const response = await f.chat(f.staff), action = response.data.actions[0];
  assert.ok(action, JSON.stringify(response.data));
  assert.equal(action.preview.last_inspected_on, '2030-03-05');
  t.mock.timers.setTime(new Date('2030-03-06T00:01:00Z').getTime());
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: action.id })).status, 200);
  const saved = f.db.prepare('SELECT inspection_date,last_inspected_on FROM products WHERE id=1').get();
  assert.equal(saved.last_inspected_on, '2030-03-05');
  assert.equal(saved.inspection_date, '2030-04-05');
});

test('AI sets an inspection reminder and marks inspections, rejecting non-products permissions and unreachable items', async t => {
  const f = await fixture(t); await f.permissions(['ai','products']);
  f.use('preview_inspection', { warehouse_id: 1, items: [{ product_id: 1, inspection_date: '2030-05-01', inspection_interval: 6, inspection_unit: 'month' }] });
  const r = await f.chat(f.staff);
  const a = r.data.actions[0]; assert.ok(a, JSON.stringify(f.calls.at(-1).body.messages));
  assert.equal(a.preview.items[0].after_date, '2030-05-01');
  assert.equal(f.db.prepare('SELECT inspection_date FROM products WHERE id=1').get().inspection_date, ''); // nothing written before confirmation
  const confirmed = await f.request(f.staff, '/ai/confirm', { action_id: a.id });
  assert.equal(confirmed.status, 200);
  assert.equal(f.db.prepare('SELECT inspection_date FROM products WHERE id=1').get().inspection_date, '2030-05-01');
  assert.deepEqual((await f.request(f.staff, '/ai/confirm', { action_id: a.id })).data, confirmed.data);
  await f.permissions(['ai']);
  f.use('preview_inspection', { warehouse_id: 1, items: [{ product_id: 1, inspection_date: '2031-01-01' }] });
  const denied = await f.chat(f.staff);
  assert.equal(denied.status, 403);
  assert.match(denied.data.error, /权限/);
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

test('quality permission grants chart tools without unrelated business writes or template editing', async t => {
  const f = await fixture(t);
  await f.permissions(['ai', 'quality']);
  const response = await f.chat(f.staff);
  assert.equal(response.status, 200);
  const call = f.calls.at(-1).body;
  assert.match(call.messages[0].content, /验收单模板可在桌面或移动 Web \/ PWA 的品质管理 → 模板配置中在线新建/);
  assert.match(call.messages[0].content, /已启用模板在线填写/);
  assert.match(call.messages[0].content, /字符串和数字字段可配置正则表达式及替换内容/);
  assert.match(call.messages[0].content, /在浏览器本地解析预览，确认保存时才上传文件并由服务端重新校验/);
  assert.match(call.messages[0].content, /解析问题可在单元格定位面板手动修正，修正仍须按模板校验/);
  assert.match(call.messages[0].content, /AI不能代替用户修正或确认验收数据/);
  assert.match(call.messages[0].content, /品质图表在桌面品质管理页面配置/);
  assert.match(call.messages[0].content, /合格率直接读取模板数字字段，不自动计算/);
  assert.match(call.messages[0].content, /模板仅配置一个工作表的规则，导入验收数据时可选择多个工作表复用同一套规则解析/);
  assert.match(call.messages[0].content, /整个模板含对象属性最多配置一个/);
  assert.match(call.messages[0].content, /95% 和 95 均解析为 95/);
  assert.match(call.messages[0].content, /日期时间统一为 YYYY-MM-DDTHH:mm:ss/);
  assert.match(call.messages[0].content, /false 不是空值/);
  assert.match(call.messages[0].content, /每个验收数据工作表可独立选择是否绑定物料/);
  assert.ok(!call.tools.some(tool => /publish|preview_orders|preview_import/.test(tool.function.name)));
  for(const name of ['quality_chart_templates','quality_chart_data','preview_quality_chart'])assert.ok(call.tools.some(tool=>tool.function.name===name));
  assert.match(call.messages[0].content, /不适用须由配置明确指定/);
  assert.match(call.messages[0].content, /核对结果与原报告判定独立/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_templates').get().n, 0);
});

async function qualityAiFixture(t,{save=true,extendedTypes=false,manyItems=false}={}) {
  const f=await fixture(t);
  const config=(await f.request(f.admin,'/settings/r2-backup')).data;
  assert.equal((await f.request(f.admin,'/settings/r2-backup',{...config,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'key',secret_key:'secret'},'PUT')).status,200);
  const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('检验');
  sheet.getCell('A1').value='2026-10-20';sheet.getCell('B1').value=95;sheet.getCell('C1').value='某某公司';
  sheet.getCell('A2').value='检验明细';
  for(const [i,value] of ['项目','数量','日期'].entries())sheet.getCell(3,i+1).value=value;
  const itemRows=manyItems?Array.from({length:25},(_,i)=>[`项目${i+1}`,i,'2026-10-20']):[['尺寸',2,'2026-10-20'],['外观',0,'2026-10-21']];
  for(const [i,values] of itemRows.entries())for(const [j,value] of values.entries())sheet.getCell(i+4,j+1).value=value;
  if(extendedTypes){sheet.getCell('A1').value=new Date('2026-10-20T23:59:59Z');sheet.getCell('A1').numFmt='yyyy/mm/dd hh:mm:ss';sheet.getCell('B1').value=0.95;sheet.getCell('B1').numFmt='0%';sheet.getCell('C1').value=false;}
  const bytes=Buffer.from(await excel.xlsx.writeBuffer());
  const definition={sheetName:'检验',fields:[{id:'date',name:'日期',type:'date',customKey:true,valueRegion:'A1'},
    {id:'rate',name:'合格率',type:'number',unit:'%',customKey:true,valueRegion:'B1'},
    {id:'company',name:'公司名',type:'string',customKey:true,valueRegion:'C1'},
    {id:'items',name:'检验明细',type:'object',labelRegion:'A2',propertyRegion:'A3:C3',valueRegion:'A4:C5',properties:[{id:'item',name:'项目',type:'string'},{id:'quantity',name:'数量',type:'number'},{id:'itemDate',name:'日期',type:'date'}]}]};
  if(extendedTypes){definition.fields[0].type='datetime';definition.fields[1].numberMode='percent';definition.fields[2].type='boolean';}
  if(manyItems)definition.fields[3].valueRegion='A4:C28';
  const body=new FormData();body.append('file',new Blob([bytes]),'检验.xlsx');body.append('name','品质检验模板');body.append('definition',JSON.stringify(definition));body.append('request_id',randomUUID());
  const created=await f.request(f.admin,'/quality/templates',body);assert.equal(created.status,200,JSON.stringify(created.data));
  const published=await f.request(f.admin,`/quality/templates/${created.data.id}/publish`,{version:created.data.version});assert.equal(published.status,200);
  const row=published.data;
  let acceptance;
  if(save){
    const form=new FormData();form.append('file',new Blob([bytes]),'检验.xlsx');form.append('name','十月检验');form.append('template_id',row.id);form.append('revision_id',row.published_revision);form.append('request_id',randomUUID());
    const saved=await f.request(f.admin,'/quality/acceptances',form);assert.equal(saved.status,200,JSON.stringify(saved.data));acceptance=saved.data;
  }
  const chart={name:'合格率趋势',revision_id:row.published_revision,config:{schemaVersion:1,kind:'ordinary',chartType:'line',objectId:null,x:{fieldId:'date'},dateField:{fieldId:'date'},bucket:'day',groupBy:null,metric:{aggregation:'avg',value:{fieldId:'rate'}}}};
  const toolResult=()=>JSON.parse(f.calls.at(-1).body.messages.filter(m=>m.role==='tool').at(-1).content);
  return {...f,row,chart,acceptance,toolResult};
}
test('AI recommends charts from scoped saved data and never saves during recommendation',async t=>{
  const f=await qualityAiFixture(t);
  f.use('quality_chart_templates',{});assert.equal((await f.chat(f.admin)).status,200);
  assert.equal(f.toolResult().templates[0].acceptance_count,1);
  f.use('quality_chart_data',{revision_id:f.row.published_revision});await f.chat(f.admin);
  const data=f.toolResult();assert.equal(data.acceptance_count,1);assert.ok(data.recommendations.some(r=>r.config.chartType==='line'));
  assert.ok(data.recommendations.some(r=>r.config.chartType==='pie'&&r.config.metric.aggregation==='count'));
  assert.equal(data.chart_types.pie,'饼图');
  assert.ok(data.recommendations.some(r=>r.config.objectId==='items'));
  assert.equal(data.scopes.find(s=>s.id==='items').records,2);
  assert.deepEqual(data.scopes[0].fields.find(f=>f.ref.fieldId==='rate').samples,['95']);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_charts').get().n,0);
  const other=(await f.request(f.admin,'/warehouses',{name:'图表隔离仓'})).data.id;
  f.use('quality_chart_templates',{});
  await f.request(f.admin,'/ai/chat',{message:'当前仓库模板'},'POST',other);assert.deepEqual(f.toolResult().templates,[]);
  f.use('quality_chart_data',{revision_id:f.row.published_revision});
  await f.request(f.admin,'/ai/chat',{message:'不可跨仓读模板'},'POST',other);assert.match(f.toolResult().error,/不属于当前仓库/);
});
test('AI chart previews confirm once and support every existing chart type and object scope',async t=>{
  const f=await qualityAiFixture(t);
  for(const chartType of ['line','bar','pie','table']){
    const chart=structuredClone(f.chart);chart.config.chartType=chartType;
    if(chartType==='table'){chart.config.objectId='items';chart.config.x={fieldId:'items',propertyId:'item'};chart.config.metric={aggregation:'sum',value:{fieldId:'items',propertyId:'quantity'}};}
    f.use('preview_quality_chart',chart);const response=await f.chat(f.admin);assert.equal(response.status,200);
    const action=response.data.actions[0];assert.equal(action.kind,'quality_chart');assert.equal(action.preview.template_name,'品质检验模板');
    assert.ok(action.preview.rows.length);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_charts').get().n,['line','bar','pie','table'].indexOf(chartType));
    const confirmed=await f.request(f.admin,'/ai/confirm',{action_id:action.id});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
    assert.deepEqual((await f.request(f.admin,'/ai/confirm',{action_id:action.id})).data,confirmed.data);
    const stored=(await f.request(f.admin,`/quality/charts/${confirmed.data.id}`)).data;
    assert.equal(stored.config.chartType,chartType);assert.equal(stored.source.revision_id,f.row.published_revision);
    assert.equal(stored.created_by_name,'owner');
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_charts').get().n,4);
});
test('AI pie previews retain all categories so preview truncation cannot change their shares',async t=>{
  const f=await qualityAiFixture(t,{manyItems:true});
  for(const chartType of ['pie','line']){
    f.use('preview_quality_chart',{...f.chart,config:{...f.chart.config,chartType,objectId:'items',x:{fieldId:'items',propertyId:'item'},metric:{aggregation:'count'}}});
    const response=await f.chat(f.admin);assert.equal(response.status,200);
    const preview=response.data.actions[0].preview;
    assert.equal(preview.total_groups,25);assert.equal(preview.rows.length,chartType==='pie'?25:20);
    if(chartType==='pie')assert.equal(preview.rows.reduce((sum,row)=>sum+row.value,0),25);
  }
});
test('AI chart tools enforce quality permission, write switch and schema validation',async t=>{
  const f=await qualityAiFixture(t);await f.permissions(['ai']);
  await f.chat(f.staff);assert.ok(!f.calls.at(-1).body.tools.some(t=>/quality_chart/.test(t.function.name)));
  f.use('quality_chart_data',{revision_id:f.row.published_revision});assert.equal((await f.chat(f.staff)).status,403);
  await f.permissions(['ai','quality']);
  for(const config of [{...f.chart.config,chartType:'radar'},{...f.chart.config,x:{fieldId:'invented'}},{...f.chart.config,metric:{aggregation:'avg',value:{fieldId:'company'}}}]){
    f.use('preview_quality_chart',{...f.chart,config});const response=await f.chat(f.staff);assert.deepEqual(response.data.actions,[]);assert.ok(f.toolResult().error);
  }
  await f.request(f.admin,'/settings/ai',{...f.settings,writes:false},'PUT');
  f.use('quality_chart_data',{revision_id:f.row.published_revision});await f.chat(f.staff);assert.ok(f.toolResult().recommendations.length);
  assert.ok(!f.calls.at(-1).body.tools.some(t=>t.function.name==='preview_quality_chart'));
  f.use('preview_quality_chart',f.chart);assert.equal((await f.chat(f.staff)).status,403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_charts').get().n,0);
});
test('AI chart confirmation rejects changed data, changed warehouse and superseded previews',async t=>{
  const f=await qualityAiFixture(t);
  f.use('preview_quality_chart',f.chart);let response=await f.chat(f.admin),action=response.data.actions[0];
  const other=(await f.request(f.admin,'/warehouses',{name:'确认隔离仓'})).data.id;
  assert.equal((await f.request(f.admin,'/ai/confirm',{action_id:action.id},'POST',other)).status,409);
  await f.request(f.admin,`/quality/acceptances/${f.acceptance.id}`,{},'DELETE');
  const stale=await f.request(f.admin,'/ai/confirm',{action_id:action.id});assert.equal(stale.status,409);assert.match(stale.data.error,/验收数据已变化/);
  f.use('preview_quality_chart',f.chart);response=await f.chat(f.admin);action=response.data.actions[0];assert.match(action.preview.warning,/没有/);
  await f.chat(f.admin,{conversation_id:response.data.conversation_id,message:'继续讨论'});
  assert.equal((await f.request(f.admin,'/ai/confirm',{action_id:action.id})).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_charts').get().n,0);
});
test('AI makes no data recommendations when only a template sample exists',async t=>{
  const f=await qualityAiFixture(t,{save:false});f.use('quality_chart_data',{revision_id:f.row.published_revision});await f.chat(f.admin);
  assert.equal(f.toolResult().acceptance_count,0);assert.deepEqual(f.toolResult().recommendations,[]);assert.match(f.toolResult().note,/没有已保存/);
});

test('AI material chart preview uses only the chosen material while saved rules remain reusable',async t=>{
  const f=await qualityAiFixture(t);
  const create=await f.request(f.admin,'/products',{name:'品质物料',barcode:'AI-QUALITY-MATERIAL',category:'未分类',unit:'件',cost:0,price:0,threshold:0});
  assert.equal(create.status,201,JSON.stringify(create.data));const productId=create.data.id;
  const bindings=[{sheetName:'检验',mode:'manual',product_id:productId,keyValue:'',product:{id:productId,name:'品质物料',barcode:'AI-QUALITY-MATERIAL',specification:'',unit:'件'}}];
  f.db.prepare('UPDATE quality_acceptances SET bindings=? WHERE id=?').run(JSON.stringify(bindings),f.acceptance.id);
  const args={...f.chart,config:{...f.chart.config,kind:'material'}};
  f.use('preview_quality_chart',args);let response=await f.chat(f.admin);
  assert.deepEqual(response.data.actions[0].preview.rows,[]);assert.match(response.data.actions[0].preview.warning,/未指定预览物料/);
  f.use('preview_quality_chart',{...args,product_id:productId});response=await f.chat(f.admin);
  const action=response.data.actions[0];assert.equal(action.preview.product.id,productId);assert.equal(action.preview.rows[0].value,95);
  const confirmed=await f.request(f.admin,'/ai/confirm',{action_id:action.id});assert.equal(confirmed.status,200);
  const stored=(await f.request(f.admin,`/quality/charts/${confirmed.data.id}`)).data;
  assert.equal(stored.config.kind,'material');assert.equal(stored.config.product_id,undefined);
  const data=await f.request(f.admin,`/quality/charts/${confirmed.data.id}/data?product_id=${productId}`);assert.equal(data.status,200);assert.equal(data.data.rows[0].value,95);
  const other=(await f.request(f.admin,'/warehouses',{name:'其他预览物料仓'})).data.id;
  const foreign=await f.request(f.admin,'/products',{name:'外仓物料',barcode:'FOREIGN-AI-MAT',category:'未分类',unit:'件',cost:0,price:0,threshold:0},'POST',other);assert.equal(foreign.status,201);
  f.use('preview_quality_chart',{...args,product_id:foreign.data.id});response=await f.chat(f.admin);assert.deepEqual(response.data.actions,[]);assert.match(f.toolResult().error,/不属于当前仓库/);
});


test('AI charts expose datetime and false boolean fields and preview percent values without recalculating rates',async t=>{
  const f=await qualityAiFixture(t,{extendedTypes:true});
  f.use('quality_chart_data',{revision_id:f.row.published_revision});assert.equal((await f.chat(f.admin)).status,200);
  const data=f.toolResult(),fields=data.scopes[0].fields;
  assert.equal(fields.find(field=>field.ref.fieldId==='date').type,'datetime');
  assert.deepEqual(fields.find(field=>field.ref.fieldId==='company').samples,['false']);assert.equal(fields.find(field=>field.ref.fieldId==='company').missing,0);
  assert.deepEqual(fields.find(field=>field.ref.fieldId==='rate').samples,['95']);assert.ok(data.recommendations.some(chart=>chart.config.x.fieldId==='date'));
  f.use('preview_quality_chart',{...f.chart,config:{...f.chart.config,groupBy:{fieldId:'company'}}});
  const preview=await f.chat(f.admin);assert.equal(preview.status,200);assert.deepEqual(preview.data.actions[0].preview.rows.map(row=>[row.x,row.series,row.value]),[['2026-10-20','false',95]]);
});
