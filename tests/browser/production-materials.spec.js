import { browserPosition } from './position-helpers.js';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'materialsadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = await post('/products', { name: '领料成品', barcode: 'OUTPUT', category: '生产', unit: '件', cost: 0, price: 2, threshold: 0 });
  const material = await post('/products', { name: '生产原料', barcode: 'INPUT', category: '生产', unit: '千克', cost: 2, price: 3, threshold: 0 });
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=20000 WHERE id=?').run(material.id);
  const bom = await post('/boms', { name: '领料配方', product_id: product.id, base_quantity: 1, base_unit: '件', note: '', enabled: 1,
    items: [{ product_id: material.id, quantity: 2, unit: '千克', note: '' }] });
  const order = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 5, note: '审批流程' });
  const stock = () => db.prepare('SELECT stock FROM products WHERE id=?').get(material.id).stock;
  return { base, db, post, product, material, order, stock, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
  } };
}

for (const mobile of [false, true, 'pwa']) test(`${mobile === 'pwa' ? 'PWA' : mobile ? 'mobile' : 'desktop'} production issue approval, registration and material return`, async ({ page, browser }) => {
  test.setTimeout(90000);
  const context = mobile === 'pwa' ? await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, userAgent: iphone }) : null;
  if (context) page = await context.newPage();
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${f.base}/#production`);
    if (context) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await expect(page.getByRole('button', { name: '登记', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '开始生产', exact: true }).click();
    await expect(page.getByLabel('生产原料领料数量', { exact: true })).toHaveValue('10');
    await page.getByRole('button', { name: '提交领料申请', exact: true }).click();
    await expect(page.getByText('待领料', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    const ledger = page.getByRole('table', { name: '生产物料台账', exact: true });
    await expect(ledger).toBeVisible();
    await expect(ledger.getByText('生产原料', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '计划备料', exact: true })).toHaveCount(0);
    const item = ledger.locator('tbody').filter({ hasText: '生产原料' });
    await expect(item.locator('[data-field="planned_quantity"]')).toContainText('10');
    await expect(item.locator('[data-field="pending_issue_quantity"]')).toContainText('10');
    await expect(item.locator('[data-field="available_quantity"]')).toContainText('0');
    await item.getByRole('button', { name: '查看详情 生产原料', exact: true }).click();
    await expect(item).toContainText('基准净用量');
    await expect(item).toContainText('累计申请');
    await item.getByRole('button', { name: '收起详情 生产原料', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath('production-material-ledger.png'), fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByText(/请前往仓库领料/).first()).toBeVisible();
    expect(f.stock()).toBe(100);
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    await page.getByRole('button', { name: '前往出库', exact: true }).click();
    const queue = page.getByRole('region', { name: '生产领料出库单', exact: true });
    await expect(queue.getByText(f.order.number, { exact: false })).toBeVisible();
    await queue.getByRole('button', { name: /查看并审批/ }).click();
    await expect(page.getByRole('dialog').getByText('10 千克', { exact: true })).toBeVisible();
    await page.getByLabel('生产原料本次实发数量', { exact: true }).fill('4');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog').getByRole('button', { name: '批准并确认出库', exact: true }).click();
    await expect(queue.getByText('部分已发', { exact: true })).toBeVisible();
    expect(f.stock()).toBe(96);
    await page.goto(`${f.base}/#production`);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await expect(page.getByRole('button', { name: '登记', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '登记', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('1');
    await page.getByLabel('生产原料实际耗料', { exact: true }).fill('2');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '本批登记并继续生产', exact: true }).click();
    expect(f.stock()).toBe(96);
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    await page.getByRole('button', { name: '前往出库', exact: true }).click();
    await queue.getByRole('button', { name: /查看并审批/ }).click();
    await expect(page.getByLabel('生产原料本次实发数量', { exact: true })).toHaveValue('6');
    await expect(page.getByRole('region', { name: '发料记录', exact: true })).toContainText('4 千克');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog').getByRole('button', { name: '批准并确认出库', exact: true }).click();
    await expect(queue.getByRole('status').filter({ hasText: '已出库' })).toBeVisible();
    expect(f.stock()).toBe(90);
    await page.goto(`${f.base}/#production`);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await expect(page.getByText('生产中', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '登记', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('3');
    await page.getByLabel('生产原料实际耗料', { exact: true }).fill('6');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '本批登记并结束生产', exact: true }).click();
    await expect(page.getByText('已完工', { exact: true })).toBeVisible();
    expect(f.stock()).toBe(90);
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.product.id).stock).toBe(0);
    await expect(page.getByRole('region', { name: '生产入库进度' })).toContainText('待入库');
    await expect(page.getByText(/生产已结束，待仓库入库/)).toBeVisible();
    await page.getByRole('tab', { name: '完工与入库', exact: true }).click();
    await page.getByRole('button', { name: '查看第 1 批入库单', exact: true }).click();
    await expect(page).toHaveURL(/#production$/);
    await expect(page.locator('[id^="production-receipt-"]').first()).toBeFocused();
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    await expect(item.locator('[data-field="issued_quantity"]')).toContainText('10');
    await expect(item.locator('[data-field="used_quantity"]')).toContainText('8');
    await expect(item.locator('[data-field="available_quantity"]')).toContainText('2');
    await item.getByRole('button', { name: '查看详情 生产原料', exact: true }).click();
    await expect(item.getByRole('group', { name: '生产原料耗料差异分析', exact: true })).toBeVisible();
    await expect(item).toContainText('材料成本');
    await page.getByRole('button', { name: '申请退料', exact: true }).click();
    await page.getByLabel('生产原料退料数量', { exact: true }).fill('2');
    await page.getByRole('button', { name: '提交退料申请', exact: true }).click();
    await expect(page.getByRole('status').first()).toContainText('退料申请已提交');
    expect(f.stock()).toBe(90);
    await page.getByRole('tab', { name: '完工与入库', exact: true }).click();
    await page.getByRole('button', { name: '前往入库审批', exact: true }).click();
    const receipts = page.getByRole('region', { name: '生产成品入库单', exact: true });
    await expect(receipts.getByText(f.order.number, { exact: false })).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath('production-receipt-pending.png'), fullPage: true });
    for (const remaining of [1, 0]) {
      await receipts.getByRole('button', { name: /查看并审批/ }).first().click();
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('dialog').getByRole('button', { name: '批准并确认入库', exact: true }).click();
      await expect(receipts.getByRole('button', { name: /查看并审批/ })).toHaveCount(remaining);
    }
    expect(f.db.prepare('SELECT stock,inventory_value_cents FROM products WHERE id=?').get(f.product.id)).toEqual({ stock: 4, inventory_value_cents: 1600 });
    await page.getByRole('tab', { name: /退料待入库/ }).click();
    const returns = page.getByRole('region', { name: '生产退料入库单', exact: true });
    await returns.getByRole('button', { name: /查看并审批/ }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog').getByRole('button', { name: '批准并确认入库', exact: true }).click();
    await expect(returns.getByRole('status').filter({ hasText: '已入库' })).toBeVisible();
    expect(f.stock()).toBe(92);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('material-approval.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await f.close(); await context?.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} multiple batches wait for inbound-only warehouse approval`, async ({ page }) => {
  test.setTimeout(90000);
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page);
  try {
    const started = await f.post(`/production-orders/${f.order.id}/start`, { version: f.order.version });
    await f.post(`/production-material-documents/${started.material_documents[0].id}/confirm`, { version: started.material_documents[0].version });
    const producer = await f.post('/users', { position_id: await browserPosition(page.request, ['production'], f.base), username: 'receiptproducer', password: 'Test-producer-123' });
    const warehouse = await f.post('/users', { position_id: await browserPosition(page.request, ['basic_view', 'purchase'], f.base), username: 'receiptwarehouse', password: 'Test-warehouse-123' });
    await f.post('/auth/login', { username: 'receiptproducer', password: 'Test-producer-123' });
    await page.goto(`${f.base}/#production`);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    for (const finish of [false, true]) {
      await page.getByRole('button', { name: '登记', exact: true }).click();
      await page.getByLabel('合格成品数量', { exact: true }).fill('2');
      await page.getByLabel('生产原料实际耗料', { exact: true }).fill('4');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: finish ? '本批登记并结束生产' : '本批登记并继续生产', exact: true }).click();
      await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    }
    await expect(page.getByText(/生产已结束，待仓库入库/)).toBeVisible();
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.product.id).stock).toBe(0);
    await expect(page.getByRole('button', { name: '前往入库', exact: true })).toHaveCount(0);
    await f.post('/auth/login', { username: 'receiptwarehouse', password: 'Test-warehouse-123' });
    await page.goto(`${f.base}/#purchases`);
    // API login changes the cookie; reload to initialize the new user's UI permissions.
    await page.reload();
    await page.getByRole('tab', { name: /成品待入库/ }).click();
    const receipts = page.getByRole('region', { name: '生产成品入库单', exact: true });
    await expect(receipts.getByRole('button', { name: /查看并审批/ })).toHaveCount(2);
    for (const stock of [2, 4]) {
      await receipts.getByRole('button', { name: /查看并审批/ }).first().click();
      await expect(page.getByRole('dialog').getByText(/成本/)).toHaveCount(0);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('dialog').getByRole('button', { name: '批准并确认入库', exact: true }).click();
      await expect.poll(() => f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.product.id).stock).toBe(stock);
      await expect(receipts.getByRole('button', { name: /查看并审批/ })).toHaveCount(stock === 2 ? 1 : 0);
    }
    expect(f.stock()).toBe(90);
    expect((await page.request.get(`${f.base}/api/production-orders/${f.order.id}`)).status()).toBe(403);
    const response = await page.request.get(`${f.base}/api/production-receipts?status=confirmed`);
    const body = await response.json();
    expect(body.documents).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('cost_cents');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('warehouse-receipts.png'), fullPage: true });
  } finally { await f.close(); }
});

