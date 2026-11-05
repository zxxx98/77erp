import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

async function fixture(page, fractional = false) {
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
  const child = await bom(half.id, '半成品配方'.repeat(10), [{ product_id: raw.id, ...(fractional ? { quantity: 0.3334, quantity_fraction: '1/3' } : { quantity: 3 }), unit: '件', note: '' }]);
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

test('desktop registration drawer preserves detail, guards drafts and closes after reporting', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.goto(`${f.base}/#production?order=${f.order.id}`);
    const opener = page.getByRole('button', { name: '登记', exact: true });
    await opener.click();
    const drawer = page.getByRole('dialog', { name: '生产登记', exact: true });
    await expect(drawer).toBeVisible();
    await expect(page.locator('.production-detail-header')).toBeAttached();
    await drawer.getByRole('button', { name: '选择工序', exact: true }).click();
    await drawer.getByRole('searchbox').fill('半成品配方');
    await drawer.locator('.registration-option-row').filter({ hasText: f.longName }).getByRole('radio').click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const quantity = drawer.getByLabel('本次数量', { exact: true });
    const pickerHeight = await drawer.locator('.registration-picker-trigger').evaluate(element => element.getBoundingClientRect().height);
    const quantityHeight = await quantity.evaluate(element => element.getBoundingClientRect().height);
    expect(pickerHeight).toBe(44);
    expect(quantityHeight).toBe(pickerHeight);
    await quantity.fill('2');
    await page.screenshot({ path: test.info().outputPath('desktop-registration-selected.png') });
    page.once('dialog', dialog => dialog.dismiss());
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(quantity).toHaveValue('2');
    await drawer.locator('.registration-details summary').click();
    await page.setViewportSize({ width: 1000, height: 600 });
    await drawer.locator('.registration-drawer-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(drawer.getByRole('button', { name: '提交登记', exact: true })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('desktop-registration-drawer.png') });
    let releaseReport;
    const pendingReport = new Promise(resolve => { releaseReport = resolve; });
    await page.route('**/api/production-orders/*/operations/report', async route => { await pendingReport; await route.continue(); });
    await drawer.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(drawer.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    releaseReport();
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: '已登记' })).toBeVisible();
    expect((await f.get()).operation_routes.find(route => route.path === '1').reports).toHaveLength(1);
    await opener.click();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  } finally { await f.close(); }
});

test('desktop registration drawer restores progress scroll and its expanded operation', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.goto(`${f.base}/#production?order=${f.order.id}`);
    const tab = page.getByRole('tab', { name: '生产进度', exact: true });
    await tab.click();
    const half = page.locator('.production-progress-item').filter({ has: page.getByRole('button', { name: '查看批次 半成品', exact: true }) });
    const disclosure = half.locator('details').filter({ hasText: '工序进度与登记' });
    await disclosure.locator('summary').click();
    const opener = half.getByRole('button', { name: `登记 ${f.longName}`, exact: true });
    await opener.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    await opener.click();
    const drawer = page.getByRole('dialog', { name: '生产登记', exact: true });
    await expect(drawer.locator('.registration-picker-trigger')).toContainText(f.longName);
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(opener).toBeFocused();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(disclosure).toHaveAttribute('open', '');
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await half.getByRole('button', { name: '查看工序记录', exact: true }).click();
    const operations = page.locator('.production-stages.process-page');
    await page.getByRole('button', { name: '工序列表', exact: true }).click();
    await operations.getByRole('button', { name: `登记工序 ${f.longName}`, exact: true }).click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(operations).toBeVisible();
  } finally { await f.close(); }
});

