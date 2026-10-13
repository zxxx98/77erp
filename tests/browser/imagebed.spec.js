import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const setup = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(setup.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

test('settings save redacted cfr2 credentials, preserve them when blank, and upload a test image on a narrow screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByRole('button', { name: /^图床配置/ }).click();
  const section = page.getByRole('region', { name: '图床配置' });
  await expect(section.getByLabel('图床地址', { exact: true })).toBeVisible();
  await section.getByLabel('图床地址', { exact: true }).fill('https://img.77erp.test');
  await section.getByLabel('认证方式').selectOption('token');
  await section.getByLabel('上传凭据', { exact: true }).fill('browser-private-token');
  await section.getByLabel('上传目录', { exact: true }).fill('77erp/products');
  await section.getByRole('button', { name: '保存图床配置', exact: true }).click();
  await expect(section.getByText('图床配置已保存，所有仓库共用。')).toBeVisible();
  await expect(section.getByLabel('上传凭据', { exact: true })).toHaveValue('');
  const config = await (await page.request.get('/api/settings/imagebed')).json();
  expect(config.has_secret).toBe(true); expect(config.secret).toBeUndefined(); expect(config.upload_channel).toBe('cfr2');
  await section.getByRole('button', { name: '保存图床配置', exact: true }).click();
  await expect(section.getByText('图床配置已保存，所有仓库共用。')).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24;
    const context = canvas.getContext('2d'); context.fillStyle = '#2563eb'; context.fillRect(0, 0, 24, 24);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://img.77erp.test/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  await section.getByLabel('上传测试图片').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(section.getByText('测试上传成功，图片已写入图床。')).toBeVisible();
  await expect(section.getByRole('img', { name: '图床测试图片' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a failed image upload preserves the existing product URL and form contents for retry', async ({ page }) => {
  await page.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } });
  const image = 'https://img.77erp.test/file/original.jpg';
  const created = await page.request.post('/api/products', { data: { name: '上传失败测试商品', category: '上传测试', unit: '件', cost: 1, price: 2, threshold: 1, image } });
  expect(created.ok()).toBe(true);
  await page.goto('/#products');
  await page.getByRole('textbox', { name: '筛选商品' }).fill('上传失败测试商品');
  await page.locator('.product-table tbody tr').filter({ hasText: '上传失败测试商品' }).getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '商品备注' }).fill('待保存备注');
  await page.route('**/api/uploads/product-image', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '图床认证失败，请检查上传凭据及上传权限。' }) }));
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8; return canvas.toDataURL('image/png').split(',')[1]; });
  await page.getByLabel('上传商品图片').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('alert')).toContainText('图床认证失败');
  await expect(page.getByRole('img', { name: '商品图片预览' })).toHaveAttribute('src', image);
  await expect(page.getByRole('textbox', { name: '商品备注' })).toHaveValue('待保存备注');
  await expect(page.getByRole('button', { name: '保存商品', exact: true })).toBeEnabled();
});
