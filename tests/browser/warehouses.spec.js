import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201,409]).toContain(res.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

test('create and rename a warehouse, selectively sync a product, switch and persist independent inventories', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const suffix = Date.now();
  const name = `网页分仓-${suffix}`;
  await page.goto('/#products');
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByRole('textbox', { name: '新仓库名称', exact: true }).fill(name);
  await page.getByRole('button', { name: '新增仓库', exact: true }).click();
  const row = page.locator('.warehouse-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '改名', exact: true }).click();
  const renamed = `${name}-改名`;
  await page.getByRole('textbox', { name: `修改${name}名称`, exact: true }).fill(renamed);
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.locator('.warehouse-row').filter({ hasText: renamed })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '新增商品', exact: true }).first().click();
  await page.getByPlaceholder('例如：极简陶瓷马克杯').fill(`多仓商品-${suffix}`);
  await page.getByPlaceholder('扫描或输入条码，可留空').fill(`WH-UI-${suffix}`);
  await page.getByRole('spinbutton', { name: /采购价/ }).fill('10');
  await page.getByRole('spinbutton', { name: /销售价/ }).fill('20');
  await page.getByRole('checkbox', { name: renamed, exact: true }).check();
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const warehouses = await (await page.request.get('/api/warehouses')).json();
  const w = warehouses.find(w => w.name === renamed);
  const main = await (await page.request.get(`/api/products/barcode/WH-UI-${suffix}`)).json();
  expect((await page.request.post('/api/orders', { data: { type: 'in', partner: '测试供应商', items: [{ product_id: main.id, quantity: 5, price: 10 }] } })).ok()).toBe(true);
  await page.getByRole('combobox', { name: '当前仓库', exact: true }).selectOption(String(w.id));
  await expect(page.getByRole('combobox', { name: '当前仓库', exact: true })).toHaveValue(String(w.id));
  await page.getByRole('textbox', { name: '筛选商品', exact: true }).fill(`多仓商品-${suffix}`);
  await expect(page.locator('.product-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.product-table tbody tr')).toContainText('缺货');
  await page.locator('.product-table tbody tr').getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '主仓库', exact: true })).not.toBeChecked();
  await page.getByPlaceholder('例如：极简陶瓷马克杯').fill(`分仓独立修改-${suffix}`);
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await (await page.request.get(`/api/products/barcode/WH-UI-${suffix}`)).json()).name).toBe(`多仓商品-${suffix}`);
  await page.reload();
  await expect(page.getByRole('combobox', { name: '当前仓库', exact: true })).toHaveValue(String(w.id));
  await page.getByRole('textbox', { name: '筛选商品', exact: true }).fill(`分仓独立修改-${suffix}`);
  await expect(page.locator('.product-table tbody tr')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The Android data-management link selects a warehouse once; later choices survive refresh.
  await page.goto(`/?warehouse_id=${w.id}#products`);
  await expect(page.getByRole('combobox', { name: '当前仓库', exact: true })).toHaveValue(String(w.id));
  await expect.poll(() => new URL(page.url()).searchParams.has('warehouse_id')).toBe(false);
  await page.getByRole('combobox', { name: '当前仓库', exact: true }).selectOption('1');
  await expect(page.getByRole('combobox', { name: '当前仓库', exact: true })).toHaveValue('1');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '当前仓库', exact: true })).toHaveValue('1');
  expect(errors).toEqual([]);
});
