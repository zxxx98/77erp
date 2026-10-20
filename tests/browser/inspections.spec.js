import { test, expect, devices } from '@playwright/test';
import { chooseOption } from './dropdown-helpers.js';
import { inspectionToday, nextInspectionDate } from '../../shared/inspection.js';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

for (const device of [null, 'Pixel 7', 'iPhone 13']) {
  test(`${device || 'desktop'} configures inspections, renews a cycle and manually enters a one-off next date`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', serviceWorkers: device === 'iPhone 13' ? 'allow' : 'block', ...(device ? devices[device] : { viewport: { width: 1440, height: 1000 } }) });
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const suffix = `${(device || 'desktop').replaceAll(' ', '-')}-${Date.now()}`;
    const name = `校验量具-${suffix}`, manualName = `手动校验-${suffix}`;
    try {
      await page.goto('/#products');
      await page.getByRole('button', { name: '新增物料', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('例如：RVV 护套电线').fill(name);
      await dialog.getByRole('spinbutton', { name: /参考采购价/ }).fill('10');
      await dialog.getByRole('spinbutton', { name: /参考销售价/ }).fill('20');
      await expect(dialog.getByRole('spinbutton', { name: '校验周期', exact: true })).toBeDisabled();
      await dialog.getByLabel('下次校验日期', { exact: true }).fill(inspectionToday());
      await dialog.getByRole('spinbutton', { name: '校验周期', exact: true }).fill('6');
      await chooseOption(dialog.getByRole('combobox', { name: '周期单位', exact: true }), 'month');
      await dialog.getByRole('button', { name: '保存物料', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const products = await (await context.request.get(`/api/products?q=${encodeURIComponent(name)}`)).json();
      const product = products.products.find(p => p.name === name);
      expect(product.inspection_interval).toBe(6);
      expect(product.inspection_date).toBe(inspectionToday());
      const created = await context.request.post('/api/products', { data: { name: manualName, category: '量具', unit: '件', cost: 10, price: 20, threshold: 0, inspection_date: '2000-01-01' } });
      expect(created.status()).toBe(201);
      const manual = await created.json();
      await page.goto('/#overview');
      const panel = page.getByRole('region', { name: '待校验物料', exact: true });
      await expect(panel).toContainText(name);
      await expect(panel).toContainText(manualName);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/77erp-inspections-${device || 'desktop'}.png`, fullPage: true });
      await panel.getByRole('button', { name: `已校验：${name}`, exact: true }).click();
      const completion = page.getByRole('dialog', { name: '记录已校验', exact: true });
      await expect(completion.getByLabel('实际校验日期', { exact: true })).toHaveValue(inspectionToday());
      await completion.getByRole('button', { name: '取消', exact: true }).click();
      expect((await (await context.request.get(`/api/products/${product.id}`)).json()).product.last_inspected_on).toBe('');
      await panel.getByRole('button', { name: `已校验：${name}`, exact: true }).click();
      const inspectedOn = nextInspectionDate(inspectionToday(), -3, 'day');
      await completion.getByLabel('实际校验日期', { exact: true }).fill(inspectedOn);
      await expect(completion).toContainText(nextInspectionDate(inspectedOn, 6, 'month'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await completion.getByRole('button', { name: '完成', exact: true }).click();
      await expect(completion).toHaveCount(0);
      await expect(panel.getByRole('button', { name: `已校验：${name}`, exact: true })).toHaveCount(0);
      await expect(panel.getByRole('status')).toContainText(nextInspectionDate(inspectedOn, 6, 'month'));
      const saved = (await (await context.request.get(`/api/products/${product.id}`)).json()).product;
      expect(saved.last_inspected_on).toBe(inspectedOn);
      expect(saved.inspection_date).toBe(nextInspectionDate(inspectedOn, 6, 'month'));
      await panel.getByRole('button', { name: `已校验：${manualName}`, exact: true }).click();
      const next = page.getByRole('dialog', { name: '记录已校验', exact: true });
      await expect(next).toContainText('此物料未配置周期');
      await expect(next.getByLabel('实际校验日期', { exact: true })).toHaveValue(inspectionToday());
      await next.getByRole('button', { name: '取消', exact: true }).click();
      await expect(panel.getByRole('button', { name: `已校验：${manualName}`, exact: true })).toBeVisible();
      await panel.getByRole('button', { name: `已校验：${manualName}`, exact: true }).click();
      await next.getByLabel('实际校验日期', { exact: true }).fill(inspectedOn);
      await next.getByLabel('下次校验日期', { exact: true }).fill('2099-12-31');
      await next.getByRole('button', { name: '完成', exact: true }).click();
      await expect(next).toHaveCount(0);
      await expect(panel.getByRole('status')).toContainText('2099-12-31');
      await expect(panel.getByRole('button', { name: `已校验：${manualName}`, exact: true })).toHaveCount(0);
      const savedManual = (await (await context.request.get(`/api/products/${manual.id}`)).json()).product;
      expect(savedManual.inspection_date).toBe('2099-12-31');
      expect(savedManual.last_inspected_on).toBe(inspectedOn);
      await page.reload();
      await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: `已校验：${name}`, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: `已校验：${manualName}`, exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
