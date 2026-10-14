import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } })).ok()).toBe(true);
});

test('product images fit a simple overlay; closing preserves the editor and restores focus', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#products');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, 1280, 800);
    return canvas.toDataURL('image/jpeg');
  });
  await page.route('https://img.77erp.test/**', route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(image.split(',')[1], 'base64') }));
  const created = await page.request.post('/api/products', { data: { name: '大图测试物料', category: '图片测试', unit: '个', cost: 10, price: 20, threshold: 5, image: 'https://img.77erp.test/file/preview.jpg' } });
  expect(created.ok()).toBe(true);
  await page.reload();
  await page.getByRole('textbox', { name: '筛选物料' }).fill('大图测试物料');
  const thumbnail = page.getByRole('button', { name: '放大查看 大图测试物料', exact: true });
  await expect(thumbnail.getByRole('img')).toHaveAttribute('src', 'https://img.77erp.test/file/preview.jpg?width=100&height=100&fallback=original');
  await thumbnail.click();
  const viewer = page.getByRole('dialog', { name: '图片预览：大图测试物料' });
  await expect(viewer.getByRole('img', { name: '大图测试物料 大图' })).toBeVisible();
  const previewImage = viewer.getByRole('img', { name: '大图测试物料 大图' });
  await expect(previewImage).toHaveAttribute('src', 'https://img.77erp.test/file/preview.jpg');
  const imageFits = () => previewImage.evaluate(el => {
    const image = el.getBoundingClientRect();
    return image.width <= 640 && image.height <= 480 && image.x >= 0 && image.y >= 0 && image.right <= window.innerWidth && image.bottom <= window.innerHeight && getComputedStyle(el).objectFit === 'contain';
  });
  expect(await imageFits()).toBe(true);
  expect((await previewImage.boundingBox()).width).toBe(640);
  expect((await previewImage.boundingBox()).height).toBe(480);
  await expect(viewer.getByRole('button')).toHaveCount(1);
  await previewImage.click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();

  await page.locator('.product-table tbody tr').filter({ hasText: '大图测试物料' }).getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '物料备注' }).fill('未保存的修改');
  const editorPreview = page.getByRole('button', { name: '放大查看 物料图片预览', exact: true });
  await editorPreview.click();
  const editorViewer = page.getByRole('dialog', { name: '图片预览：物料图片预览' });
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    expect(await editorViewer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(editorViewer).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '物料备注' })).toHaveValue('未保存的修改');
  await expect(editorPreview).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(errors).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await thumbnail.click();
  await expect(viewer.getByRole('button', { name: '关闭图片预览' })).toBeVisible();
  expect((await viewer.boundingBox()).width).toBe(390);
  expect(await imageFits()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 320 });
  expect((await viewer.boundingBox()).height).toBe(320);
  expect(await imageFits()).toBe(true);
  await expect(viewer.getByRole('button', { name: '关闭图片预览' })).toBeVisible();
  await viewer.click({ position: { x: 8, y: 8 } });
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
});
