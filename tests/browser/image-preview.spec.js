import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

test('product images open large, zoom and pan; preview shortcuts preserve the editor and restore focus', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#products');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, 1280, 800);
    return canvas.toDataURL('image/jpeg');
  });
  const created = await page.request.post('/api/products', { data: { name: '大图测试商品', category: '图片测试', unit: '个', cost: 10, price: 20, threshold: 5, image } });
  expect(created.ok()).toBe(true);
  await page.reload();
  await page.getByRole('textbox', { name: '筛选商品' }).fill('大图测试商品');
  const thumbnail = page.getByRole('button', { name: '放大查看 大图测试商品', exact: true });
  await thumbnail.click();
  const viewer = page.getByRole('dialog', { name: '图片预览：大图测试商品' });
  await expect(viewer.getByRole('img', { name: '大图测试商品 大图' })).toBeVisible();
  await viewer.getByRole('button', { name: '放大图片' }).click();
  await expect(viewer.getByLabel('图片缩放比例')).toHaveText('150%');
  const stage = viewer.getByLabel('图片查看区域');
  const box = await stage.boundingBox();
  const before = await stage.evaluate(el => el.scrollLeft);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 50, { steps: 4 });
  await page.mouse.up();
  expect(await stage.evaluate(el => el.scrollLeft)).toBeGreaterThan(before);
  await viewer.getByRole('button', { name: '重置图片' }).click();
  await expect(viewer.getByLabel('图片缩放比例')).toHaveText('100%');
  await stage.dblclick();
  await expect(viewer.getByLabel('图片缩放比例')).toHaveText('200%');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();

  await page.locator('.product-table tbody tr').filter({ hasText: '大图测试商品' }).getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '商品备注' }).fill('未保存的修改');
  const editorPreview = page.getByRole('button', { name: '放大查看 商品图片预览', exact: true });
  await editorPreview.click();
  const editorViewer = page.getByRole('dialog', { name: '图片预览：商品图片预览' });
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    expect(await editorViewer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('+');
  await expect(editorViewer.getByLabel('图片缩放比例')).toHaveText('150%');
  await page.keyboard.press('Escape');
  await expect(editorViewer).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '商品备注' })).toHaveValue('未保存的修改');
  await expect(editorPreview).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(errors).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await thumbnail.click();
  await expect(viewer.getByRole('button', { name: '关闭图片预览' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await viewer.getByRole('button', { name: '关闭图片预览' }).click();
  await expect(viewer).toHaveCount(0);
});
