import { test, expect, devices } from '@playwright/test';
import { resolve } from 'node:path';

test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201,409]).toContain(r.status());
});
for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} AI settings, Excel, transfer, stocktake confirmations and conversation recovery`, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1440, height: 1000 } }) });
  try {
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const warehouse = await (await context.request.post('/api/warehouses', { data: { name: `AI-${mobile}-${Date.now()}` } })).json();
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?warehouse_id=${warehouse.id}`);
    if (mobile) { await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click(); }
    else await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^AI 助手/ }).click();
    const settings = page.locator('.ai-settings');
    await settings.getByLabel('启用 AI 助手').check();
    await settings.getByLabel('API 基础地址').fill('https://ai.77erp.test/v1');
    await settings.getByLabel('模型名称').fill('test-model');
    await settings.getByLabel('API Key').fill('browser-test-key');
    await settings.getByRole('button', { name: '保存并测试连接', exact: true }).click();
    await expect(settings.getByText('配置已保存，连接测试成功。')).toBeVisible();
    await expect(settings.getByLabel('API Key')).toHaveValue('');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await page.getByLabel('附加物料 Excel / CSV').setInputFiles(resolve('tests/fixtures/products.xlsx'));
    await expect(page.getByText('products.xlsx · 1 行')).toBeVisible();
    await page.getByLabel('你的需求').fill('导入上传表，新增物料档案，数量为期初库存。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const action = page.locator('.ai-action');
    await expect(action).toContainText('新增物料预览 · 待确认');
    await expect(action).toContainText('001234');
    const before = await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json();
    expect(before.products).toHaveLength(0);
    await action.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(action).toContainText('已完成，新增 1 个物料');
    const after = await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json();
    expect(after.products).toHaveLength(1); expect(after.products[0].barcode).toBe('001234'); expect(after.products[0].stock).toBe(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    if (mobile) await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-action')).toContainText('已完成，新增 1 个物料');
    const target = await (await context.request.post('/api/warehouses', { data: { name: `AI-target-${mobile}-${Date.now()}` } })).json();
    await page.getByRole('button', { name: '开始新对话' }).click();
    await page.getByLabel('你的需求').fill('调拨参数：' + JSON.stringify({ warehouse_id: warehouse.id, to_warehouse_id: target.id, reason: '门店补货', items: [{ product_id: after.products[0].id, quantity: 2 }] }));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.ai-action')).toContainText('仓库调拨预览 · 待确认');
    await expect(page.locator('.ai-action')).toContainText('将新建物料档案');
    await expect(page.locator('.ai-action')).toContainText('7 → 5');
    await page.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(page.locator('.ai-action')).toContainText('仓库调拨预览 · 已完成');
    const moved = await (await context.request.get(`/api/data?warehouse_id=${target.id}`)).json();
    expect(moved.products[0].stock).toBe(2);
    await page.getByRole('button', { name: '开始新对话' }).click();
    await page.getByLabel('你的需求').fill('盘点参数：' + JSON.stringify({ warehouse_id: warehouse.id, reason: '月末实盘', items: [{ product_id: after.products[0].id, counted: 3 }] }));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.ai-action')).toContainText('库存盘点预览 · 待确认');
    await expect(page.locator('.ai-action')).toContainText('-2');
    await page.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(page.locator('.ai-action')).toContainText('已完成，已盘点 1 种物料');
    const counted = await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json();
    expect(counted.products[0].stock).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
