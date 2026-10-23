import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(base + '/api' + path, { data: { request_id: randomUUID(), ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'productionadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const products = [];
  for (const [name, barcode, unit, stock, value] of [['示例成品', 'FINISHED', '件', 0, 0], ['材料甲', 'MATERIAL', '千克', 100, 12345], ['材料乙', 'SECOND', '米', 50, 5000]]) {
    const product = await post('/products', { name, barcode, unit, category: '生产', cost: 1, price: 2, threshold: 0 });
    db.prepare('UPDATE products SET stock=?,inventory_value_cents=? WHERE id=?').run(stock, value, product.id);
    products.push(db.prepare('SELECT * FROM products WHERE id=?').get(product.id));
  }
  const definition = { name: '成品配方', product_id: products[0].id, base_quantity: 2, base_unit: products[0].unit, note: '', enabled: 1,
    items: products.slice(1).map((product, i) => ({ product_id: product.id, quantity: [3, 0.2][i], unit: product.unit, note: '' })) };
  const bom = await post('/boms', definition);
  const inventory = () => db.prepare('SELECT stock,inventory_value_cents FROM products ORDER BY id').all();
  return { base, db, post, products, bom, definition, inventory,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

async function productionFlow(page, pwa = false) {
  const f = await fixture(page), errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const before = f.inventory();
    await page.goto(f.base + '/#production');
    if (pwa) await page.evaluate(() => navigator.serviceWorker.ready);
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新建生产单', exact: true }).click();
    await page.getByRole('button', { name: '选择配方 示例成品', exact: true }).click();
    await page.getByLabel('计划产量', { exact: true }).fill('100');
    await expect(page.locator('.production-material').first()).toContainText('缺料 50 千克');
    await page.getByLabel('计划产量', { exact: true }).fill('10');
    await page.getByLabel('生产备注', { exact: true }).fill('本次生产十件');
    await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('库存未变动');
    expect(f.inventory()).toEqual(before);
    await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
    await page.getByLabel('计划产量', { exact: true }).fill('12');
    await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
    await expect(page.locator('.production-summary')).toContainText('12 件');
    await page.getByRole('button', { name: '登记完工', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('9');
    await page.getByLabel('材料甲实际耗料', { exact: true }).fill('16');
    await page.getByLabel('材料甲耗料差异原因', { exact: true }).fill('调机耗料');
    await page.getByLabel('材料乙实际耗料', { exact: true }).fill('51');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认完工并入库', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('材料乙库存不足');
    await expect(page.getByLabel('材料甲耗料差异原因', { exact: true })).toHaveValue('调机耗料');
    expect(f.inventory()).toEqual(before);
    await expect(page.getByLabel('材料甲实际耗料', { exact: true })).toHaveValue('16');
    await page.getByLabel('材料乙实际耗料', { exact: true }).fill('1.5');
    await page.getByRole('heading', { name: '确认生产完工', exact: true }).click();
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.screenshot({ path: test.info().outputPath('production-completion.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认完工并入库', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('合格成品已入库');
    await expect(page.getByText('已完工', { exact: true })).toBeVisible();
    await expect(page.locator('.production-summary')).toContainText('21.25');
    const analysis = page.getByRole('group', { name: '材料甲耗料差异分析', exact: true });
    await expect(analysis).toContainText('13.5 千克'); await expect(analysis).toContainText('+2.5 千克');
    await expect(analysis).toContainText('+18.518519%'); await expect(analysis).toContainText('调机耗料');
    expect(f.inventory()).toEqual([{ stock: 9, inventory_value_cents: 2125 }, { stock: 84, inventory_value_cents: 10370 }, { stock: 48.5, inventory_value_cents: 4850 }]);
    await page.screenshot({ path: test.info().outputPath('production-detail.png'), fullPage: true });
    await page.getByRole('button', { name: '返回生产单', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索生产单', exact: true }).fill('FINISHED');
    await expect(page.locator('.production-list article')).toHaveCount(1);
    await page.getByRole('button', { name: '查看生产单', exact: false }).click();
    await page.getByRole('button', { name: '作废生产单', exact: true }).click();
    await page.getByLabel('作废原因', { exact: true }).fill('误报完工，退回重新登记');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认作废', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('原成本已回退');
    await expect(page.getByText('已作废', { exact: true })).toBeVisible();
    expect(f.inventory()).toEqual(before);
    expect(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n).toBe(0);
    expect(errors).toEqual([]);
  } finally { await f.close(); }
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} production drafts, shortages, actual completion, cost transfer and controlled reversal`, async ({ page }) => {
    test.setTimeout(60000);
    if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    await productionFlow(page);
  });
}

test('installed mobile PWA completes and reverses a production order with the service worker active', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone, serviceWorkers: 'allow' });
  try { const page = await context.newPage(); await productionFlow(page, true); }
  finally { await context.close(); }
});

test('BOM calculation carries quantity into a production draft and navigation preserves unsaved input', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.goto(f.base + '/#bom');
    await page.getByRole('button', { name: '测算备料', exact: true }).click();
    await page.getByLabel('生产数量', { exact: true }).fill('10');
    await page.getByRole('button', { name: '开始测算', exact: true }).click();
    await page.getByRole('button', { name: '按本次数量新建生产单', exact: true }).click();
    await expect(page).toHaveURL(/#production$/);
    await expect(page.getByLabel('计划产量', { exact: true })).toHaveValue('10');
    await page.getByLabel('生产备注', { exact: true }).fill('离开时保留的备注');
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    await nav.getByRole('link', { name: '生产单', exact: true }).click();
    await expect(page.getByLabel('生产备注', { exact: true })).toHaveValue('离开时保留的备注');
    page.once('dialog', dialog => dialog.dismiss());
    await nav.getByRole('link', { name: 'BOM', exact: true }).click();
    await expect(page).toHaveURL(/#production$/);
    await expect(page.getByLabel('生产备注', { exact: true })).toHaveValue('离开时保留的备注');
    page.once('dialog', dialog => dialog.accept());
    await nav.getByRole('link', { name: 'BOM', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'BOM', exact: true })).toBeVisible();
  } finally { await f.close(); }
});

test('concurrent changes preserve completion input and production-only employees cannot see costs or void actions', async ({ page }) => {
  const f = await fixture(page);
  try {
    const order = await f.post('/production-orders', { bom_id: f.bom.id, bom_version: f.bom.version, planned_quantity: 10, note: '' });
    const user = await f.post('/users', { username: 'producer', password: 'Test-staff-123' });
    expect((await page.request.put(f.base + `/api/users/${user.id}/permissions`, { data: { version: 1, permissions: ['production'] } })).ok()).toBe(true);
    await f.post('/auth/login', { username: 'producer', password: 'Test-staff-123' });
    await page.goto(f.base + '/#production');
    await page.getByRole('button', { name: '查看生产单', exact: false }).click();
    await expect(page.getByRole('button', { name: '作废生产单', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '登记完工', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('9');
    await page.getByLabel('材料甲耗料差异原因', { exact: true }).fill('并发时保留的原因');
    f.db.prepare('UPDATE production_orders SET note=? WHERE id=?').run('另一人已修改', order.id);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认完工并入库', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('生产单已变化');
    await expect(page.getByLabel('材料甲耗料差异原因', { exact: true })).toHaveValue('并发时保留的原因');
    await expect(page.getByLabel('合格成品数量', { exact: true })).toHaveValue('9');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '重新读取生产单', exact: true }).click();
    await expect(page.getByText('另一人已修改', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '登记完工', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认完工并入库', exact: true }).click();
    await expect(page.getByText('已完工', { exact: true })).toBeVisible();
    await expect(page.getByText('材料成本合计', { exact: true })).toHaveCount(0);
    await expect(page.getByText('材料成本', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '作废生产单', exact: true })).toHaveCount(0);
  } finally { await f.close(); }
});

async function scrapProductionFlow(page, pwa = false) {
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const scrap = await f.post('/products', { name: '废料甲', barcode: 'SCRAP-A', category: '废料', unit: '千克', cost: 5, price: 10, threshold: 0 });
    const dust = await f.post('/products', { name: '废料乙', barcode: 'SCRAP-B', category: '废料', unit: '件', cost: 5, price: 10, threshold: 0 });
    const before = f.inventory();
    await page.goto(f.base + '/#bom');
    if (pwa) await page.evaluate(() => navigator.serviceWorker.ready);
    await expect(page.getByRole('heading', { name: 'BOM', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索废料', exact: true }).fill('SCRAP-A');
    await page.getByRole('button', { name: '添加废料 废料甲', exact: true }).click();
    await page.getByRole('combobox', { name: '废料甲计算方式', exact: true }).click();
    await page.getByRole('option', { name: '按材料投入比例', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '废料甲来源材料', exact: true })).toHaveValue('材料甲');
    await page.getByLabel('废料甲废料比例', { exact: true }).fill('5');
    await page.getByRole('searchbox', { name: '搜索废料', exact: true }).fill('SCRAP-B');
    await page.getByRole('button', { name: '按条码添加废料', exact: true }).click();
    await page.getByLabel('废料乙基准废料量', { exact: true }).fill('1/3');
    await page.screenshot({ path: test.info().outputPath('bom-scrap-rules.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '保存BOM', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('BOM已保存');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByLabel('废料乙基准废料量', { exact: true })).toHaveValue('1/3');
    await expect(page.getByLabel('废料甲废料比例', { exact: true })).toHaveValue('5');
    await page.getByRole('button', { name: '返回BOM', exact: true }).click();
    await page.getByRole('button', { name: '测算备料', exact: true }).click();
    await page.getByLabel('生产数量', { exact: true }).fill('10');
    await page.getByRole('button', { name: '开始测算', exact: true }).click();
    await expect(page.locator('.scrap-output').first()).toContainText('0.75 千克');
    await expect(page.locator('.scrap-output').nth(1)).toContainText('1.666667 件');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出备料表', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/备料表/);
    await page.getByRole('button', { name: '按本次数量新建生产单', exact: true }).click();
    await page.getByLabel('计划产量', { exact: true }).fill('12');
    await expect(page.locator('.scrap-output').first()).toContainText('0.9 千克');
    await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
    expect(f.inventory()).toEqual(before);
    await page.getByRole('button', { name: '登记完工', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('9');
    await page.getByLabel('材料甲实际耗料', { exact: true }).fill('16');
    await expect(page.locator('.scrap-output').first()).toContainText('完工预计0.8 千克');
    await expect(page.getByLabel('废料甲实际废料', { exact: true })).toHaveValue('0.9');
    await page.getByRole('button', { name: '废料甲采用预计数量', exact: true }).click();
    await expect(page.getByLabel('废料甲实际废料', { exact: true })).toHaveValue('0.8');
    await page.getByLabel('废料甲实际废料', { exact: true }).fill('0.9');
    await page.getByLabel('废料乙实际废料', { exact: true }).fill('1.4');
    await page.getByRole('combobox', { name: '废料乙处理方式', exact: true }).click();
    await page.getByRole('option', { name: '直接处置', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('production-scrap-completion.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认完工并入库', exact: true }).click();
    await expect(page.getByRole('heading', { name: '废料产出记录', exact: true })).toBeVisible();
    await expect(page.locator('.scrap-output').first()).toContainText('+0.1 千克');
    expect(f.db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(scrap.id)).toEqual({ stock: 0.9, inventory_value_cents: 0 });
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(dust.id).stock).toBe(0);
    await page.getByRole('button', { name: '作废生产单', exact: true }).click();
    await page.getByLabel('作废原因', { exact: true }).fill('核对后整单回退');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认作废', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('原成本已回退');
    expect(f.inventory()).toEqual(before);
    expect(errors).toEqual([]);
  } finally { await f.close(); }
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} configures independent BOM scrap rules and calculates, confirms, posts and reverses waste outputs`, async ({ page }) => {
    test.setTimeout(60000);
    if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    await scrapProductionFlow(page);
  });
}

test('mobile PWA runs scrap production with an active service worker', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone, serviceWorkers: 'allow' });
  try { await scrapProductionFlow(await context.newPage(), true); }
  finally { await context.close(); }
});


async function varianceFlow(page, pwa = false) {
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const bom = await f.post(`/boms/${f.bom.id}`, { ...f.definition, version: f.bom.version, base_quantity: 1,
      items: [{ product_id: f.products[1].id, quantity: 0.333334, quantity_fraction: '1/3', unit: '千克', note: '' },
        { product_id: f.products[2].id, quantity: 0.2, unit: '米', note: '' }] });
    const order = await f.post('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, note: '' });
    await f.post(`/boms/${bom.id}`, { ...f.definition, version: bom.version, base_quantity: 1,
      items: [{ product_id: f.products[1].id, quantity: 99, unit: '千克', note: '' }] });
    const before = f.inventory();
    await page.goto(f.base + '/#production');
    if (pwa) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: '查看生产单', exact: false }).click();
    await expect(page.locator('.production-variance')).toHaveCount(0);
    await page.getByRole('button', { name: '登记完工', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('3');
    await page.getByLabel('材料甲实际耗料', { exact: true }).fill('1.2');
    await page.getByLabel('材料乙实际耗料', { exact: true }).fill('0');
    await page.getByLabel('材料甲耗料差异原因', { exact: true }).fill('调机\n额外用料');
    await page.getByLabel('材料乙耗料差异原因', { exact: true }).fill('本次未使用');
    const first = page.getByRole('group', { name: '材料甲耗料差异分析', exact: true });
    const second = page.getByRole('group', { name: '材料乙耗料差异分析', exact: true });
    await expect(first).toContainText('标准耗料（按合格产量）1 千克');
    await expect(first).toContainText('超耗+0.2 千克'); await expect(first).toContainText('+20%');
    await expect(second).toContainText('节省-0.6 米'); await expect(second).toContainText('-100%');
    await page.getByLabel('合格成品数量', { exact: true }).fill('6');
    await expect(first).toContainText('标准耗料（按合格产量）2 千克');
    await expect(first).toContainText('节省-0.8 千克'); await expect(first).toContainText('-40%');
    await expect(page.getByLabel('材料甲耗料差异原因', { exact: true })).toHaveValue('调机\n额外用料');
    await page.getByLabel('合格成品数量', { exact: true }).fill('');
    await expect(first).toContainText('请先填写有效的合格成品数量和实际耗料');
    await page.getByLabel('合格成品数量', { exact: true }).fill('3');
    await page.getByLabel('材料甲实际耗料', { exact: true }).fill('1');
    await expect(first).toContainText('无差异0 千克'); await expect(first).toContainText('差异率0%');
    await page.getByLabel('材料甲实际耗料', { exact: true }).fill('1.2');
    await page.screenshot({ path: test.info().outputPath('production-variance-completion.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.inventory()).toEqual(before);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认完工并入库', exact: true }).click();
    await expect(page.getByText('已完工', { exact: true })).toBeVisible();
    await expect(first).toContainText('超耗+0.2 千克'); await expect(first).toContainText('调机');
    expect(f.db.prepare('SELECT variance_reason FROM production_items WHERE production_id=? ORDER BY position').all(order.id).map(row => row.variance_reason)).toEqual(['调机\n额外用料', '本次未使用']);
    expect(f.inventory().map(row => row.stock)).toEqual([3, 98.8, 50]);
    await page.reload();
    await page.getByRole('button', { name: '查看生产单', exact: false }).click();
    await expect(first).toContainText('+20%'); await expect(second).toContainText('本次未使用');
    await page.screenshot({ path: test.info().outputPath('production-variance-detail.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '作废生产单', exact: true }).click();
    await page.getByLabel('作废原因', { exact: true }).fill('保留差异分析供核对');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '确认作废', exact: true }).click();
    await expect(page.getByText('已作废', { exact: true })).toBeVisible();
    await expect(first).toContainText('额外用料');
    expect(f.inventory()).toEqual(before);
    expect(errors).toEqual([]);
  } finally { await f.close(); }
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} compares actual output to saved fractional recipes and preserves reasons through completion and void`, async ({ page }) => {
    test.setTimeout(60000);
    if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    await varianceFlow(page);
  });
}

test('mobile PWA analyzes consumption differences and persists reasons with the service worker active', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone, serviceWorkers: 'allow' });
  try { await varianceFlow(await context.newPage(), true); }
  finally { await context.close(); }
});
