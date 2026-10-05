import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

test('manage a category tree, upload product details, filter descendants, rename and clear the image after reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#products');
  await page.getByRole('button', { name: '管理分类', exact: true }).click();
  await page.getByRole('textbox', { name: /分类名称/ }).fill('自动化餐厨');
  await page.getByRole('button', { name: '保存分类' }).click();
  await expect(page.getByRole('textbox', { name: /分类名称/ })).toHaveValue('');
  const roots = await (await page.request.get('/api/categories')).json();
  const root = roots.find(c => c.name === '自动化餐厨');
  await page.getByRole('textbox', { name: /分类名称/ }).fill('杯具');
  await page.getByRole('combobox', { name: '上级分类' }).selectOption(String(root.id));
  await page.getByRole('button', { name: '保存分类' }).click();
  await expect(page.getByRole('textbox', { name: /分类名称/ })).toHaveValue('');
  const categories = await (await page.request.get('/api/categories')).json();
  const child = categories.find(c => c.name === '杯具' && c.parent_id === root.id);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '新增商品', exact: true }).first().click();
  await page.getByPlaceholder('例如：极简陶瓷马克杯').fill('树形分类测试杯');
  await page.getByPlaceholder('扫描或输入条码，可留空').fill('TEST-CATALOG-001');
  await page.getByRole('combobox', { name: /商品分类/ }).selectOption(String(child.id));
  await page.getByRole('spinbutton', { name: /采购价/ }).fill('12');
  await page.getByRole('spinbutton', { name: /销售价/ }).fill('24');
  await page.getByRole('textbox', { name: '商品规格' }).fill('白色 / 350ml');
  await page.getByRole('textbox', { name: '商品备注' }).fill('防摔包装\n易碎品');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('上传商品图片').setInputFiles({ name: 'cup.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('img', { name: '商品图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: '商品分类树' }).getByRole('button', { name: /^自动化餐厨/ }).click();
  const row = page.locator('.product-table tbody tr').filter({ hasText: '树形分类测试杯' });
  await expect(row).toContainText('白色 / 350ml');
  await expect(row).toContainText('易碎品');
  await expect(row.getByRole('img', { name: '树形分类测试杯' })).toBeVisible();
  await expect(row).toContainText('自动化餐厨 / 杯具');
  await page.getByRole('button', { name: '折叠 自动化餐厨' }).click();
  await expect(page.getByRole('navigation', { name: '商品分类树' }).getByRole('button', { name: /^杯具/ })).toHaveCount(0);
  await page.getByRole('button', { name: '展开 自动化餐厨' }).click();
  await page.getByRole('button', { name: '管理分类', exact: true }).click();
  await page.getByRole('combobox', { name: '编辑分类' }).selectOption(String(child.id));
  await page.getByRole('textbox', { name: /分类名称/ }).fill('陶瓷杯');
  await page.getByRole('button', { name: '保存分类' }).click();
  await expect(page.getByRole('textbox', { name: /分类名称/ })).toHaveValue('');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(row).toContainText('自动化餐厨 / 陶瓷杯');
  await page.reload();
  await page.getByRole('textbox', { name: '筛选商品' }).fill('350ml');
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '商品规格' })).toHaveValue('白色 / 350ml');
  await expect(page.getByRole('textbox', { name: '商品备注' })).toHaveValue('防摔包装\n易碎品');
  await expect(page.getByRole('img', { name: '商品图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '移除图片' }).click();
  await page.getByRole('textbox', { name: '商品备注' }).fill('更换包装');
  await page.getByRole('button', { name: '保存商品', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const product = await (await page.request.get('/api/products/barcode/TEST-CATALOG-001')).json();
  expect(product.image).toBe(''); expect(product.note).toBe('更换包装');
  expect(product.category_id).toBe(child.id);
  expect(errors).toEqual([]);
});

test('the category tree and product form fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#products');
  await expect(page.getByRole('navigation', { name: '商品分类树' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '新增商品', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: '商品规格' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
