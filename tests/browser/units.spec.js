import { chooseOption } from "./dropdown-helpers.js";
import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

test('configure units, reload, use a custom unit and preserve a removed unit on existing products', async ({ page }) => {
  const original = (await (await page.request.get('/api/data')).json()).settings;
  try {
    await page.goto('/#products');
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    const manager = page.getByRole('region', { name: '计量单位管理' });
    await manager.getByRole('textbox', { name: '单位 1（默认）', exact: true }).fill('套');
    await manager.getByRole('button', { name: '新增单位', exact: true }).click();
    await manager.getByRole('textbox').last().fill('瓶');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: '新增商品', exact: true }).first().click();
    const select = page.getByRole('combobox', { name: /计量单位/ });
    await expect(select).toHaveValue('套');
    await select.click();
    await expect(page.getByRole('option', { name: '个', exact: true })).toHaveCount(0);
    await select.press('Escape');
    await chooseOption(select, '瓶');
    await page.getByPlaceholder('例如：极简陶瓷马克杯').fill('自定义单位商品');
    await page.getByPlaceholder('扫描或输入条码，可留空').fill('TEST-UNITS-001');
    await page.getByRole('spinbutton', { name: /采购价/ }).fill('1');
    await page.getByRole('spinbutton', { name: /销售价/ }).fill('2');
    await page.getByRole('button', { name: '保存商品', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const product = await (await page.request.get('/api/products/barcode/TEST-UNITS-001')).json();
    expect(product.unit).toBe('瓶');
    await page.getByRole('textbox', { name: '筛选商品' }).fill('6901234567001');
    await page.locator('.product-table tbody tr').getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /计量单位/ })).toHaveValue('个');
    await page.getByRole('button', { name: '保存商品', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await (await page.request.get('/api/products/barcode/6901234567001')).json()).unit).toBe('个');
  } finally {
    await page.request.put('/api/settings', { data: original });
  }
});

test('unit settings fit a narrow viewport and deleting units keeps at least one', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#products');
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  const manager = page.getByRole('region', { name: '计量单位管理' });
  await expect(manager).toBeVisible();
  while (await manager.getByRole('textbox').count() > 1) {
    await manager.getByRole('button', { name: /删除单位/ }).last().click();
  }
  await expect(manager.getByRole('button', { name: '删除单位 1', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
