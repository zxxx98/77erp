import { chooseOption } from "./dropdown-helpers.js";
import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } })).ok()).toBe(true);
  await page.route('https://img.77erp.test/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') }));
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
  await chooseOption(page.getByRole('combobox', { name: '上级分类' }), String(root.id));
  await page.getByRole('button', { name: '保存分类' }).click();
  await expect(page.getByRole('textbox', { name: /分类名称/ })).toHaveValue('');
  const categories = await (await page.request.get('/api/categories')).json();
  const child = categories.find(c => c.name === '杯具' && c.parent_id === root.id);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '新增物料', exact: true }).first().click();
  await page.getByPlaceholder('例如：RVV 护套电线').fill('树形分类测试杯');
  await page.getByPlaceholder('扫描或输入条码，可留空').fill('TEST-CATALOG-001');
  await chooseOption(page.getByRole('combobox', { name: /物料分类/ }), String(child.id));
  await page.getByRole('spinbutton', { name: /参考采购价/ }).fill('12');
  await page.getByRole('spinbutton', { name: /参考销售价/ }).fill('24');
  await page.getByRole('textbox', { name: '规格型号' }).fill('白色 / 350ml');
  await page.getByRole('textbox', { name: '物料备注' }).fill('防摔包装\n易碎品');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await expect(page.getByLabel('上传物料图片')).toBeHidden();
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^上传物料图片/ }).click();
  await (await fileChooser).setFiles({ name: 'cup.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('img', { name: '物料图片预览' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^更换物料图片/ })).toBeEnabled();
  await page.getByRole('button', { name: '保存物料', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: '物料分类树' }).getByRole('button', { name: /^自动化餐厨/ }).click();
  const row = page.locator('.product-table tbody tr').filter({ hasText: '树形分类测试杯' });
  await expect(row).toContainText('白色 / 350ml');
  await expect(row).toContainText('易碎品');
  await expect(row.getByRole('img', { name: '树形分类测试杯' })).toBeVisible();
  await expect(row).toContainText('自动化餐厨 / 杯具');
  await page.getByRole('button', { name: '折叠 自动化餐厨' }).click();
  await expect(page.getByRole('navigation', { name: '物料分类树' }).getByRole('button', { name: /^杯具/ })).toHaveCount(0);
  await page.getByRole('button', { name: '展开 自动化餐厨' }).click();
  await page.getByRole('button', { name: '管理分类', exact: true }).click();
  await chooseOption(page.getByRole('combobox', { name: '编辑分类' }), String(child.id));
  await page.getByRole('textbox', { name: /分类名称/ }).fill('陶瓷杯');
  await page.getByRole('button', { name: '保存分类' }).click();
  await expect(page.getByRole('textbox', { name: /分类名称/ })).toHaveValue('');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(row).toContainText('自动化餐厨 / 陶瓷杯');
  await page.reload();
  await page.getByRole('textbox', { name: '筛选物料' }).fill('350ml');
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '规格型号' })).toHaveValue('白色 / 350ml');
  await expect(page.getByRole('textbox', { name: '物料备注' })).toHaveValue('防摔包装\n易碎品');
  await expect(page.getByRole('img', { name: '物料图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '移除图片' }).click();
  await expect(page.getByRole('button', { name: /^上传物料图片/ })).toBeEnabled();
  await page.getByRole('textbox', { name: '物料备注' }).fill('更换包装');
  await page.getByRole('button', { name: '保存物料', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const product = await (await page.request.get('/api/products/barcode/TEST-CATALOG-001')).json();
  expect(product.image).toBe(''); expect(product.note).toBe('更换包装');
  expect(product.category_id).toBe(child.id);
  expect(errors).toEqual([]);
});

test('the category tree and product form fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#products');
  await expect(page.getByRole('navigation', { name: '物料分类树' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '新增物料', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: '规格型号' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('inventory shows the shared category tree and filters rows by the selected branch', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const suffix = Date.now();
  const categoryName = `库存分类-${suffix}`;
  const productName = `库存分类物料-${suffix}`;
  const created = await page.request.post('/api/categories', { data: { name: categoryName, parent_id: null } });
  expect(created.ok()).toBe(true);
  const categoryId = (await created.json()).id;
  expect((await page.request.post('/api/products', { data: { name: productName, barcode: `INV-CAT-${suffix}`, category: categoryName, category_id: categoryId, unit: '件', cost: 10, price: 20, threshold: 0 } })).ok()).toBe(true);

  await page.goto('/#inventory');
  const tree = page.getByRole('navigation', { name: '物料分类树' });
  await expect(tree).toBeVisible();
  await tree.getByRole('button', { name: new RegExp(`^${categoryName}`) }).click();
  const row = page.locator('.data-table tbody tr').filter({ hasText: productName });
  await expect(row).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
