import { productionAction, adjustUsage, submitProductionBatch } from './production-ui-helpers.js';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

async function fixture(page, worker = false) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'stageadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const group = worker ? await post('/production-groups', { name: '分层生产组', description: '' }) : null;
  if (worker) {
    const position = await post('/positions', { name: '分层登记岗位', access_mode: 'production_only', permissions: ['production_register'] });
    await post('/users', { username: 'stageworker', employee_no: 'stageworker', password: 'Test-worker-123', role: 'employee', position_id: position.id, production_group_id: group.id });
  }
  const product = name => post('/products', { name, barcode: randomUUID(), category: '生产', unit: '件', cost: 1, price: 2, threshold: 0 });
  const output = await product('分层成品'), half = await product('分层半成品'), raw = await product('分层原料');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10000 WHERE id=?').run(raw.id);
  const bom = (product_id, name, items) => post('/boms', { product_id, name, base_quantity: 1, base_unit: '件', note: '', enabled: 1, items });
  const child = await bom(half.id, '半成品配方', [{ product_id: raw.id, quantity: 3, unit: '件', note: '' }]);
  const parent = await bom(output.id, '成品配方', [{ product_id: half.id, quantity: 2, unit: '件', note: '', usage_mode: 'explode', child_bom_id: child.id }]);
  const plan = await post('/production-orders/prepare', { bom_id: parent.id, bom_version: parent.version, planned_quantity: 10 });
  const draft = await post('/production-orders', { bom_id: parent.id, bom_version: parent.version, planned_quantity: 10, structure_token: plan.structure_token, note: '', production_group_id: group?.id });
  const started = await post(`/production-orders/${draft.id}/start`, { version: draft.version });
  const doc = started.material_documents[0];
  await post(`/production-material-documents/${doc.id}/confirm`, { version: doc.version });
  if (worker) await post('/auth/login', { username: 'stageworker', password: 'Test-worker-123' });
  const get = async () => (await page.request.get(`${base}/api/production-orders/${draft.id}`)).json();
  return { base, db, post, get, draft, parent, child, output, half, raw, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
  } };
}

for (const mode of ['desktop', 'mobile', 'pwa']) test(`${mode} registers child BOM then root without double consumption`, async ({ page, browser }) => {
  test.setTimeout(90000);
  const context = mode === 'pwa' ? await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, userAgent: iphone }) : null;
  if (context) page = await context.newPage();
  if (mode !== 'desktop') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${f.base}/#production`);
    if (context) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: `查看生产单 ${f.draft.number}`, exact: true }).click();
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await expect(page.getByRole('heading', { name: '产品与半成品进度', exact: true })).toBeVisible();
    const halfStage = page.locator('.production-progress-item').filter({ has: page.getByRole('button', { name: '登记 分层半成品', exact: true }) });
    await halfStage.getByText('查看累计投入差异', { exact: true }).click();
    await expect(halfStage).toContainText('累计实际 0 件 · 累计标准 0 件');
    await page.getByRole('button', { name: '登记 分层半成品', exact: true }).click();
    await page.getByLabel('本次数量', { exact: true }).fill('12');
    await adjustUsage(page);
    await page.getByRole('button', { name: '按本批产量带出耗料', exact: true }).click();
    await expect(page.getByLabel('分层原料实际耗料', { exact: true })).toHaveValue('36');
    await submitProductionBatch(page);
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    let order = await f.get();
    expect(order.completed_quantity || 0).toBe(0);
    expect(order.stages.find(s => s.path === '1').available_quantity).toBe(12);
    expect(order.items[0].available_quantity).toBe(24);
    expect(order.receipt_documents).toHaveLength(0);
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    const ledger = page.getByRole('table', { name: '生产物料台账', exact: true });
    await expect(ledger.locator('[data-field="used_quantity"]')).toContainText('36');
    await expect(ledger.locator('[data-field="available_quantity"]')).toContainText('24');
    await ledger.getByRole('button', { name: '查看详情 分层原料', exact: true }).click();
    await expect(ledger.getByText('计入最终成品的耗料', { exact: true })).toBeVisible();
    await expect(ledger.locator('[data-field="final_product_usage"]')).toContainText('0');
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('button', { name: '登记 分层成品', exact: true }).click();
    await page.getByLabel('本次数量', { exact: true }).fill('5');
    await adjustUsage(page);
    await page.getByRole('button', { name: '按本批产量带出耗料', exact: true }).click();
    await expect(page.getByLabel('分层半成品实际耗料', { exact: true })).toHaveValue('10');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('stage-register.png'), fullPage: true });
    await submitProductionBatch(page);
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    order = await f.get();
    expect(order.completed_quantity).toBe(5);
    expect(order.stages.find(s => s.path === '1').available_quantity).toBe(2);
    expect(order.items[0].available_quantity).toBe(24);
    expect(order.receipt_documents).toHaveLength(1);
    expect(order.total_cost_cents).toBe(3000);
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.half.id).stock).toBe(0);
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.raw.id).stock).toBe(40);
    page.once('dialog', dialog => dialog.accept());
    await productionAction(page, '结束生产');
    await expect(page.getByRole('alert')).toContainText('半成品');
    await page.screenshot({ path: test.info().outputPath('stage-progress.png'), fullPage: true });
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('button', { name: '查看批次 分层半成品', exact: true }).click();
    await page.getByRole('button', { name: '作废第 1 批', exact: true }).click();
    await page.getByLabel('层级批次作废原因', { exact: true }).fill('核对本批登记');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认作废批次', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('上层');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '返回单据详情', exact: true }).click();
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('button', { name: '查看批次 分层成品', exact: true }).click();
    await page.getByRole('button', { name: '作废第 1 批', exact: true }).click();
    await page.getByLabel('层级批次作废原因', { exact: true }).fill('先撤销成品登记');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认作废批次', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    order = await f.get();
    expect(order.stages.find(s => s.path === '1').available_quantity).toBe(12);
    expect(order.receipt_documents[0].status).toBe('void');
    expect(errors).toEqual([]);
  } finally { await f.close(); await context?.close(); }
});