test('desktop registration drawer retains failed drafts and stays open after reload', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.goto(`${f.base}/#production?order=${f.order.id}`);
    await page.getByRole('button', { name: '登记', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '生产登记', exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '选择工序', exact: true }).click();
    await drawer.getByRole('searchbox').fill('半成品配方');
    await drawer.locator('.registration-option-row').filter({ hasText: f.longName }).getByRole('radio').click();
    const quantity = drawer.getByLabel('本次数量', { exact: true });
    await quantity.fill('2');
    const order = await f.get();
    await f.post(`/production-orders/${order.id}/operations/report`, { version: order.version, path: '1', operation_node_id: 'n0', quantity: 1 });
    await drawer.getByRole('button', { name: '提交登记', exact: true }).click();
    await expect(drawer.getByRole('alert')).toBeVisible();
    await expect(quantity).toHaveValue('2');
    page.once('dialog', dialog => dialog.accept());
    await drawer.getByRole('button', { name: '重新读取生产单', exact: true }).click();
    await expect(quantity).toHaveValue('');
    await expect(drawer).toBeVisible();
    await quantity.fill('1');
    page.once('dialog', dialog => dialog.accept());
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    expect((await f.get()).operation_routes.find(route => route.path === '1').reports).toHaveLength(1);
  } finally { await f.close(); }
});

for (const mode of ['iPhone 13', 'Pixel 7']) test(`${mode} detail registration remains a standalone page`, async ({ browser }) => {
  const context = await browser.newContext({ ...devices[mode], locale: 'zh-CN' });
  const page = await context.newPage(), f = await fixture(page);
  try {
    await page.goto(`${f.base}/#production?order=${f.order.id}`);
    await page.getByRole('button', { name: '登记', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '返回单据详情', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('mobile-registration-page.png'), fullPage: true });
  } finally { await f.close(); await context.close(); }
});

for (const mode of ['desktop', 'iPhone 13', 'Pixel 7', 'pwa']) test(`${mode} fractional output consumes exact BOM materials`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), fixtureData = await fixture(page, true);
  try {
    for (const node of ['n0', 'n1', 'n2']) {
      const order = await fixtureData.get();
      await fixtureData.post(`/production-orders/${order.id}/operations/report`, { version: order.version, path: '1', operation_node_id: node, quantity: 1 });
    }
    await page.goto(fixtureData.link);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.locator('.registration-picker-trigger').click();
    await page.getByRole('searchbox', { name: '搜索工序、路线、BOM 或层级', exact: true }).fill('检验');
    await page.locator('.registration-option-row').filter({ hasText: '半成品配方' }).getByRole('radio').click();
    const quantity = page.getByLabel('本次数量', { exact: true });
    await page.locator('.registration-details summary').click();
    for (let batch = 0; batch < 3; batch++) {
      await quantity.fill('1/3');
      await expect(page.getByLabel('钢材实际耗料', { exact: true })).toHaveValue('1/9');
      await page.getByRole('button', { name: '提交登记', exact: true }).click();
      await expect(quantity).toHaveValue('');
    }
    const order = await fixtureData.get();
    expect(order.stages.find(stage => stage.path === '1').available_quantity).toBe(1);
    expect(order.items[0].consumed_quantity_fraction).toBe('1/3');
  } finally { await fixtureData.close(); await context.close(); }
});

for (const mode of ['desktop', 'iPhone 13', 'Pixel 7', 'pwa']) test(`${mode} fractional operation reports retain exact thirds`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), fixtureData = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(fixtureData.link);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: '选择工序', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索工序、路线、BOM 或层级', exact: true }).fill('半成品配方');
    await page.locator('.registration-option-row').filter({ hasText: fixtureData.longName }).getByRole('radio').click();
    await expect(page.getByText('数量可填小数或分数', { exact: false })).toBeVisible();
    const quantity = page.getByLabel('本次数量', { exact: true });
    await expect(quantity).toHaveAttribute('inputmode', 'text');
    for (let batch = 0; batch < 3; batch++) {
      await quantity.fill('1/3');
      await page.getByRole('button', { name: '提交登记', exact: true }).click();
      await expect(quantity).toHaveValue('');
      const order = await fixtureData.get();
      expect(order.operation_routes.find(route => route.path === '1').reports).toHaveLength(batch + 1);
    }
    const order = await fixtureData.get(), route = order.operation_routes.find(route => route.path === '1');
    expect(route.operations[0].completed_quantity).toBe(1);
    expect(route.operations[1].available_quantity).toBe(1);
    expect(route.reports.every(report => report.quantity_fraction === '1/3')).toBe(true);
    expect(errors).toEqual([]);
  } finally { await fixtureData.close(); await context.close(); }
});

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
    const scroller = dialog.locator('.form-body');
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
