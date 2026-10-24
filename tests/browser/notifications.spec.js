import { test, expect, devices } from '@playwright/test';
import { chooseOption } from './dropdown-helpers.js';

test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(r.status());
});
for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} notification settings persist selections and send only subscribed events`, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1440, height: 1000 } }) });
  await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
  const reset = async () => {
    const config = await (await context.request.get('/api/settings/notifications')).json();
    expect((await context.request.put('/api/settings/notifications', { data: { ...config, enabled: false, events: [], warehouse_ids: [], include_amounts: false, clear_url: true, clear_secret: true } })).ok()).toBe(true);
  };
  await reset();
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const open = async () => {
    await page.goto('/');
    if (mobile) { await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click(); }
    else await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: /^通知设置/ }).click();
  };
  try {
    await open();
    const section = page.getByRole('region', { name: '通知设置' });
    await expect(section.getByLabel('启用 Webhook 通知')).not.toBeChecked();
    await section.getByLabel('启用 Webhook 通知').check();
    await chooseOption(section.getByLabel('通知格式'), 'wecom');
    await section.getByLabel('Webhook 地址', { exact: true }).fill('https://hooks.77erp.test/send?key=browser-secret');
    await section.getByRole('checkbox', { name: /^入库/ }).check();
    await section.getByRole('checkbox', { name: /^低库存预警/ }).check();
    await section.getByRole('button', { name: '保存通知设置', exact: true }).click();
    await expect(section.getByText('通知设置已保存。')).toBeVisible();
    await expect(section.getByLabel('Webhook 地址', { exact: true })).toHaveValue('');
    const saved = await (await context.request.get('/api/settings/notifications')).json();
    expect(saved.events).toEqual(['purchase_in', 'low_stock']); expect(saved.format).toBe('wecom');
    expect(JSON.stringify(saved)).not.toContain('browser-secret');
    if (!mobile) {
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/settings/notifications/test') && r.request().method() === 'POST'),
        section.getByRole('button', { name: '发送测试通知', exact: true }).click(),
      ]);
      expect(response.status()).toBe(202);
      const { id } = await response.json();
      await expect(section.getByText('发送记录有变更，点击“刷新记录”查看。')).toBeVisible({ timeout: 12000 });
      await section.getByRole('button', { name: '刷新记录', exact: true }).click();
      await expect(section.locator(`[data-delivery-id="${id}"]`)).toContainText('已发送', { timeout: 12000 });
    }
    await open();
    await expect(section.getByRole('checkbox', { name: /^入库/ })).toBeChecked();
    await expect(section.getByRole('checkbox', { name: /^出库/ })).not.toBeChecked();
    const product = await (await context.request.post('/api/products', { data: { name: '通知验证物料', category: '通知验证', unit: '个', cost: 10, price: 20, threshold: 2 } })).json();
    expect((await context.request.post('/api/orders', { data: { type: 'in', partner: '通知验证供应商', items: [{ product_id: product.id, quantity: 5, price: 10 }] } })).ok()).toBe(true);
    const delivery = (await (await context.request.get('/api/settings/notifications/deliveries')).json()).find(row => row.event === 'purchase_in');
    await expect(section.getByText('发送记录有变更，点击“刷新记录”查看。')).toBeVisible({ timeout: 12000 });
    await expect(section.locator(`[data-delivery-id="${delivery.id}"]`)).toHaveCount(0);
    await section.getByRole('button', { name: '刷新记录', exact: true }).click();
    await expect(section.locator(`[data-delivery-id="${delivery.id}"]`)).toContainText('已发送', { timeout: 12000 });
    await section.getByRole('checkbox', { name: /^入库/ }).uncheck();
    await section.getByRole('button', { name: '保存通知设置', exact: true }).click();
    await expect(section.getByText('通知设置已保存。')).toBeVisible();
    const count = (await (await context.request.get('/api/settings/notifications/deliveries')).json()).length;
    expect((await context.request.post('/api/orders', { data: { type: 'in', partner: '通知验证供应商', items: [{ product_id: product.id, quantity: 5, price: 10 }] } })).ok()).toBe(true);
    expect((await (await context.request.get('/api/settings/notifications/deliveries')).json()).length).toBe(count);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    if (mobile) await page.screenshot({ path: '/tmp/77erp-notifications-mobile.png', fullPage: true });
  } finally { await reset(); await context.close(); }
});
