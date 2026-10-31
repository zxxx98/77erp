import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body } });
    const value = await response.json(); expect(response.ok(), JSON.stringify(value)).toBe(true); return value;
  };
  await post('/auth/setup', { username: 'quickadmin', password: 'Quick-test-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const longName = '精密工件表面处理'.repeat(5) + '下料';
  const nodes = [longName, '成型', '抛光', '检验'].map((name, i) => ({ id: `n${i}`, name, note: '', x: 24 + i * 220, y: 24 }));
  const route = await post('/process-routes', { name: '半成品精密加工路线'.repeat(6), enabled: 1, note: '', graph: { nodes, edges: nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id })) } });
  const product = (name, routed = true) => post('/products', { name, barcode: randomUUID(), category: '生产', unit: '件', cost: 1, price: 2, threshold: 0, default_route_id: routed ? route.id : null });
  const raw = await product('钢材', false), half = await product('半成品'), output = await product('成品');
  db.prepare('UPDATE products SET stock=1000,inventory_value_cents=100000 WHERE id=?').run(raw.id);
  const bom = (product_id, name, items) => post('/boms', { product_id, name, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items });
  const child = await bom(half.id, '半成品配方'.repeat(10), [{ product_id: raw.id, quantity: 3, unit: '件', note: '' }]);
  const root = await bom(output.id, '成品配方', [{ product_id: half.id, quantity: 1, unit: '件', note: '', usage_mode: 'explode', child_bom_id: child.id }]);
  const plan = await post('/production-orders/prepare', { bom_id: root.id, bom_version: root.version, planned_quantity: 10 });
  let order = await post('/production-orders', { bom_id: root.id, bom_version: root.version, planned_quantity: 10, structure_token: plan.structure_token, note: '' });
  order = await post(`/production-orders/${order.id}/start`, { version: order.version });
  await post(`/production-material-documents/${order.material_documents[0].id}/confirm`, { version: order.material_documents[0].version });
  const workspace = await (await page.request.get(base + '/api/workspace')).json();
  const link = productionRegistrationUrl({ origin: base, warehouseId: 1, orderId: order.id, number: order.number, sourceId: workspace.instance_id });
  const get = async () => (await page.request.get(`${base}/api/production-orders/${order.id}`)).json();
  return { base, db, post, order, link, longName, get, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

for (const mode of ['desktop', 'iPhone 13', 'Pixel 7', 'pwa']) test(`${mode} searchable quick picker keeps long duplicate operation identities readable`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (mode !== 'desktop') await page.setViewportSize({ width: 320, height: 850 });
    await page.goto(f.link);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: '选择工序', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索工序、路线、BOM 或层级', exact: true }).fill('半成品配方');
    const row = page.locator('.registration-option-row').filter({ hasText: f.longName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('半成品精密加工路线');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await row.getByRole('radio').click();
    await expect(page.locator('.registration-picker-trigger')).toContainText(f.longName);
    await expect(page.locator('.registration-picker-trigger')).toContainText('半成品配方');
    const quantity = page.getByLabel('本次数量', { exact: true });
    await quantity.fill('2');
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已登记' })).toBeVisible();
    const order = await f.get();
    expect(order.operation_routes.find(route => route.path === '1').reports).toHaveLength(1);
    expect(order.operation_routes.find(route => route.path === '').reports).toHaveLength(0);
    expect(order.items[0].available_quantity).toBe(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('long-operation-names.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await f.close(); await context.close(); }
});

for (const mode of ['desktop', 'Pixel 7', 'iPhone 13', 'pwa']) test(`${mode} unfiltered operations scroll past zero-availability root steps to semi-finished work`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? { viewport: { width: 1280, height: 600 } } : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), f = await fixture(page);
  try {
    if (mode !== 'desktop') await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(f.link);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: '选择工序', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '选择工序', exact: true });
    const scroller = mode === 'desktop' ? dialog : dialog.locator('.form-body');
    await expect(dialog.getByRole('radio')).toHaveCount(8);
    await expect(dialog.getByRole('radio').nth(1)).toBeEnabled();
    await expect(dialog.getByRole('radio').nth(1)).toHaveAccessibleName(/可报 0 件/);
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    if (mode !== 'desktop') {
      const session = await context.newCDPSession(page), box = await scroller.boundingBox();
      const x = box.x + box.width / 2, startY = box.y + box.height - 30;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
      for (let step = 1; step <= 6; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - step * 40 }] });
        await page.waitForTimeout(16);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await session.detach();
    }
    const half = dialog.locator('.registration-option-row').filter({ hasText: f.longName }).filter({ hasText: '半成品配方' });
    await half.scrollIntoViewIfNeeded();
    expect(await scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await half.getByRole('radio').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.registration-picker-trigger')).toContainText('半成品配方');
    await expect(page.getByRole('searchbox', { name: '搜索工序、路线、BOM 或层级', exact: true })).toHaveCount(0);
    expect((await f.get()).operation_routes.every(route => route.report_count === 0)).toBe(true);
  } finally { await f.close(); await context.close(); }
});