test('warehouse staff can approve issues without production or finance permission', async ({ page }) => {
  const f = await fixture(page);
  try {
    await f.post(`/production-orders/${f.order.id}/start`, { version: f.order.version });
    const user = await f.post('/users', { position_id: await browserPosition(page.request, ['basic_view', 'sale'], f.base), username: 'warehouseonly', password: 'Warehouse-test-123' });
    await f.post('/auth/logout', {});
    await f.post('/auth/login', { username: 'warehouseonly', password: 'Warehouse-test-123' });
    await page.goto(`${f.base}/#sales`);
    await page.getByRole('tab', { name: /领料.*补料待出库/ }).click();
    const queue = page.getByRole('region', { name: '生产领料出库单', exact: true });
    await queue.getByRole('button', { name: /查看并审批/ }).click();
    await expect(page.getByRole('dialog').getByText(/材料成本/)).toHaveCount(0);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog').getByRole('button', { name: '批准并确认出库', exact: true }).click();
    await expect(queue.getByRole('status').filter({ hasText: '已出库' })).toBeVisible();
    expect(f.stock()).toBe(90);
    expect((await page.request.get(`${f.base}/api/production-orders/${f.order.id}`)).status()).toBe(403);
    expect((await page.request.get(`${f.base}/api/production-material-documents?type=in`)).status()).toBe(403);
  } finally { await f.close(); }
});

