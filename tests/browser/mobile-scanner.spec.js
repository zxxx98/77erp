import { test, expect, devices } from '@playwright/test';
import { qrSymbol } from '../../src/product-code.js';
import JsBarcode from 'jsbarcode';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

async function mobile(browser) {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', reducedMotion: 'reduce' });
  expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  return { context, page };
}

async function mockCamera(page) {
  await page.evaluate(() => {
    window.cameraStreams = [];
    window.makeCameraStream = () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 800;
      const drawing = canvas.getContext('2d');
      let symbol, placement;
      const paint = () => {
        // Barcode fixtures represent a printed white label filling the camera scene.
        drawing.fillStyle = symbol?.height ? '#fff' : '#333e48'; drawing.fillRect(0, 0, 640, 800);
        if (symbol) {
          const { x = 210, y = 235, size = 220 } = placement || {};
          drawing.save(); drawing.translate(x, y); drawing.scale(Math.floor(size / symbol.size), Math.floor(size / symbol.size));
          drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, symbol.size, symbol.height || symbol.size);
          drawing.fillStyle = '#000'; drawing.fill(new Path2D(symbol.path)); drawing.restore();
        }
      };
      window.paintCameraCode = (next, position) => { symbol = next; placement = position; paint(); };
      paint();
      const timer = setInterval(paint, 50);
      const stream = canvas.captureStream(20);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      window.cameraStreams.push(stream);
      return stream;
    };
    navigator.mediaDevices.getUserMedia = async () => window.makeCameraStream();
  });
}

async function product(context, barcode) {
  const name = `SCAN-${Date.now()}`;
  const response = await context.request.post('/api/products', { data: { name, barcode: barcode || name, category: '扫码测试', unit: '个', cost: 10, price: 20, threshold: 0 } });
  expect(response.ok()).toBe(true);
  return { ...(await response.json()), name, barcode: barcode || name };
}

test('mobile camera fills the viewport and real QR recognition returns once and stops the stream', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const item = await product(context);
  await page.reload();
  await mockCamera(page);
  await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
  await page.getByRole('button', { name: '手机扫码', exact: true }).click();
  const scanner = page.locator('.camera-scanner-immersive');
  await expect(scanner).toBeFocused();
  await expect(page.locator('#root')).toHaveJSProperty('inert', true);
  await expect(scanner.locator('video')).toHaveClass(/ready/);
  await expect(scanner.locator('video')).toHaveCSS('object-fit', 'cover');
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const bounds = await scanner.boundingBox();
      return bounds.x === 0 && bounds.y === 0 && bounds.width === viewport.width && bounds.height === viewport.height;
    }).toBe(true);
    const cancel = await scanner.getByRole('button', { name: '取消扫码' }).boundingBox();
    const manual = await scanner.getByRole('button', { name: '手动输入条码' }).boundingBox();
    expect(cancel.y).toBeGreaterThanOrEqual(0);
    expect(manual.y + manual.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/ui-preview/mobile-immersive-scanner.png' });
  await page.evaluate(symbol => window.paintCameraCode(symbol), qrSymbol(item.name));
  await expect(scanner).toHaveCount(0);
  await expect(page.locator('.scan-result-product h3')).toHaveText(item.name);
  const toast = page.locator('.toast');
  await expect(toast).toContainText(`已识别：${item.name}`);
  const toastBounds = await toast.boundingBox();
  const messageBounds = await toast.locator('span').boundingBox();
  expect(toastBounds.x).toBeGreaterThanOrEqual(0);
  expect(toastBounds.x + toastBounds.width).toBeLessThanOrEqual(390);
  expect(messageBounds.x).toBeGreaterThanOrEqual(0);
  expect(messageBounds.x + messageBounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => window.cameraStreams[0].getVideoTracks()[0].readyState)).toBe('ended');
  await expect(page.locator('#root')).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await context.close();
});