test('quick report retries a lost response without duplicate work and preserves drafts on a stale version', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.goto(f.link);
    const choose = async name => {
      await page.locator('.registration-picker-trigger').click();
      await page.getByRole('searchbox', { name: '搜索工序、路线、BOM 或层级', exact: true }).fill('半成品配方');
      await page.locator('.registration-option-row').filter({ hasText: name }).getByRole('radio').click();
    };
    await choose(f.longName);
    const quantity = page.getByLabel('本次数量', { exact: true });
    await quantity.fill('2');
    let firstBody;
    await page.route('**/api/production-orders/*/operations/report', async route => {
      if (!firstBody) {
        firstBody = route.request().postDataJSON();
        await route.fetch(); await route.abort('failed');
      } else {
        expect(route.request().postDataJSON().request_id).toBe(firstBody.request_id);
        await route.continue();
      }
    });
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('2');
    expect((await f.get()).operation_routes.find(route => route.path === '1').reports).toHaveLength(1);
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已登记' })).toBeVisible();
    expect((await f.get()).operation_routes.find(route => route.path === '1').reports).toHaveLength(1);
    await page.unroute('**/api/production-orders/*/operations/report');
    await choose('成型'); await quantity.fill('2');
    let order = await f.get();
    await f.post(`/production-orders/${order.id}/operations/report`, { version: order.version, path: '1', operation_node_id: 'n0', quantity: 1 });
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('2');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '重新读取生产单', exact: true }).click();
    await expect(quantity).toHaveValue('');
    await quantity.fill('2');
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已登记 成型' })).toBeVisible();
    order = await f.get();
    expect(order.operation_routes.find(route => route.path === '1').operations.find(node => node.id === 'n1').completed_quantity).toBe(2);
  } finally { await f.close(); }
});

test('quick final output allows actual usage adjustments and root output consumes semi-finished stock once', async ({ page }) => {
  const f = await fixture(page);
  const report = async (path, id, quantity) => {
    const order = await f.get();
    return f.post(`/production-orders/${order.id}/operations/report`, { path, operation_node_id: id, quantity, version: order.version });
  };
  try {
    for (const id of ['n0', 'n1', 'n2']) await report('1', id, 2);
    await page.goto(f.link);
    const quantity = page.getByLabel('本次数量', { exact: true });
    const chooseOutput = async half => {
      await page.locator('.registration-picker-trigger').click();
      await page.getByRole('searchbox', { name: '搜索工序、路线、BOM 或层级', exact: true }).fill('检验');
      const rows = page.locator('.registration-option-row');
      await (half ? rows.filter({ hasText: '半成品配方' }) : rows.filter({ hasNotText: '半成品配方' })).getByRole('radio').click();
    };
    await chooseOutput(true); await quantity.fill('2');
    await page.locator('.registration-details summary').click();
    await expect(page.getByLabel('钢材实际耗料', { exact: true })).toHaveValue('6');
    await page.getByLabel('钢材实际耗料', { exact: true }).fill('5');
    await page.getByLabel('钢材耗料差异原因', { exact: true }).fill('现场核实用量');
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已登记 检验' })).toBeVisible();
    let order = await f.get();
    expect(order.items[0].available_quantity).toBe(25);
    expect(order.stages.find(stage => stage.path === '1').available_quantity).toBe(2);
    expect(order.receipt_documents).toHaveLength(0);
    for (const id of ['n0', 'n1', 'n2']) await report('', id, 1);
    await page.getByText('重新读取单据', { exact: true }).click();
    await page.getByRole('button', { name: '重新读取生产单', exact: true }).click();
    await expect(quantity).toHaveValue('');
    await chooseOutput(false); await quantity.fill('1');
    await page.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已登记 检验' })).toBeVisible();
    order = await f.get();
    expect(order.completed_quantity).toBe(1); expect(order.items[0].available_quantity).toBe(25);
    expect(order.stages.find(stage => stage.path === '1').available_quantity).toBe(1);
    expect(order.receipt_documents).toHaveLength(1);
    expect(order.receipt_documents[0].status).toBe('pending'); expect(order.status).toBe('in_progress');
  } finally { await f.close(); }
});
