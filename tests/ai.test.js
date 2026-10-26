import { readonlyPositionId, grantPosition } from './helpers/positions.js';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { inspectionToday, nextInspectionDate } from '../shared/inspection.js';

async function fixture(t, dbPath = ':memory:', historicalProduction = true) {
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
    const data = await res.json();
    // Existing production regressions exercise historical stock posting explicitly.
    if (historicalProduction && path === '/production-orders' && body !== undefined && res.status === 200) {
      db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(data.id);
      data.material_workflow = 0;
    }
    return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = (await request(null, '/auth/setup', { username: 'owner', password: 'Strong-password-123' })).cookie;
  const id = (await request(admin, '/users', { position_id: readonlyPositionId(db), username: 'staff', password: 'Strong-password-123' })).data.id;
  const staff = (await request(null, '/auth/login', { username: 'staff', password: 'Strong-password-123' })).cookie;
  const permissions = async values => {
    assert.equal((await grantPosition(db, (path, body, method) => request(admin, path, body, method), id, ['basic_view', ...values])).status, 200);
  };
  const settings = { enabled: true, writes: true, base_url: 'https://model.example/v1', model: 'test-model', secret: 'secret-test-key', daily_limit: 100 };
  assert.equal((await request(admin, '/settings/ai', settings, 'PUT')).status, 200);
  const use = (name, args) => replies.push({ content: null, tool_calls: [{ id: `call-${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const chat = (cookie, extra = {}) => request(cookie, '/ai/chat', { message: '请按要求操作', ...extra });
  const order = (type = 'in', quantity = 2, product_id = 1) => ({ warehouse_id: 1, type, partner: 'AI测试单位', items: [{ product_id, quantity, price: 12.5 }] });
  return { db, request, admin, staff, id, permissions, settings, calls, replies, use, chat, order };
}

async function imageAttachment(name = '物料照片.png') {
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#2563eb' } }).png().toBuffer();
  return { name, data_url: `data:image/png;base64,${bytes.toString('base64')}` };
}

test('AI follows interface language on each turn while preserving explicit user language requests and tool contracts', async t => {
  const f = await fixture(t);
  for (const [language, expected] of [['en', 'English'], ['vi', 'Tiếng Việt'], ['zh-CN', '简体中文']]) {
    assert.equal((await f.request(f.admin, '/auth/language', { language }, 'PATCH')).status, 200);
    assert.equal((await f.chat(f.admin, { message: '请用日语解释库存' })).status, 200);
    const prompt = f.calls.at(-1).body.messages[0].content;
    assert.ok(prompt.includes(`界面语言为${expected}`));
    assert.ok(prompt.includes('用户明确要求其他回复语言时，遵循用户要求'));
    assert.ok(!prompt.includes('助手，使用中文。'));
    assert.ok(f.calls.at(-1).body.tools.some(tool => tool.function.name === 'count_products'));
  }
});

test('AI images reach the model, survive tool calls and history, and remain private', async t => {
  const f = await fixture(t), picture = await imageAttachment();
  await f.permissions(['ai']);
  f.use('count_products', { warehouse_id: 1 });
  const response = await f.chat(f.staff, { message: '看看照片，对照库存', images: [picture] });
  assert.equal(response.status, 200);
  const user = response.data.messages.find(m => m.role === 'user');
  assert.equal(user.images.length, 1);
  assert.equal(user.images[0].name, picture.name);
  assert.match(user.images[0].data_url, /^data:image\/webp;base64,/);
  const outgoing = f.calls.at(-1).body.messages.find(m => m.role === 'user');
  assert.deepEqual(outgoing.content, [{ type: 'text', text: '看看照片，对照库存' }, { type: 'image_url', image_url: { url: user.images[0].data_url } }]);
  assert.equal(outgoing.images, undefined);
  assert.equal(outgoing.attachment, undefined);
  const id = response.data.conversation_id;
  const history = await f.request(f.staff, `/ai/conversations/${id}`);
  assert.deepEqual(history.data.messages[0].images, user.images);
  assert.equal((await f.request(f.admin, `/ai/conversations/${id}`)).status, 404);
  const list = await f.request(f.staff, '/ai/conversations');
  assert.equal(list.data[0].title, '看看照片，对照库存');
  assert.ok(!JSON.stringify(list.data).includes('data:image'));
  await f.chat(f.staff, { message: '继续分析上一张图', conversation_id: id });
  assert.deepEqual(f.calls.at(-1).body.messages.find(m => m.role === 'user').content, outgoing.content);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_actions').get().n, 0);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT detail FROM ai_audit').all()).includes('data:image'));
  await f.permissions([]);
  assert.equal((await f.request(f.staff, `/ai/conversations/${id}`)).status, 403);
});

test('AI supports image-only messages and combined spreadsheet/image attachments', async t => {
  const f = await fixture(t), picture = await imageAttachment();
  const imageOnly = await f.chat(f.admin, { message: '', images: [picture] });
  assert.equal(imageOnly.status, 200);
  assert.equal(imageOnly.data.messages[0].content, '请帮我分析上传的图片。');
  const combined = await f.chat(f.admin, { images: [picture], table: [['名称', '单位'], ['螺丝', '个']], table_name: '物料.csv' });
  assert.equal(combined.status, 200);
  assert.equal(combined.data.messages[0].attachment.name, '物料.csv');
  assert.equal(combined.data.messages[0].images.length, 1);
  assert.equal(f.calls.at(-1).body.messages.find(m => m.role === 'user').content[1].type, 'image_url');
  assert.equal((await f.chat(f.admin, { message: '', images: [] })).status, 400);
});

test('AI rejects invalid, external, oversized and excessive images before contacting the model', async t => {
  const f = await fixture(t), picture = await imageAttachment();
  for (const images of [null, {}, [null], Array(4).fill(picture), [{ ...picture, name: '' }],
    [{ ...picture, data_url: 'https://example.com/private.png' }],
    [{ ...picture, data_url: 'data:image/svg+xml;base64,PHN2Zy8+' }],
    [{ ...picture, data_url: 'data:image/png;base64,AAAA' }],
    [{ ...picture, data_url: picture.data_url.replace('image/png', 'image/jpeg') }],
    [{ ...picture, data_url: `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}` }]]) {
    assert.equal((await f.chat(f.admin, { images })).status, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_conversations').get().n, 0);
  let id;
  for (let i = 0; i < 4; i++) {
    const response = await f.chat(f.admin, { images: Array(3).fill(picture), ...(id ? { conversation_id: id } : {}) });
    assert.equal(response.status, 200); id = response.data.conversation_id;
  }
  const count = f.calls.length;
  const overflow = await f.chat(f.admin, { images: [picture], conversation_id: id });
  assert.equal(overflow.status, 400);
  assert.match(overflow.data.error, /12.*新对话/);
  assert.equal(f.calls.length, count);
  assert.equal((await f.chat(f.admin, { conversation_id: id, message: '只问文字' })).status, 200);
});

test('AI accepts bounded image requests above the old JSON limit and strips image metadata', async t => {
  const f = await fixture(t);
  const buffer = await sharp(randomBytes(1000 * 800 * 3), { raw: { width: 1000, height: 800, channels: 3 } }).jpeg({ quality: 75 }).toBuffer();
  const picture = { name: 'photo.jpg', data_url: `data:image/jpeg;base64,${buffer.toString('base64')}` };
  assert.ok(JSON.stringify(Array(3).fill(picture)).length > 1024 * 1024);
  const response = await f.chat(f.admin, { images: Array(3).fill(picture) });
  assert.equal(response.status, 200);
  assert.equal(response.data.messages[0].images.length, 3);
  const large = await sharp({ create: { width: 3000, height: 1800, channels: 3, background: '#fff' } }).withMetadata().png().toBuffer();
  const normalized = await f.chat(f.admin, { images: [{ name: 'wide.png', data_url: `data:image/png;base64,${large.toString('base64')}` }] });
  assert.equal(normalized.status, 200);
  const metadata = await sharp(Buffer.from(normalized.data.messages[0].images[0].data_url.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.width, 2048);
  assert.equal(metadata.exif, undefined);
});

test('AI preserves images on provider rejection and explains the model requirement', async t => {
  const f = await fixture(t);
  f.replies.push(() => new Response(JSON.stringify({ error: { message: 'This model does not support image input' } }), { status: 400 }));
  const response = await f.chat(f.admin, { images: [await imageAttachment()] });
  assert.equal(response.status, 200);
  assert.match(response.data.error, /模型及接口支持图片输入/);
  const history = await f.request(f.admin, `/ai/conversations/${response.data.conversation_id}`);
  assert.equal(history.data.messages[0].images.length, 1);
});

test('AI checks quota before decoding more images and releases the lock after validation errors', async t => {
  const f = await fixture(t);
  assert.equal((await f.chat(f.admin, { images: [null] })).status, 400);
  assert.equal((await f.request(f.admin, '/settings/ai', { ...f.settings, daily_limit: 1 }, 'PUT')).status, 200);
  assert.equal((await f.chat(f.admin, { images: [await imageAttachment()] })).status, 200);
  const rejected = await f.chat(f.admin, { images: [null] });
  assert.equal(rejected.status, 429);
  assert.equal(f.calls.length, 1);
});

for (const lossMethod of ['internal', 'external']) test(`${lossMethod} BOM tools require independent permission, read actual single-level recipes and never write inventory`, async t => {
  const f = await fixture(t);
  const parent = f.db.prepare('SELECT * FROM products WHERE id=1').get(), material = f.db.prepare('SELECT * FROM products WHERE id=2').get();
  const saved = await f.request(f.admin, '/boms', { request_id: randomUUID(), name: 'AI用料表', product_id: parent.id, loss_method: lossMethod,
    base_quantity: 10, base_unit: parent.unit, note: '', enabled: 1,
    items: [{ product_id: material.id, quantity: 0.025, quantity_fraction: '1/40', loss_rate: 20, unit: material.unit, note: '实际配方' }],
    scraps: [{ product_id: 3, method: 'output', source_product_id: null, quantity: 2, unit: f.db.prepare('SELECT unit FROM products WHERE id=3').get().unit, note: '回收' }] });
  assert.equal(saved.status, 200);
  const id = saved.data.id;
  await f.permissions(['ai']);
  await f.chat(f.staff);
  assert.ok(!f.calls.at(-1).body.tools.some(tool => /^(search_boms|get_bom|calculate_bom)$/.test(tool.function.name)));
  f.use('get_bom', { bom_id: id }); assert.equal((await f.chat(f.staff)).status, 403);
  await f.permissions(['ai', 'bom']);
  const before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  f.use('search_boms', { query: 'AI用料' });
  assert.equal((await f.chat(f.staff)).status, 200);
  let result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.total, 1); assert.equal(result.boms[0].id, id);
  for (const name of ['search_boms', 'get_bom', 'calculate_bom'])
    assert.ok(f.calls.at(-1).body.tools.some(tool => tool.function.name === name));
  f.use('get_bom', { bom_id: id }); await f.chat(f.staff);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.scraps[0].quantity, 2); assert.equal(result.scraps[0].method, 'output');
  assert.equal(result.loss_method, lossMethod); assert.equal(result.items[0].loss_rate, 20); assert.equal(result.items[0].quantity, 0.025); assert.equal(result.items[0].quantity_fraction, '1/40'); assert.equal(result.items[0].product.id, material.id);
  assert.ok(!JSON.stringify(result).includes('inventory_value_cents'));
  f.use('calculate_bom', { bom_id: id, production_quantity: 2 });
  const calculation = await f.chat(f.staff);
  assert.equal(calculation.status, 200); assert.deepEqual(calculation.data.actions, []);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.scraps[0].planned_quantity, 0.4);
  assert.equal(result.loss_method, lossMethod); assert.equal(result.rows[0].required, lossMethod === 'internal' ? 0.0063 : 0.006); assert.equal(result.rows[0].quantity_fraction, '1/40'); assert.equal(result.rows[0].stock, material.stock);
  assert.match(f.calls.at(-1).body.messages.find(message => message.role === 'system').content, /展示用量时优先使用原分数/);
  assert.ok(!JSON.stringify(result).includes('cost'));
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_actions').get().n, 0);
  f.use('calculate_bom', { bom_id: id, production_quantity: 0 }); await f.chat(f.staff);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).error, /生产数量/);
  const remote = (await f.request(f.admin, '/warehouses', { name: 'AI BOM空仓' })).data.id;
  f.use('get_bom', { bom_id: id });
  await f.request(f.staff, '/ai/chat', { message: '查询BOM' }, 'POST', remote);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).error, /当前仓库/);
  // Queries remain available while AI write previews are disabled.
  assert.equal((await f.request(f.admin, '/settings/ai', { ...f.settings, writes: false }, 'PUT')).status, 200);
  f.use('get_bom', { bom_id: id }); assert.equal((await f.chat(f.staff)).status, 200);
  assert.match(f.calls.at(-1).body.messages.find(message => message.role === 'system').content, /AI不创建、修改或删除BOM/);
  assert.equal((await f.request(f.admin, `/boms/${id}/delete`, { request_id: randomUUID(), version: saved.data.version })).status, 200);
  f.use('search_boms', { query: 'AI用料' }); await f.chat(f.staff);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.total, 0);
  f.use('get_bom', { bom_id: id }); await f.chat(f.staff);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).error, /BOM不存在/);
});

for (const lossMethod of ['internal', 'external']) test(`${lossMethod} production AI queries require production permission, use saved snapshots, hide costs and cannot mutate stock`, async t => {
  const f = await fixture(t);
  const parent = f.db.prepare('SELECT * FROM products WHERE id=1').get(), material = f.db.prepare('SELECT * FROM products WHERE id=2').get();
  const bom = (await f.request(f.admin, '/boms', { request_id: randomUUID(), name: 'AI生产配方', product_id: parent.id, loss_method: lossMethod,
    base_quantity: 1, base_unit: parent.unit, note: '', enabled: 1,
    items: [{ product_id: material.id, quantity: 0.333334, quantity_fraction: '1/3', loss_rate: 20, unit: material.unit, note: '' }],
    scraps: [{ product_id: 3, method: 'output', source_product_id: null, quantity: 0.5, unit: f.db.prepare('SELECT unit FROM products WHERE id=3').get().unit, note: '' }] })).data;
  const created = await f.request(f.admin, '/production-orders', { request_id: randomUUID(), bom_id: bom.id, bom_version: bom.version, planned_quantity: 3, note: '真实生产草稿' });
  assert.equal(created.status, 200); const order = created.data;
  await f.permissions(['ai', 'bom']);
  await f.chat(f.staff);
  assert.ok(!f.calls.at(-1).body.tools.some(tool => /^(search_production_orders|get_production_order)$/.test(tool.function.name)));
  f.use('get_production_order', { production_id: order.id }); assert.equal((await f.chat(f.staff)).status, 403);
  await f.permissions(['ai', 'production', 'finance']);
  assert.equal((await f.request(f.admin, '/settings/ai', { ...f.settings, writes: false }, 'PUT')).status, 200);
  const before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  f.use('search_production_orders', { query: order.number, status: 'draft' });
  const response = await f.chat(f.staff); assert.equal(response.status, 200); assert.deepEqual(response.data.actions, []);
  let result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.total, 1); assert.equal(result.orders[0].planned_quantity, 3);
  for (const name of ['search_production_orders', 'get_production_order']) assert.ok(f.calls.at(-1).body.tools.some(tool => tool.function.name === name));
  assert.ok(!f.calls.at(-1).body.tools.some(tool => /(?:preview|complete|void).*production/.test(tool.function.name)));
  f.use('get_production_order', { production_id: order.id }); await f.chat(f.staff);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.scraps[0].planned_quantity, 1.5); assert.equal(result.scraps[0].actual_quantity, null);
  assert.equal(result.items[0].standard_quantity, null);
  assert.equal(result.loss_method, lossMethod); assert.equal(result.items[0].planned_quantity, lossMethod === 'internal' ? 1.25 : 1.2); assert.equal(result.items[0].base_quantity_fraction, '1/3'); assert.equal(result.bom_version, bom.version);
  assert.ok(!/cost|inventory_value|price/.test(JSON.stringify(result)));
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_actions').get().n, 0);
  const prompt = f.calls.at(-1).body.messages.find(message => message.role === 'system').content;
  assert.match(prompt, /废料产出规则/);
  assert.match(prompt, /internal 内扣法按投入量计算/);
  assert.match(prompt, /external 外包法按净用量计算/);
  assert.match(prompt, /生产单保存自己的损耗率快照/);
  assert.match(prompt, /variance_rate是以标准耗料为分母的百分数/);
  assert.match(prompt, /不按计划产量或当前BOM重算/);
  assert.match(prompt, /AI不创建、修改、完工、作废或删除生产单/);
  assert.match(prompt, /删除会清理耗料、废料、批次、配方快照和相关物料操作历史，不再次变动库存和成本/);
  assert.match(prompt, /绝不能用采购入库、销售出库、盘点等工具代替生产记账/);
  const completed = await f.request(f.admin, `/production-orders/${order.id}/complete`, { request_id: randomUUID(), version: order.version,
    completed_quantity: 3, items: [{ product_id: material.id, quantity: 1.2, variance_reason: '调机耗料' }], scraps: [{ product_id: 3, quantity: 1.4, disposition: 'stock' }] });
  assert.equal(completed.status, 200);
  const afterCompletion = f.db.prepare('SELECT * FROM products ORDER BY id').all();
  f.use('get_production_order', { production_id: order.id }); await f.chat(f.staff);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.items[0].loss_rate, 20); assert.equal(result.loss_method, lossMethod); assert.equal(result.items[0].standard_quantity, lossMethod === 'internal' ? 1.25 : 1.2); assert.equal(result.items[0].variance_quantity, lossMethod === 'internal' ? -0.05 : 0);
  assert.equal(result.items[0].variance_rate, lossMethod === 'internal' ? -4 : 0); assert.equal(result.items[0].variance_reason, '调机耗料');
  assert.equal(result.scraps[0].expected_quantity, 1.5); assert.equal(result.scraps[0].actual_quantity, 1.4); assert.equal(result.scraps[0].disposition, 'stock');
  assert.ok(!/cost|inventory_value|price/.test(JSON.stringify(result)));
  assert.deepEqual(f.db.prepare('SELECT * FROM products ORDER BY id').all(), afterCompletion);

  f.use('search_production_orders', { status: 'madeup' }); await f.chat(f.staff);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).error, /筛选/);
  const remote = (await f.request(f.admin, '/warehouses', { name: 'AI生产空仓' })).data.id;
  f.use('get_production_order', { production_id: order.id });
  await f.request(f.staff, '/ai/chat', { message: '查询生产单' }, 'POST', remote);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).error, /当前仓库/);
  const voided = await f.request(f.admin, `/production-orders/${order.id}/void`, { request_id: randomUUID(), version: completed.data.version, reason: '删除前作废' });
  assert.equal(voided.status, 200);
  assert.equal((await f.request(f.admin, `/production-orders/${order.id}/delete`, { request_id: randomUUID(), version: voided.data.version })).status, 200);
  f.use('search_production_orders', { query: order.number }); await f.chat(f.staff);
  assert.equal(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).total, 0);
  f.use('get_production_order', { production_id: order.id }); await f.chat(f.staff);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content).error, /生产单不存在/);
});

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
  // Windows keeps SQLite files locked until both handles close; hooks run in registration order.
  t.after(() => rmSync(directory, { recursive: true, force: true }));
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
test('saved AI chart preview display follows current language without changing stored business fields or payload', async t => {
  const f = await qualityAiFixture(t);
  f.use('preview_quality_chart', { ...f.chart, name: '保留图表名', config: { ...f.chart.config, kind: 'material' } });
  const response = await f.chat(f.admin);
  const action = response.data.actions[0];
  const before = f.db.prepare('SELECT payload,preview FROM ai_actions WHERE id=?').get(action.id);
  await f.request(f.admin, '/auth/language', { language: 'en' }, 'PATCH');
  const english = await f.request(f.admin, `/ai/conversations/${response.data.conversation_id}`);
  assert.match(english.data.actions[0].preview.warning, /No preview material/);
  assert.equal(english.data.actions[0].preview.name, '保留图表名');
  assert.equal(english.data.actions[0].preview.object_label, 'One record per worksheet');
  assert.equal(english.data.actions[0].preview.x_label, '日期');
  assert.equal(english.data.messages[0].content, response.data.messages[0].content);
  await f.request(f.admin, '/auth/language', { language: 'vi' }, 'PATCH');
  const vietnamese = await f.request(f.admin, `/ai/conversations/${response.data.conversation_id}`);
  assert.match(vietnamese.data.actions[0].preview.warning, /Chưa chọn vật tư/);
  assert.deepEqual(f.db.prepare('SELECT payload,preview FROM ai_actions WHERE id=?').get(action.id), before);
});

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

test('AI reads awaiting warehouse approval and issued material balances without costs or production writes', async t => {
  const f = await fixture(t, ':memory:', false);
  const [parent, material] = f.db.prepare('SELECT * FROM products ORDER BY id LIMIT 2').all();
  const post = async (path, body) => { const response = await f.request(f.admin, path, { request_id: randomUUID(), ...body }); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data; };
  const bom = await post('/boms', { product_id: parent.id, name: '领料配方', base_quantity: 1, base_unit: parent.unit, note: '', enabled: 1, items: [{ product_id: material.id, quantity: 1, unit: material.unit, note: '' }] });
  let order = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 2, note: '' });
  order = await post(`/production-orders/${order.id}/start`, { version: order.version });
  await f.permissions(['ai', 'production', 'finance']);
  f.use('search_production_orders', { status: 'awaiting_materials' }); await f.chat(f.staff);
  const call = f.calls.at(-1).body;
  assert.ok(call.tools.find(tool => tool.function.name === 'search_production_orders').function.parameters.properties.status.enum.includes('awaiting_materials'));
  assert.equal(JSON.parse(call.messages.find(message => message.role === 'tool').content).orders[0].status, 'awaiting_materials');
  assert.match(call.messages.find(message => message.role === 'system').content, /领料.*扣.*库存/);
  await post(`/production-material-documents/${order.material_documents[0].id}/confirm`, { version: order.material_documents[0].version });
  f.use('get_production_order', { production_id: order.id }); await f.chat(f.staff);
  const result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.items[0].issued_quantity, 2); assert.equal(result.items[0].available_quantity, 2);
  assert.equal(/cost_cents|inventory_value|price/.test(JSON.stringify(result)), false);
  assert.ok(!call.tools.some(tool => /(?:confirm|start|complete|request).*production|production.*(?:confirm|start|complete|request)/.test(tool.function.name)));
  order = await post(`/production-orders/${order.id}/complete`, {version:result.version,completed_quantity:1,finish_order:false,items:[{product_id:material.id,quantity:1}]});
  f.use('get_production_order', {production_id:order.id}); await f.chat(f.staff);
  let receiptRead=JSON.parse(f.calls.at(-1).body.messages.find(message=>message.role==='tool').content);
  assert.equal(receiptRead.received_quantity,0); assert.equal(receiptRead.pending_receipt_quantity,1);
  assert.equal(receiptRead.receipt_documents[0].status,'pending'); assert.equal(/cost_cents|inventory_value|price/.test(JSON.stringify(receiptRead)),false);
  const receipt=order.receipt_documents[0]; await post(`/production-receipts/${receipt.id}/confirm`,{version:receipt.version});
  f.use('get_production_order', {production_id:order.id}); await f.chat(f.staff);
  receiptRead=JSON.parse(f.calls.at(-1).body.messages.find(message=>message.role==='tool').content);
  assert.equal(receiptRead.received_quantity,1); assert.equal(receiptRead.pending_receipt_quantity,0);
  assert.equal(receiptRead.batches[0].receipt_status,'confirmed'); assert.equal(/cost_cents|inventory_value|price/.test(JSON.stringify(receiptRead)),false);
});

test('AI distinguishes partial production, reports active batch facts and hides all nested batch costs', async t => {
  const f = await fixture(t), material = f.db.prepare('SELECT * FROM products WHERE id=2').get(), parent = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  const post = async (path, body) => {
    const result = await f.request(f.admin, path, { request_id: randomUUID(), ...body });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
  };
  const bom = await post('/boms', { product_id: parent.id, name: '分批生产配方', base_quantity: 1, base_unit: parent.unit, note: '', enabled: 1,
    items: [{ product_id: material.id, quantity: 1, loss_rate: 20, unit: material.unit, note: '' }] });
  const order = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '' });
  const partial = await post(`/production-orders/${order.id}/complete`, { version: order.version, completed_quantity: 2, finish_order: false,
    items: [{ product_id: material.id, quantity: 3, variance_reason: '首批调机' }], note: '首批' });
  await f.permissions(['ai', 'production', 'finance']);
  f.use('search_production_orders', { status: 'in_progress' }); await f.chat(f.staff);
  let result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.total, 1); assert.equal(result.orders[0].status, 'in_progress'); assert.equal(result.orders[0].completed_quantity, 2);
  assert.ok(f.calls.at(-1).body.tools.find(tool => tool.function.name === 'search_production_orders').function.parameters.properties.status.enum.includes('in_progress'));
  f.use('get_production_order', { production_id: order.id }); await f.chat(f.staff);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.batches[0].items[0].standard_quantity, 2.5); assert.equal(result.batches[0].items[0].variance_quantity, 0.5);
  assert.equal(result.batches[0].note, '首批'); assert.equal(/cost|inventory_value|price/.test(JSON.stringify(result)), false);
  assert.equal(result.received_quantity,0); assert.equal(result.pending_receipt_quantity,2);
  assert.equal(result.receipt_documents[0].status,'pending'); assert.equal(result.batches[0].receipt_required,1);
  assert.equal(result.batches[0].receipt_status,'pending');
  assert.match(f.calls.at(-1).body.messages.find(message=>message.role==='system').content,/receipt_documents待批准成品入库单/);
  assert.ok(!f.calls.at(-1).body.tools.some(tool=>/production.*(?:confirm|receipt)|(?:confirm|receipt).*production/.test(tool.function.name)));
  assert.match(f.calls.at(-1).body.messages.find(message => message.role === 'system').content, /in_progress表示已有有效批次/);
  const reversed = await post(`/production-orders/${order.id}/batches/${partial.batches[0].id}/void`, { version: partial.version, reason: '更正首批' });
  assert.equal(reversed.status, 'draft');
  f.use('get_production_order', { production_id: order.id }); await f.chat(f.staff);
  result = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(result.completed_quantity, null); assert.equal(result.batches[0].status, 'void'); assert.equal(result.items[0].standard_quantity, null);
});

test('AI queries explicit alternate and multilevel recipes, exposes snapshot sources without writes or financial values', async t => {
  const f = await fixture(t, ':memory:', false);
  const [parent, intermediate, raw] = f.db.prepare('SELECT * FROM products ORDER BY id LIMIT 3').all();
  f.db.prepare('UPDATE products SET production_type=? WHERE id=?').run('半成品', intermediate.id);
  f.db.prepare('UPDATE products SET production_type=? WHERE id=?').run('原料', raw.id);
  const save = async body => {
    const response = await f.request(f.admin, '/boms', { request_id: randomUUID(), base_quantity: 1, note: '', enabled: 1, ...body });
    assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data;
  };
  const child = await save({ name: 'AI多配方标准', product_id: intermediate.id, base_unit: intermediate.unit,
    items: [{ product_id: raw.id, quantity: 3, unit: raw.unit, note: '' }] });
  await save({ name: 'AI多配方替代', product_id: intermediate.id, base_unit: intermediate.unit,
    items: [{ product_id: raw.id, quantity: 6, unit: raw.unit, note: '' }] });
  const root = await save({ name: 'AI多层根配方', product_id: parent.id, base_unit: parent.unit,
    items: [{ product_id: intermediate.id, quantity: 1, unit: intermediate.unit, note: '', usage_mode: 'explode', child_bom_id: child.id }] });
  const result = () => JSON.parse(f.calls.at(-1).body.messages.filter(message => message.role === 'tool').at(-1).content);
  await f.permissions(['ai', 'bom', 'production']);
  f.use('search_boms', { query: 'AI多配方' }); await f.chat(f.staff);
  assert.equal(result().total, 2); assert.deepEqual(new Set(result().boms.map(row => row.name)), new Set(['AI多配方标准','AI多配方替代']));
  f.use('get_bom', { bom_id: root.id }); await f.chat(f.staff);
  assert.equal(result().items[0].child_bom_id, child.id); assert.equal(result().items[0].usage_mode, 'explode');
  f.use('calculate_bom', { bom_id: root.id, production_quantity: 2 });
  const calculation = await f.chat(f.staff); assert.deepEqual(calculation.data.actions, []);
  assert.equal(result().rows[0].product_id, raw.id); assert.equal(result().rows[0].required, 6); assert.equal(result().nodes[1].bom_id, child.id);
  assert.equal(result().nodes[0].current_production_type, '半成品');
  assert.equal(result().nodes[1].current_production_type, '原料');
  assert.match(f.calls.at(-1).body.tools.find(tool => tool.function.name === 'calculate_bom').function.description, /生产类型不决定供料方式/);
  const plan = result();
  const created = await f.request(f.admin, '/production-orders', { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, bom_id: root.id, bom_version: root.version, planned_quantity: 2, note: '', structure_token: plan.structure_token });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  f.db.prepare('UPDATE products SET production_type=? WHERE id=?').run('成品', raw.id);
  f.db.prepare('UPDATE products SET stock=100,inventory_value_cents=10000 WHERE id=?').run(raw.id);
  const command = async (path, body) => {
    const response = await f.request(f.admin, path, { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, ...body });
    assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data;
  };
  const started = await command(`/production-orders/${created.data.id}/start`, { version: created.data.version });
  const doc = started.material_documents[0];
  await command(`/production-material-documents/${doc.id}/confirm`, { version: doc.version });
  const ready = (await f.request(f.admin, `/production-orders/${created.data.id}`)).data;
  await command(`/production-orders/${created.data.id}/stages/complete`, { version: ready.version, path: '1', completed_quantity: 1,
    items: [{ path: '1.1', quantity: 3 }], scraps: [], note: '', finish_order: false });
  f.use('get_production_order', { production_id: created.data.id }); await f.chat(f.staff);
  assert.equal(result().nodes[1].quantity, 3); assert.equal(result().items[0].base_quantity, null);
  assert.equal(result().nodes[1].current_production_type, '成品');
  assert.match(f.calls.at(-1).body.tools.find(tool => tool.function.name === 'get_production_order').function.description, /不是保存时类型/);
  assert.equal(result().stage_workflow, 1);
  assert.equal(result().stages.find(stage => stage.path === '1').available_quantity, 1);
  assert.equal(result().items[0].direct_consumed_quantity, 3);
  assert.equal(result().completed_quantity || 0, 0);
  assert.ok(!JSON.stringify(result()).includes('cost_cents'));
  const system = f.calls.at(-1).body.messages.find(message => message.role === 'system').content;
  assert.match(system, /多份匹配时须让用户明确选择/); assert.match(system, /不抵扣中间半成品库存/);
  assert.match(system, /分层生产单/);
  assert.match(system, /不重复扣/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_actions').get().n, 0);
});

test('AI production type mapping previews, confirms and rejects invalid import types', async t => {
  const f = await fixture(t);
  const mapping = { name: 0, unit: 1, production_type: 2 };
  const table = [['名称', '单位', '生产类型'], ['AI成品', '个', '成品'], ['AI半成品', '个', '半成品'], ['AI原料', '个', '原料'], ['AI未设置', '个', '']];
  f.use('preview_import', { warehouse_id: 1, mapping });
  const result = await f.chat(f.admin, { table });
  assert.equal(result.status, 200);
  const action = result.data.actions[0];
  assert.deepEqual(action.preview.rows.map(row => row.production_type), ['成品', '半成品', '原料', '']);
  assert.equal(action.preview.mapping.production_type, '生产类型');
  assert.ok(f.calls.at(-1).body.tools.find(tool => tool.function.name === 'preview_import').function.parameters.properties.mapping.properties.production_type);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: action.id })).status, 200);
  for (const [name, , type] of table.slice(1)) assert.equal(f.db.prepare('SELECT production_type FROM products WHERE name=?').get(name).production_type, type);
  f.use('preview_import', { warehouse_id: 1, mapping });
  const invalid = await f.chat(f.admin, { table: [table[0], ['AI非法类型', '个', '其他']] });
  assert.deepEqual(invalid.data.actions, []);
  assert.match(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content, /生产类型/);
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1 } });
  const omitted = await f.chat(f.admin, { table: [['名称', '单位'], ['AI旧表格', '个']] });
  assert.ok(omitted.data.actions[0].preview.defaults.includes('production_type'));
  assert.equal(omitted.data.actions[0].preview.rows[0].production_type, '');
});

test('AI unit rounding import and order previews show the exact quantities that confirmation posts', async t => {
  const f = await fixture(t);
  const table = [['名称', '单位', '单位是否取整', '期初数量'], ['纸箱整件', '个', '是', '4.1']];
  f.use('preview_import', { warehouse_id: 1, mapping: { name: 0, unit: 1, unit_round_up: 2, stock: 3 } });
  const imported = await f.chat(f.admin, { table });
  const action = imported.data.actions[0];
  assert.equal(action.preview.rows[0].unit_round_up, 1);
  assert.equal(action.preview.rows[0].stock, 5);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: action.id })).status, 200);
  const product = f.db.prepare("SELECT * FROM products WHERE name='纸箱整件'").get();
  assert.equal(product.stock, 5);
  f.use('preview_orders', { orders: [f.order('out', 1.1, product.id)] });
  const ordered = await f.chat(f.admin);
  const orderAction = ordered.data.actions[0];
  assert.equal(orderAction.preview.orders[0].items[0].quantity, 2);
  assert.equal(orderAction.preview.orders[0].items[0].after_stock, 3);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: orderAction.id })).status, 200);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, 3);
});

for (const change of ['same-permission position switch', 'position permission edit']) test(`AI invalidates conversation and pending action after ${change}`, async t => {
  const f = await fixture(t);
  await f.permissions(['ai', 'purchase']);
  f.use('preview_orders', { orders: [f.order()] });
  const preview = await f.chat(f.staff);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.actions.length, 1);
  const action = preview.data.actions[0];
  const count = f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  if (change === 'same-permission position switch') {
    await f.permissions(['ai', 'purchase']);
  } else {
    const user = (await f.request(f.admin, '/users')).data.find(user => user.id === f.id);
    const position = (await f.request(f.admin, '/positions')).data.find(position => position.id === user.position_id);
    assert.equal((await f.request(f.admin, `/positions/${position.id}`, { name: position.name, description: position.description, permissions: ['ai'], version: position.version }, 'PUT')).status, 200);
  }
  assert.equal((await f.request(f.staff, `/ai/conversations/${preview.data.conversation_id}`)).status, 403);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: action.id })).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, count);
  assert.deepEqual((await f.request(f.staff, '/ai/conversations')).data, []);
});

test('AI registration production tools are offered and group changes invalidate conversation', async t => {
  const f = await fixture(t);
  await f.permissions(['ai', 'production_register']);
  assert.equal((await f.chat(f.staff)).status, 200);
  assert.ok(f.calls.at(-1).body.tools.some(tool => tool.function.name === 'search_production_orders'));
  const group = (await f.request(f.admin, '/production-groups', {name:'AI group',description:''})).data;
  const other = (await f.request(f.admin, '/production-groups', {name:'Other group',description:''})).data;
  const staff = (await f.request(f.admin, '/users')).data.find(user=>user.id===f.id);
  assert.equal((await f.request(f.admin, `/users/${f.id}/production-group`, {production_group_id:group.id,version:staff.permissions_version}, 'PUT')).status,200);
  const product=f.db.prepare('SELECT * FROM products WHERE id=1').get(), material=f.db.prepare('SELECT * FROM products WHERE id=2').get();
  const bom=(await f.request(f.admin,'/boms',{request_id:randomUUID(),name:'Grouped recipe',product_id:product.id,base_quantity:1,base_unit:product.unit,note:'',enabled:1,items:[{product_id:material.id,quantity:1,unit:material.unit,note:''}]})).data;
  const orders=[];
  for(const g of [group,other]) {
    const created=await f.request(f.admin,'/production-orders',{request_id:randomUUID(),bom_id:bom.id,bom_version:bom.version,planned_quantity:1,note:'',production_group_id:g.id});
    assert.equal(created.status,200); orders.push(created.data);
  }
  f.use('search_production_orders',{}); const response=await f.chat(f.staff); assert.equal(response.status,200);
  const result=JSON.parse(f.calls.at(-1).body.messages.find(message=>message.role==='tool').content);
  assert.deepEqual(result.orders.map(order=>order.id),[orders[0].id]);
  f.use('get_production_order',{production_id:orders[1].id}); await f.chat(f.staff);
  assert.ok(JSON.parse(f.calls.at(-1).body.messages.find(message=>message.role==='tool').content).error);
  const completed=await f.request(f.admin,`/production-orders/${orders[1].id}/complete`,{request_id:randomUUID(),version:orders[1].version,completed_quantity:1,finish_order:false,items:[{product_id:material.id,quantity:1}],scraps:[]});
  assert.equal(completed.status,200);
  await f.permissions(['ai','production_register','products']);
  const history=await f.request(f.staff,`/products/${product.id}/history`);
  assert.equal(history.status,200);
  assert.ok(!history.data.records.some(record=>record.kind==='production'));
  // Digest detects membership changes even if the permission version is accidentally unchanged.
  f.db.prepare('UPDATE users SET production_group_id=? WHERE id=?').run(other.id,f.id);
  assert.equal((await f.request(f.staff,`/ai/conversations/${response.data.conversation_id}`)).status,403);
});

test('AI basic queries require basic page permission even when the model forces a hidden tool', async t => {
  const f = await fixture(t);
  await grantPosition(f.db, (path, body, method) => f.request(f.admin, path, body, method), f.id, ['ai']);
  f.use('search_products', { warehouse_id: 1, query: '' });
  const response = await f.chat(f.staff);
  assert.equal(response.status, 403);
  const offered = (f.calls[0].tools || []).map(tool => tool.function.name);
  for (const name of ['search_products', 'count_products', 'search_contacts', 'compare_stock', 'search_orders', 'categories', 'search_inspections'])
    assert.equal(offered.includes(name), false, name);
  assert.match(response.data.error, /没有此业务操作的权限/);
  assert.equal(f.calls.length, 1);
});

test('AI reads process routes and operation snapshots without granting route writes or exposing costs', async t => {
  const f = await fixture(t, ':memory:', false);
  const graph = { nodes: [{id:'cut',name:'切割',note:'按图切割',x:24,y:24},{id:'out',name:'检验',note:'',x:244,y:24}], edges:[{from:'cut',to:'out'}] };
  const route = (await f.request(f.admin,'/process-routes',{request_id:randomUUID(),name:'AI工艺路线',note:'',enabled:1,graph})).data;
  assert.ok(route.id);
  f.db.prepare('UPDATE products SET default_route_id=? WHERE id=1').run(route.id);
  const parent=f.db.prepare('SELECT * FROM products WHERE id=1').get(), raw=f.db.prepare('SELECT * FROM products WHERE id=2').get();
  const bom=(await f.request(f.admin,'/boms',{request_id:randomUUID(),name:'工序配方',product_id:parent.id,base_quantity:1,base_unit:parent.unit,note:'',enabled:1,items:[{product_id:raw.id,quantity:1,unit:raw.unit,note:''}]})).data;
  const order=(await f.request(f.admin,'/production-orders',{request_id:randomUUID(),bom_id:bom.id,bom_version:bom.version,planned_quantity:2,note:''})).data;
  await f.permissions(['ai','bom','production']);
  f.use('search_process_routes',{query:'AI工艺'});assert.equal((await f.chat(f.staff)).status,200);
  let result=JSON.parse(f.calls.at(-1).body.messages.find(m=>m.role==='tool').content);assert.equal(result.routes[0].id,route.id);
  f.use('get_process_route',{route_id:route.id});await f.chat(f.staff);result=JSON.parse(f.calls.at(-1).body.messages.find(m=>m.role==='tool').content);assert.deepEqual(result.graph,graph);
  f.use('get_production_order',{production_id:order.id});await f.chat(f.staff);result=JSON.parse(f.calls.at(-1).body.messages.find(m=>m.role==='tool').content);assert.equal(result.operation_routes[0].operations[0].name,'切割');assert.ok(!JSON.stringify(result).includes('cost_cents'));
  assert.match(f.calls.at(-1).body.messages[0].content,/中间工序不扣料/);
  assert.match(f.calls.at(-1).body.messages[0].content,/删除工艺路线须由具有BOM管理权限的用户/);
  assert.match(f.calls.at(-1).body.messages[0].content,/AI不创建、修改或删除工艺路线/);
  assert.ok(!f.calls.at(-1).body.tools.some(tool=>/^(?:preview|save|report|void).*route/.test(tool.function.name)));
  const other=(await f.request(f.admin,'/warehouses',{name:'AI工艺隔离仓'})).data;
  f.use('get_process_route',{route_id:route.id});
  const scoped=await f.request(f.admin,'/ai/chat',{message:'查询路线'},'POST',other.id);assert.equal(scoped.status,200);
  assert.match(JSON.parse(f.calls.at(-1).body.messages.find(m=>m.role==='tool').content).error,/当前仓库/);
  await f.permissions(['ai']);await f.chat(f.staff);assert.ok(!f.calls.at(-1).body.tools.some(tool=>tool.function.name==='get_process_route'));
});

test('AI edits every ProductForm property with a rolled back preview, sync details and price history', async t => {
  const f = await fixture(t);
  await f.permissions(['ai', 'products']);
  const original = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  const target = (await f.request(f.admin, '/warehouses', { name: 'AI属性同步仓库' })).data;
  const customer = (await f.request(f.admin, '/contacts', { request_id: randomUUID(), role: 'customer', name: 'AI属性客户', person: '', phone: '', address: '', note: '', active: 1 })).data;
  const category = (await f.request(f.admin, '/categories', { name: 'AI属性分类', parent_id: null })).data;
  const graph = { nodes: [{ id: 'out', name: '检验', note: '', x: 24, y: 24 }], edges: [] };
  const route = (await f.request(f.admin, '/process-routes', { request_id: randomUUID(), name: 'AI属性工艺', note: '', enabled: 1, graph })).data;
  assert.ok(customer.id); assert.ok(category.id); assert.ok(route.id);
  f.db.prepare("UPDATE imagebed_settings SET base_url='https://img.example.com' WHERE id=1").run();
  f.use('get_product', { warehouse_id: 1, product_id: 1 });
  const read = await f.chat(f.staff);
  const details = JSON.parse(f.calls.at(-1).body.messages.find(message => message.role === 'tool').content);
  assert.equal(details.version, original.version);
  assert.equal(details.cost, original.cost);
  assert.equal(details.inventory_value_cents, undefined);
  const changes = { active: 0, name: 'AI完整属性物料', barcode: 'AI-PROPERTIES', category_id: category.id, unit: '件', cost: 2.1234, price: 3.5678,
    threshold: 1.2, specification: ' AI规格 ', note: ' AI备注 ', image: 'https://img.example.com/file/product.webp', production_type: '半成品',
    default_route_id: route.id, is_fixed_asset: 1, unit_round_up: 1, inspection_date: '2027-01-01', inspection_interval: 3, inspection_unit: 'month',
    customer_part_numbers: [{ customer_id: customer.id, part_number: ' AI-客户-001 ' }] };
  f.use('preview_update_products', { warehouse_id: 1, items: [{ product_id: 1, version: details.version, changes, sync_warehouse_ids: [target.id] }] });
  const response = await f.chat(f.staff, { conversation_id: read.data.conversation_id });
  assert.equal(response.status, 200);
  assert.equal(response.data.actions.length, 1, JSON.stringify(response.data));
  const action = response.data.actions[0];
  assert.equal(action.kind, 'update_products');
  assert.deepEqual(f.db.prepare('SELECT * FROM products WHERE id=1').get(), original);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products WHERE warehouse_id=?').get(target.id).n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM product_changes').get().n, 0);
  const source = action.preview.items.find(item => item.product_id === 1);
  assert.equal(source.changes.find(change => change.field === 'threshold').after, 2);
  assert.equal(source.changes.find(change => change.field === 'category_id').after, 'AI属性分类');
  assert.equal(source.changes.find(change => change.field === 'default_route_id').after, 'AI属性工艺');
  assert.equal(source.changes.find(change => change.field === 'customer_part_numbers').after[0].customer_name, 'AI属性客户');
  assert.ok(action.preview.items.some(item => item.warehouse_id === target.id && item.creates_product));
  assert.equal(action.preview.sync_warehouses[0].id, target.id);
  const schema = f.calls.at(-1).body.tools.find(tool => tool.function.name === 'preview_update_products').function.parameters.properties.items.items.properties.changes.properties;
  for (const field of Object.keys(changes)) assert.ok(schema[field], field);
  const confirmed = await f.request(f.staff, '/ai/confirm', { action_id: action.id });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.count, 1);
  const saved = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  for (const [key, value] of Object.entries({ ...changes, threshold: 2, specification: 'AI规格', note: 'AI备注' }))
    if (key !== 'customer_part_numbers') assert.deepEqual(saved[key], value, key);
  assert.equal(saved.stock, original.stock);
  assert.equal(saved.inventory_value_cents, original.inventory_value_cents);
  assert.ok(saved.version > original.version);
  assert.deepEqual(JSON.parse(saved.customer_part_numbers), [{ customer_id: customer.id, part_number: 'AI-客户-001' }]);
  const synced = f.db.prepare('SELECT * FROM products WHERE warehouse_id=?').get(target.id);
  assert.equal(synced.active, 1); assert.equal(synced.production_type, '半成品'); assert.equal(synced.stock, 0); assert.equal(synced.default_route_id, null);
  const history = f.db.prepare('SELECT * FROM product_changes WHERE product_id=1').all();
  assert.equal(history.length, 1); assert.equal(history[0].created_by, f.id); assert.equal(history[0].before_cost, original.cost);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: action.id })).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM product_changes WHERE product_id=1').get().n, 1);
});

test('AI partial product edits preserve omitted fields and allow explicit clearing', async t => {
  const f = await fixture(t);
  const customer = (await f.request(f.admin, '/contacts', { request_id: randomUUID(), role: 'customer', name: '保留料号客户', person: '', phone: '', address: '', note: '', active: 1 })).data;
  f.db.prepare("UPDATE products SET production_type='成品',inspection_date='2027-01-01',inspection_interval=2,customer_part_numbers=? WHERE id=1")
    .run(JSON.stringify([{ customer_id: customer.id, part_number: 'KEEP-001' }]));
  let original = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  f.use('preview_update_products', { warehouse_id: 1, items: [{ product_id: 1, version: original.version, changes: { note: '仅改备注' } }] });
  let response = await f.chat(f.admin), action = response.data.actions[0];
  assert.deepEqual(action.preview.items[0].changes, [{ field: 'note', before: original.note, after: '仅改备注' }]);
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: action.id })).status, 200);
  let saved = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  assert.deepEqual({ ...saved, note: original.note, version: original.version }, { ...original });
  original = saved;
  f.use('preview_update_products', { warehouse_id: 1, items: [{ product_id: 1, version: original.version,
    changes: { production_type: '', customer_part_numbers: [], default_route_id: null, image: '', inspection_date: '', inspection_interval: 0, barcode: '' } }] });
  response = await f.chat(f.admin); action = response.data.actions[0];
  assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: action.id })).status, 200);
  saved = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  assert.equal(saved.production_type, ''); assert.equal(saved.customer_part_numbers, '[]'); assert.equal(saved.inspection_date, '');
  assert.equal(saved.inspection_interval, 0); assert.equal(saved.barcode, original.barcode);
});

test('AI product edits share panel validation and roll back the entire batch on failure', async t => {
  const f = await fixture(t);
  const original = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  const other = f.db.prepare('SELECT * FROM products WHERE id=2').get();
  const target = (await f.request(f.admin, '/warehouses', { name: 'AI无效目标' })).data;
  const invalid = [ { stock: 99 }, { active: 2 }, { name: '' }, { cost: -1 }, { price: 1.23456 }, { threshold: -1 },
    { production_type: '废品' }, { unit_round_up: 2 }, { inspection_date: 'not-a-date' }, { inspection_interval: 1000 },
    { customer_part_numbers: [{ customer_id: 99999, part_number: 'bad' }] }, { category_id: 99999 }, { default_route_id: 99999 },
    { image: 'https://untrusted.example/file/test.png' }, { name: null }, { specification: 'x'.repeat(501) }, { note: 'x'.repeat(2001) } ];
  for (const changes of invalid) {
    f.use('preview_update_products', { warehouse_id: 1, items: [{ product_id: 1, version: original.version, changes }] });
    const response = await f.chat(f.admin);
    assert.equal(response.data.actions.length, 0, JSON.stringify(changes));
    assert.deepEqual(f.db.prepare('SELECT * FROM products WHERE id=1').get(), original);
  }
  for (const items of [
    [{ product_id: 1, version: original.version - 1, changes: { note: 'stale' } }],
    [{ product_id: 1, version: original.version, changes: {} }],
    [1, 1].map(product_id => ({ product_id, version: original.version, changes: { note: 'duplicate' } })),
    [{ product_id: 1, version: original.version, changes: { cost: 9 }, sync_warehouse_ids: [target.id] }, { product_id: 2, version: other.version, changes: { barcode: original.barcode } }],
  ]) {
    f.use('preview_update_products', { warehouse_id: 1, items });
    const response = await f.chat(f.admin);
    assert.equal(response.data.actions.length, 0, JSON.stringify(items));
    assert.deepEqual(f.db.prepare('SELECT * FROM products WHERE id=1').get(), original);
    assert.deepEqual(f.db.prepare('SELECT * FROM products WHERE id=2').get(), other);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products WHERE warehouse_id=?').get(target.id).n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM product_changes').get().n, 0);
  }
  f.use('preview_update_products', { warehouse_id: target.id, items: [{ product_id: 1, version: original.version, changes: { note: 'wrong warehouse' } }] });
  assert.equal((await f.chat(f.admin)).data.actions.length, 0);
});

test('AI product confirmation detects changed source, sync target and reference data', async t => {
  const f = await fixture(t);
  const target = (await f.request(f.admin, '/warehouses', { name: 'AI并发同步' })).data;
  const original = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  for (const mutate of [
    () => f.db.prepare("UPDATE products SET note='别人修改' WHERE id=1").run(),
    () => f.db.prepare('UPDATE categories SET name=? WHERE id=?').run('分类已变', original.category_id),
    () => f.db.prepare('INSERT INTO products(name,barcode,category,unit,cost,price,threshold,warehouse_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('冲突物料', original.barcode, '未分类', original.unit, 1, 2, 0, target.id, new Date().toISOString()),
  ]) {
    const product = f.db.prepare('SELECT * FROM products WHERE id=1').get();
    f.use('preview_update_products', { warehouse_id: 1, items: [{ product_id: 1, version: product.version, changes: { production_type: '原料' }, sync_warehouse_ids: [target.id] }] });
    const response = await f.chat(f.admin), action = response.data.actions[0];
    assert.ok(action, JSON.stringify(response.data));
    mutate();
    assert.equal((await f.request(f.admin, '/ai/confirm', { action_id: action.id })).status, 409);
    assert.equal(f.db.prepare('SELECT production_type FROM products WHERE id=1').get().production_type, original.production_type);
  }
});

test('AI product tools enforce products permission and the writes switch on preview and confirmation', async t => {
  const f = await fixture(t), product = f.db.prepare('SELECT * FROM products WHERE id=1').get();
  await f.permissions(['ai']);
  await f.chat(f.staff);
  assert.ok(!f.calls.at(-1).body.tools.some(tool => ['get_product', 'preview_update_products'].includes(tool.function.name)));
  f.use('get_product', { warehouse_id: 1, product_id: 1 });
  assert.equal((await f.chat(f.staff)).status, 403);
  const args = { warehouse_id: 1, items: [{ product_id: 1, version: product.version, changes: { production_type: '原料' } }] };
  f.use('preview_update_products', args);
  assert.equal((await f.chat(f.staff)).status, 403);
  await f.permissions(['ai', 'products']);
  f.use('search_process_routes', {});
  assert.equal((await f.chat(f.staff)).status, 200);
  f.use('preview_update_products', args);
  const response = await f.chat(f.staff), action = response.data.actions[0];
  assert.ok(action);
  assert.equal((await f.request(f.admin, '/settings/ai', { ...f.settings, writes: false }, 'PUT')).status, 200);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: action.id })).status, 403);
  f.use('preview_update_products', args);
  assert.equal((await f.chat(f.staff)).status, 403);
  assert.ok(!f.calls.at(-1).body.tools.some(tool => tool.function.name === 'preview_update_products'));
  assert.equal((await f.request(f.admin, '/settings/ai', f.settings, 'PUT')).status, 200);
  await f.permissions(['ai']);
  assert.equal((await f.request(f.staff, '/ai/confirm', { action_id: action.id })).status, 403);
  assert.deepEqual(f.db.prepare('SELECT * FROM products WHERE id=1').get(), product);
});