test('native scanning receives cropped frames at a higher rate and returns a result once', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const item = await product(context);
  await page.reload();
  await mockCamera(page);
  await page.evaluate(() => {
    window.nativeFrames = [];
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code', 'unknown']; }
      constructor(options) { window.nativeFormats = options.formats; }
      async detect(canvas) {
        window.nativeFrames.push({ width: canvas.width, height: canvas.height, at: performance.now() });
        return window.nativeResult ? [{ rawValue: window.nativeResult }] : [];
      }
    };
  });
  await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
  await page.getByRole('button', { name: '手机扫码', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await expect.poll(() => page.evaluate(() => window.nativeFrames.length)).toBeGreaterThanOrEqual(4);
  const frames = await page.evaluate(() => window.nativeFrames.slice(0, 4));
  expect((frames[3].at - frames[0].at) / 3).toBeLessThan(300);
  expect(frames[0].width).toBeLessThan(400);
  expect(frames[0].height).toBeLessThan(400);
  expect(await page.evaluate(() => window.nativeFormats)).toEqual(['qr_code']);
  await page.evaluate(value => { window.nativeResult = value; }, item.name);
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await expect(page.locator('.scan-result-product h3')).toHaveText(item.name);
  expect(await page.evaluate(() => window.cameraStreams[0].getVideoTracks()[0].readyState)).toBe('ended');
  await context.close();
});

test('a native miss or platform failure still recognizes a real QR through ZXing', async ({ browser }) => {
  for (const broken of [false, true]) {
    const { context, page } = await mobile(browser);
    const item = await product(context);
    await page.reload();
    await mockCamera(page);
    await page.evaluate(broken => {
      window.nativeAttempts = 0;
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['qr_code']; }
        async detect() {
          window.nativeAttempts++;
          if (broken) throw new Error('Native backend unavailable');
          return [];
        }
      };
    }, broken);
    await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
    await page.getByRole('button', { name: '手机扫码', exact: true }).click();
    await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
    await page.evaluate(symbol => window.paintCameraCode(symbol), qrSymbol(item.name));
    await expect(page.locator('.scan-result-product h3')).toHaveText(item.name);
    await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
    expect(await page.evaluate(() => window.nativeAttempts)).toBeGreaterThan(0);
    if (broken) expect(await page.evaluate(() => window.nativeAttempts)).toBe(1);
    await context.close();
  }
});

