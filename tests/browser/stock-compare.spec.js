import { chooseOption } from "./dropdown-helpers.js";
import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(res.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

test('configure a global stock comparison expression and see it in the product detail', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const suffix = Date.now();
  const other = `对比分仓-${suffix}`;
  const barcode = `CMP-${suffix}`;

  // Create a second warehouse holding stock for the same product.
  const created = await page.request.post('/api/warehouses', { data: { name: other, reuse_catalog: false } });
  expect(created.ok()).toBe(true);
  const otherId = (await created.json()).id;
  // Create the product in the main warehouse and sync it to the other warehouse.
  const main = await page.request.post('/api/products', { data: { name: `对比物料-${suffix}`, barcode, category: '日用', unit: '件', cost: 10, price: 20, threshold: 0, sync_warehouse_ids: [otherId] } });
  expect(main.ok()).toBe(true);
  const mainProduct = await main.json();
  expect((await page.request.post('/api/orders', { data: { type: 'in', partner: '供应商', items: [{ product_id: mainProduct.id, quantity: 10, price: 10 }] } })).ok()).toBe(true);

  // Configure the expression: current main warehouse - other warehouse.
  await page.goto('/#products');
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '库存对比表达式', exact: true })).toBeVisible();
  await chooseOption(page.getByRole('combobox', { name: '起始仓库', exact: true }), '1');
  await page.getByRole('button', { name: '添加仓库项', exact: true }).click();
  await chooseOption(page.getByRole('combobox', { name: '第 1 项运算符', exact: true }), '-');
  await chooseOption(page.getByRole('combobox', { name: '第 1 项仓库', exact: true }), String(otherId));
  await expect(page.locator('.stock-expression-preview')).toContainText('主仓库');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const saved = await (await page.request.get('/api/data')).json();
  expect(saved.settings.stock_expression).toEqual({ left: 1, terms: [{ warehouse_id: otherId, op: '-' }] });

  // Other warehouse mirrors the product through sync; the expression reads 10 - 0 = +10.
  await page.getByRole('textbox', { name: '筛选物料', exact: true }).fill(`对比物料-${suffix}`);
  await page.locator('.product-table tbody tr').getByRole('button', { name: `查看 对比物料-${suffix} 物料详情` }).click();
  await expect(page.getByRole('heading', { name: '其他仓库库存', exact: true })).toBeVisible();
  await expect(page.locator('.product-detail .stock-diff-positive')).toContainText('+10');
  expect(errors).toEqual([]);
});
