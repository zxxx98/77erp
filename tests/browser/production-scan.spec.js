import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(base + '/api' + path, { data: { request_id: randomUUID(), ...data } });
    const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true); return result;
  };
  await post('/auth/setup', { username: 'scanadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = await post('/products', { name: '扫码成品', barcode: 'SCAN-FIN', unit: '件', category: '生产', cost: 0, price: 0, threshold: 0 });
  const material = await post('/products', { name: '扫码材料', barcode: 'SCAN-MAT', unit: '件', category: '生产', cost: 0, price: 0, threshold: 0 });
  const bom = await post('/boms', { name: '扫码配方', product_id: product.id, base_quantity: 1, base_unit: '件', note: '', enabled: 1, items: [{ product_id: material.id, quantity: 2, unit: '件', note: '' }] });
  const order = await post('/production-orders', { schema_version: 2, bom_id: bom.id, bom_version: bom.version, planned_quantity: 5, note: '扫码测试' });
  const workspace = await (await page.request.get(base + '/api/workspace')).json();
  const link = productionRegistrationUrl({ origin: base, warehouseId: workspace.warehouse_id, orderId: order.id, number: order.number, sourceId: workspace.instance_id });
  return { base, db, order, link, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} QR resolves latest state without writes and consumes the link`, async ({ page }) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' })); }
  const f = await fixture(page);
  try {
    await page.goto(f.link);
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    await expect(page.getByText('本单尚未开始生产，请联系生产主管开工，并由仓库确认领料。', { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('#production');
    expect(f.db.prepare('SELECT status FROM production_orders WHERE id=?').get(f.order.id).status).toBe('draft');
    f.db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(f.order.id);
    await page.goto(f.link);
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('');
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '扫码登记', exact: true }).click();
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
    await page.getByRole('button', { name: '使用相机扫码', exact: true }).click();
    await expect(page.getByText('摄像头权限未开启，请在浏览器中授权，或手动输入物料条码。', { exact: true })).toBeVisible();
    if (mobile) await page.getByRole('button', { name: '手动输入条码', exact: true }).click();
    await expect(page.getByLabel('生产登记链接', { exact: true })).toBeVisible();
    await page.getByLabel('生产登记链接', { exact: true }).fill(f.link.replace(encodeURIComponent(f.order.number), 'WRONG-NUMBER'));
    await page.getByRole('button', { name: '打开登记', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '单号不一致' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toHaveCount(0);
    await page.getByLabel('生产登记链接', { exact: true }).fill(f.link);
    await page.getByLabel('生产登记链接', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await page.getByLabel('本次数量', { exact: true }).fill('3');
    page.once('dialog', dialog => dialog.dismiss());
    await page.evaluate(link => { history.replaceState(null, '', link); window.dispatchEvent(new HashChangeEvent('hashchange')); }, f.link);
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('3');
    await expect.poll(() => new URL(page.url()).hash).toBe('#production');
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
  } finally { await f.close(); }
});

for (const device of ['android', 'ios', 'pwa']) test(`${device} header scan opens production registration in production mode`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(device => {
    Object.defineProperty(navigator, 'userAgent', { value: device === 'ios'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' });
    if (device === 'pwa') {
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = query => query === '(display-mode: standalone)'
        ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : matchMedia(query);
    }
  }, device);
  const f = await fixture(page);
  try {
    await page.goto(f.base + '/#bom');
    const headerScan = page.locator('.mw-header').getByRole('button', { name: '扫描生产登记二维码', exact: true });
    await headerScan.click();
    const dialog = page.getByRole('dialog', { name: '扫码登记', exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).toBe('#production');
    await expect(page.getByRole('heading', { name: '扫码工作台', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await headerScan.click();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 800;
        canvas.getContext('2d').fillRect(0, 0, 640, 800);
        window.productionCameraStream = canvas.captureStream(20);
        return window.productionCameraStream;
      };
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['qr_code']; }
        async detect() { return window.productionCameraCode ? [{ rawValue: window.productionCameraCode }] : []; }
      };
    });
    await dialog.getByRole('button', { name: '使用相机扫码', exact: true }).click();
    await expect(page.locator('.camera-scanner-immersive video')).toHaveClass(/ready/);
    await page.evaluate(link => { window.productionCameraCode = link; }, f.link);
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    await expect(page.getByText('本单尚未开始生产，请联系生产主管开工，并由仓库确认领料。', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.productionCameraStream.getVideoTracks()[0].readyState)).toBe('ended');
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
    f.db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(f.order.id);
    await headerScan.click();
    await dialog.getByLabel('生产登记链接', { exact: true }).fill(f.link);
    await dialog.getByRole('button', { name: '打开登记', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('');
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.goto(f.base + '/#overview');
    await page.locator('.mw-header').getByRole('button', { name: '打开扫码工作台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '扫码工作台', exact: true })).toBeVisible();
  } finally { await f.close(); }
});