test('production can request and cancel supplements without changing warehouse stock', async ({ page }) => {
  const f = await fixture(page);
  try {
    // Issue the entire warehouse stock: the detail must use the issued balance,
    // not report a warehouse shortage for material already at production.
    f.db.prepare('UPDATE products SET stock=10,inventory_value_cents=2000 WHERE id=?').run(f.material.id);
    const started = await f.post(`/production-orders/${f.order.id}/start`, { version: f.order.version });
    const doc = started.material_documents[0];
    await f.post(`/production-material-documents/${doc.id}/confirm`, { version: doc.version });
    await page.goto(`${f.base}/#production`);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    await expect(page.getByRole('table', { name: '生产物料台账', exact: true })).toBeVisible();
    await expect(page.locator('.production-ledger .bom-shortage')).toHaveCount(0);
    await page.getByRole('button', { name: '申请补料', exact: true }).click();
    await page.getByLabel('生产原料补料数量', { exact: true }).fill('3');
    await page.getByRole('button', { name: '提交补料申请', exact: true }).click();
    await expect(page.getByRole('status').first()).toContainText('补料申请已提交');
    await expect(page.getByRole('button', { name: '申请补料', exact: true })).toBeDisabled();
    const materials = page.getByRole('region', { name: '生产领退料' });
    await materials.getByRole('button', { name: '取消申请', exact: true }).click();
    await materials.getByLabel('取消申请原因', { exact: true }).fill('暂不需要额外材料');
    await materials.getByRole('button', { name: '确认取消申请', exact: true }).click();
    await expect(page.getByRole('status').first()).toContainText('材料申请已取消');
    await expect(page.getByRole('button', { name: '申请补料', exact: true })).toBeEnabled();
    expect(f.stock()).toBe(0);
  } finally { await f.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} initial subset and closing an issued request preserve production progress`, async ({ page }) => {
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page);
  try {
    await page.goto(`${f.base}/#production`);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await page.getByRole('button', { name: '开始生产', exact: true }).click();
    await page.getByLabel('生产原料领料数量', { exact: true }).fill('6');
    await page.getByRole('button', { name: '提交领料申请', exact: true }).click();
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    await page.getByRole('button', { name: '前往出库', exact: true }).click();
    const queue = page.getByRole('region', { name: '生产领料出库单', exact: true });
    await queue.getByRole('button', { name: /查看并审批/ }).click();
    await page.getByLabel('生产原料本次实发数量', { exact: true }).fill('2');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog').getByRole('button', { name: '批准并确认出库', exact: true }).click();
    await expect(queue.getByText('部分已发', { exact: true })).toBeVisible();
    expect(f.stock()).toBe(98);
    await page.goto(`${f.base}/#production`);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await page.getByRole('tab', { name: '物料', exact: true }).click();
    const materials = page.getByRole('region', { name: '生产领退料', exact: true });
    await materials.getByRole('button', { name: '关闭剩余待发', exact: true }).click();
    await materials.getByLabel('取消申请原因', { exact: true }).fill('按本批实际数量结束');
    await materials.getByRole('button', { name: '确认关闭剩余待发', exact: true }).click();
    await expect(page.getByRole('status').first()).toContainText('剩余待发已关闭');
    await expect(page.getByText('生产中', { exact: true })).toBeVisible();
    await expect(materials.getByText('已关闭', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '申请补料', exact: true })).toBeEnabled();
    expect(f.stock()).toBe(98);
    await page.getByRole('button', { name: '登记', exact: true }).click();
    await page.getByLabel('合格成品数量', { exact: true }).fill('1');
    await page.getByLabel('生产原料实际耗料', { exact: true }).fill('2');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '本批登记并结束生产', exact: true }).click();
    await expect(page.getByText('已完工', { exact: true })).toBeVisible();
    expect(f.stock()).toBe(98);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.close(); }
});