test('closing a scanner discards a native result that arrives late', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const item = await product(context);
  await page.reload();
  await mockCamera(page);
  await page.evaluate(() => {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      detect() { return new Promise(resolve => { window.finishNativeScan = value => resolve([{ rawValue: value }]); }); }
    };
  });
  await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
  await page.getByRole('button', { name: '手机扫码', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.finishNativeScan)).toBe('function');
  await page.getByRole('button', { name: '取消扫码', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await page.evaluate(value => window.finishNativeScan(value), item.name);
  await expect(page.locator('.scan-result-product')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(await page.evaluate(() => window.cameraStreams[0].getVideoTracks()[0].readyState)).toBe('ended');
  await context.close();
});

test('expanded search recognizes off-guide QR and wide Code 128 labels on mobile and desktop', async ({ browser }) => {
  for (const desktop of [false, true]) {
    const context = await browser.newContext({ ...(desktop ? {} : devices['Pixel 7']),
      baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const page = await context.newPage();
    const item = await product(context, String(Date.now()).slice(-8));
    await page.goto('/');
    await mockCamera(page);
    await page.evaluate(() => { window.BarcodeDetector = undefined; });
    await page.getByRole(desktop ? 'link' : 'button', { name: desktop ? '扫码工作台' : '打开扫码工作台', exact: true }).click();
    for (const barcode of [false, true]) {
      await page.getByRole('button', { name: '手机扫码', exact: true }).click();
      await expect(page.locator(desktop ? '.camera-scanner video' : '.camera-scanner-immersive video')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.querySelector('.camera-scanner video, .camera-scanner-immersive video')?.readyState)).toBeGreaterThanOrEqual(2);
      let symbol = qrSymbol(item.barcode);
      if (barcode) {
        const encoded = {};
        JsBarcode(encoded, item.barcode, { format: 'CODE128' });
        const bars = encoded.encodings[0].data;
        symbol = { size: bars.length + 20, height: 80,
          path: [...bars].map((bit, x) => bit === '1' ? `M${x + 10} 10h1v60h-1z` : '').join('') };
      }
      // The QR is below the guide; the barcode is wider than the mobile guide.
      await page.evaluate(({ symbol, barcode, desktop }) => window.paintCameraCode(symbol,
        barcode ? { x: 170, y: 350, size: 340 } : { x: 230, y: desktop ? 300 : 490, size: 160 }), { symbol, barcode, desktop });
      await expect(page.locator('.scan-result-product h3')).toHaveText(item.name);
      await expect(page.locator('.camera-scanner, .camera-scanner-immersive')).toHaveCount(0);
    }
    await context.close();
  }
});

test('back and manual entry leave the order intact; camera recognition adds exactly one item', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const item = await product(context);
  await page.reload();
  await mockCamera(page);
  await page.getByRole('button', { name: '采购入库', exact: true }).click();
  await page.getByRole('combobox', { name: /供应商/ }).fill('全屏扫码供应商');
  await page.getByRole('button', { name: '扫码添加物料', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await page.goBack();
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '采购入库', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /供应商/ })).toHaveValue('全屏扫码供应商');
  expect(await page.evaluate(() => window.cameraStreams[0].getVideoTracks()[0].readyState)).toBe('ended');
  await page.getByRole('button', { name: '扫码添加物料', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await page.evaluate(symbol => window.paintCameraCode(symbol), qrSymbol(item.name));
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: `${item.name} 数量` })).toHaveValue('1');
  expect(await page.evaluate(() => window.cameraStreams[1].getVideoTracks()[0].readyState)).toBe('ended');
  await page.getByRole('button', { name: '扫码添加物料', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await page.getByRole('button', { name: '手动输入条码', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '扫描物料条码', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.cameraStreams[2].getVideoTracks()[0].readyState)).toBe('ended');
  await expect(page.getByRole('spinbutton', { name: `${item.name} 数量` })).toHaveValue('1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '保存本地草稿？' })).toBeVisible();
  await context.close();
});

test('camera failures can retry; canceled permission requests release their late stream', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  await mockCamera(page);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
  await page.getByRole('button', { name: '手机扫码', exact: true }).click();
  await expect(page.locator('.camera-error')).toContainText('摄像头权限未开启');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => window.makeCameraStream(); });
  await page.getByRole('button', { name: '重新开启扫码' }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await page.getByRole('button', { name: '取消扫码' }).click();
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  expect(await page.evaluate(() => window.cameraStreams[0].getVideoTracks()[0].readyState)).toBe('ended');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.grantCamera = () => resolve(window.makeCameraStream()); }); });
  await page.getByRole('button', { name: '手机扫码', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.grantCamera)).toBe('function');
  await page.getByRole('button', { name: '取消扫码' }).click();
  await page.evaluate(() => window.grantCamera());
  await expect.poll(() => page.evaluate(() => window.cameraStreams[1].getVideoTracks()[0].readyState)).toBe('ended');
  await expect(page.locator('#root')).toHaveJSProperty('inert', false);
  await context.close();
});

test('QR configuration uses the same immersive camera and preserves its unsaved fields', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const item = await product(context);
  await page.reload();
  await mockCamera(page);
  await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
  await page.getByRole('button', { name: '管理出入库二维码', exact: true }).click();
  await page.getByRole('button', { name: '新建二维码', exact: true }).click();
  await page.getByLabel('二维码名称', { exact: true }).fill('未保存的扫码配置');
  await page.getByRole('button', { name: '扫描添加物料', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await expect(page.getByLabel('二维码名称', { exact: true })).toHaveValue('未保存的扫码配置');
  await page.getByRole('button', { name: '扫描添加物料', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
  await page.evaluate(symbol => window.paintCameraCode(symbol), qrSymbol(item.name));
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await expect(page.locator('.stock-qr-edit-line')).toHaveCount(1);
  await expect(page.locator('.stock-qr-edit-line')).toContainText(item.name);
  expect(await page.evaluate(() => window.cameraStreams.every(stream => stream.getVideoTracks()[0].readyState === 'ended'))).toBe(true);
  await context.close();
});