test('scan chooses a production layer and preserves edits on rejected navigation', async ({ page }) => {
  const f = await fixture(page);
  try {
    const sourceId = f.db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
    const link = productionRegistrationUrl({ origin: f.base, warehouseId: 1, orderId: f.draft.id, number: f.draft.number, sourceId });
    await page.goto(link);
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: /分层半成品/ }).check();
    await page.getByLabel('本次数量', { exact: true }).fill('7');
    await adjustUsage(page);
    page.once('dialog', dialog => dialog.dismiss());
    await page.evaluate(link => { history.replaceState(null, '', link); window.dispatchEvent(new HashChangeEvent('hashchange')); }, link);
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('7');
    await expect.poll(() => new URL(page.url()).hash).toBe('#production');
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_stage_batches').get().n).toBe(0);
  } finally { await f.close(); }
});

test('scan to another stage order resets the form and rechecks edits made during lookup', async ({ page }) => {
  test.setTimeout(45000);
  const f = await fixture(page);
  let releaseLookup;
  try {
    const plan = await f.post('/production-orders/prepare', { bom_id: f.draft.bom_id, bom_version: f.draft.bom_version, planned_quantity: 1 });
    const other = await f.post('/production-orders', { bom_id: f.draft.bom_id, bom_version: f.draft.bom_version, planned_quantity: 1, structure_token: plan.structure_token, note: '' });
    const started = await f.post(`/production-orders/${other.id}/start`, { version: other.version });
    await f.post(`/production-material-documents/${started.material_documents[0].id}/confirm`, { version: started.material_documents[0].version });
    const sourceId = f.db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
    const link = id => productionRegistrationUrl({ origin: f.base, warehouseId: 1, orderId: id, number: id === other.id ? other.number : f.draft.number, sourceId });
    const scan = target => page.evaluate(target => { history.replaceState(null, '', target); window.dispatchEvent(new HashChangeEvent('hashchange')); }, target);
    await page.goto(link(f.draft.id));
    await page.getByRole('radio', { name: /分层半成品/ }).check();
    await page.getByLabel('本次数量', { exact: true }).fill('7');
    await adjustUsage(page);
    page.once('dialog', dialog => dialog.accept());
    await scan(link(other.id));
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: /分层半成品/ }).check();
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('');
    let lookupStarted;
    const startedPromise = new Promise(resolve => { lookupStarted = resolve; });
    const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
    await page.route(`**/api/production-orders/${f.draft.id}`, async route => { lookupStarted(); await lookupGate; await route.continue(); });
    await scan(link(f.draft.id));
    await startedPromise;
    await page.getByLabel('本次数量', { exact: true }).fill('1');
    await adjustUsage(page);
    page.once('dialog', dialog => dialog.dismiss());
    releaseLookup();
    await expect.poll(() => new URL(page.url()).hash).toBe('#production');
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('1');
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_stage_batches').get().n).toBe(0);
  } finally { releaseLookup?.(); await f.close(); }
});

