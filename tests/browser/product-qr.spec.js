import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

async function decodeSvg(page, svg) {
  const image = await page.evaluate(async text => {
    const source = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      const img = new Image(); img.src = source; await img.decode();
      const canvas = document.createElement('canvas');
      const size = Number(new DOMParser().parseFromString(text, 'image/svg+xml').documentElement.getAttribute('viewBox').split(' ')[2]);
      canvas.width = canvas.height = size * 4;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return { size: canvas.width, pixels: Array.from({ length: canvas.width * canvas.height }, (_, i) => rgba[i * 4]) };
    } finally { URL.revokeObjectURL(source); }
  }, svg);
  const pixels = new Uint8ClampedArray(image.pixels);
  // Exported SVGs are upright symbols with a quiet zone; skip camera-style detection,
  // which can mistake payload patterns for alignment markers in valid QR labels.
  const hints = new Map([[DecodeHintType.PURE_BARCODE, true]]);
  return JSON.parse(new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, image.size, image.size))), hints).getText());
}

test('toggle and download a decodable QR label, retain barcode export and never mutate business data', async ({ page }) => {
  const before = await (await page.request.get('/api/data')).json();
  const product = before.products.find(p => p.barcode === '6901234567001');
  const writes = [];
  page.on('request', req => { if (req.url().includes('/api/') && req.method() !== 'GET') writes.push(req.url()); });
  await page.goto('/#products');
  await page.getByRole('button', { name: '查看 极简陶瓷马克杯 条码', exact: true }).click();
  const switcher = page.getByRole('group', { name: '标签类型' });
  await expect(switcher.getByRole('button', { name: '条形码', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.barcode-detail .barcode')).toBeVisible();
  await switcher.getByRole('button', { name: '二维码', exact: true }).click();
  await expect(page.getByRole('img', { name: `二维码 ${product.barcode}`, exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载标签', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`${product.barcode}-qr.svg`);
  const svg = await readFile(await download.path(), 'utf8');
  expect(await decodeSvg(page, svg)).toEqual({
    format: '77erp', version: 1, type: 'product', source_id: before.instance_id, warehouse_id: before.warehouse_id,
    product: { id: product.id, barcode: product.barcode, name: product.name, unit: product.unit },
  });
  await switcher.getByRole('button', { name: '条形码', exact: true }).click();
  await expect(page.locator('.barcode-detail .barcode')).toBeVisible();
  const barcodeEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载标签', exact: true }).click();
  expect((await barcodeEvent).suggestedFilename()).toBe(`${product.barcode}.svg`);
  expect(writes).toEqual([]);
  const after = await (await page.request.get('/api/data')).json();
  expect(after.products).toEqual(before.products);
  expect(after.orders).toEqual(before.orders);
});

test('QR switching stays at the top right on a narrow screen and identifies the selected warehouse', async ({ page }) => {
  const warehouse = await (await page.request.post('/api/warehouses', { data: { name: '二维码分仓' } })).json();
  const result = await page.request.post('/api/products', {
    headers: { 'X-Warehouse-ID': String(warehouse.id) },
    data: { name: '二维码分仓商品', barcode: '6901234567001', unit: '套', category: '二维码测试', cost: 1, price: 2, threshold: 0 },
  });
  expect(result.status()).toBe(201);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/?warehouse_id=${warehouse.id}#products`);
  await page.getByRole('button', { name: '查看 二维码分仓商品 条码', exact: true }).click();
  const qrButton = page.getByRole('button', { name: '二维码', exact: true });
  await qrButton.focus();
  await page.keyboard.press('Enter');
  const qr = page.getByRole('img', { name: '二维码 6901234567001', exact: true });
  await expect(qr).toBeVisible();
  const header = page.locator('.product-code-modal .modal-header');
  const switchBox = await page.getByRole('group', { name: '标签类型' }).boundingBox();
  const titleBox = await header.getByRole('heading', { name: '商品条码', exact: true }).boundingBox();
  expect(switchBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
  const svg = await qr.evaluate(el => new XMLSerializer().serializeToString(el));
  const payload = await decodeSvg(page, svg);
  expect(payload.warehouse_id).toBe(warehouse.id);
  expect(payload.product.name).toBe('二维码分仓商品');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