test('production-only mobile worker registers stages without costs or management actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  const f = await fixture(page, true);
  try {
    await page.goto(`${f.base}/#production`);
    await expect(page.getByText('77 ERP · 仅生产作业', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `查看生产单 ${f.draft.number}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: '分层材料成本', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('button', { name: '登记 分层半成品', exact: true }).click();
    await page.getByLabel('本次数量', { exact: true }).fill('2');
    await adjustUsage(page);
    await page.getByRole('button', { name: '按本批产量带出耗料', exact: true }).click();
    await submitProductionBatch(page);
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('button', { name: '登记 分层成品', exact: true }).click();
    await page.getByLabel('本次数量', { exact: true }).fill('1');
    await adjustUsage(page);
    await page.getByRole('button', { name: '按本批产量带出耗料', exact: true }).click();
    await expect(page.getByRole('button', { name: '本批登记并结束生产', exact: true })).toHaveCount(0);
    await submitProductionBatch(page);
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    const order = await f.get();
    expect(order.completed_quantity).toBe(1);
    expect(JSON.stringify(order)).not.toMatch(/"(?:[^"\s]*cost_cents|stock)"\s*:/);
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    const ledger = page.getByRole('table', { name: '生产物料台账', exact: true });
    await ledger.getByRole('button', { name: '查看详情 分层原料', exact: true }).focus();
    await ledger.getByRole('button', { name: '查看详情 分层原料', exact: true }).press('Enter');
    await expect(ledger.getByRole('button', { name: '收起详情 分层原料', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(ledger.getByText('材料成本', { exact: true })).toHaveCount(0);
    await expect(ledger.getByText('余料成本', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await page.getByRole('button', { name: '查看批次 分层成品', exact: true }).click();
    await expect(page.getByRole('button', { name: '作废第 1 批', exact: true })).toHaveCount(0);
  } finally { await f.close(); }
});


for (const mode of ['desktop', 'mobile', 'pwa']) test(`${mode} chooses partial stock supply while creating an order`, async ({ page, browser }) => {
  test.setTimeout(90000);
  const context = mode === 'pwa' ? await browser.newContext({ locale:'zh-CN', serviceWorkers:'allow', viewport:{width:390,height:844}, userAgent:iphone }) : null;
  if (context) page = await context.newPage();
  if (mode !== 'desktop') {
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(ua => Object.defineProperty(navigator,'userAgent',{value:ua}),iphone);
  }
  const f = await fixture(page), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    f.db.prepare('UPDATE products SET stock=8,inventory_value_cents=800 WHERE id=?').run(f.half.id);
    await page.goto(`${f.base}/#production`);
    if (context) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button',{name:'新建生产单',exact:true}).click();
    await page.getByRole('button',{name:/^选择配方 分层成品 · 成品配方 #/}).click();
    await page.getByLabel('计划产量',{exact:true}).fill('10');
    const { chooseOption } = await import('./dropdown-helpers.js');
    const source = page.getByRole('combobox',{name:'分层半成品［1］用料来源',exact:true});
    await chooseOption(source,'stock');
    await expect(page.getByRole('combobox',{name:'分层半成品［1］本次生产配方',exact:true})).toHaveCount(0);
    await chooseOption(source,'produce');
    await chooseOption(source,'partial');
    await page.getByLabel('分层半成品［1］库存领用数量',{exact:true}).fill('5');
    await page.getByRole('button',{name:'重新测算用料',exact:true}).click();
    await expect(page.locator('.production-supply')).toContainText('本层需求 20 件 · 当前库存 8 件');
    await expect(page.locator('.production-supply')).toContainText('库存领用 5 件 · 本单生产 15 件');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path:test.info().outputPath('production-supply.png'), fullPage:true });
    await expect(page.locator('.production-material').filter({has:page.getByText('分层半成品',{exact:true})})).toContainText('5 件');
    await page.getByRole('button',{name:'保存生产草稿',exact:true}).click();
    await expect(page.getByRole('heading',{name:'生产单详情',exact:true})).toBeVisible();
    const order = f.db.prepare('SELECT * FROM production_orders ORDER BY id DESC LIMIT 1').get();
    const items = f.db.prepare('SELECT product_id,planned_quantity FROM production_items WHERE production_id=? ORDER BY position').all(order.id);
    expect(items.map(row=>[row.product_id,row.planned_quantity])).toEqual([[f.half.id,5],[f.raw.id,45]]);
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.half.id).stock).toBe(8);
    expect(f.db.prepare('SELECT usage_mode FROM bom_items WHERE bom_id=?').get(f.parent.id).usage_mode).toBe('explode');
    expect(errors).toEqual([]);
  } finally { await f.close(); await context?.close(); }
});
