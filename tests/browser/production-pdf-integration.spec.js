import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';
import QRCode from 'qrcode';

const password = 'Scan-worker-123';
async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let warehouseId = 1;
  const post = async (path, data) => {
    const response = await page.request.post(`${base}/api${path}`, { headers: { 'X-Warehouse-ID': String(warehouseId) }, data: { request_id: randomUUID(), ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'owner', password });
  const group = await post('/production-groups', { name: '扫码一组' });
  const other = await post('/production-groups', { name: '扫码二组' });
  const position = await post('/positions', { name: '扫码生产岗位', access_mode: 'production_only', permissions: ['production_register'] });
  for (const [username, production_group_id] of [['scanworker', group.id], ['otherworker', other.id], ['nogroup', null]]) {
    await post('/users', { username, password, position_id: position.id, production_group_id });
  }
  const warehouse = await post('/warehouses', { name: '扫码任务仓' }); warehouseId = warehouse.id;
  const product = await post('/products', { name: '扫码任务成品', barcode: 'PDF-SCAN-F', unit: '件', category: '生产', cost: 0, price: 0, threshold: 0 });
  const material = await post('/products', { name: '扫码任务材料', barcode: 'PDF-SCAN-M', unit: '件', category: '生产', cost: 0, price: 0, threshold: 0 });
  const bom = await post('/boms', { name: '扫码任务配方', product_id: product.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items: [{ product_id: material.id, quantity: 2, unit: '件', note: '按计划备料' }] });
  const prepared = await post('/production-orders/prepare', { bom_id: bom.id, bom_version: bom.version, schema_version: 2, planned_quantity: 5 });
  let order = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, schema_version: 2, structure_token: prepared.structure_token, planned_quantity: 5, production_group_id: group.id, note: '车间任务单备注' });
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10000 WHERE id=?').run(material.id);
  order = await post(`/production-orders/${order.id}/start`, { version: order.version, schema_version: 2 });
  await post(`/production-material-documents/${order.material_documents[0].id}/confirm`, { version: order.material_documents[0].version });
  const sourceId = db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  const link = productionRegistrationUrl({ origin: base, warehouseId, orderId: order.id, number: order.number, sourceId });
  await post('/auth/logout', {});
  return { base, db, post, link, order, warehouse, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

for (const mobile of [false, true]) test.describe(`task QR ${mobile ? 'mobile PWA' : 'desktop'}`, () => {
  test.use({ serviceWorkers: mobile ? 'allow' : 'block' });
  test('logged-out worker resumes registration and downloads a task PDF without writes', async ({ page }) => {
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }));
    }
    const f = await fixture(page);
    try {
      await page.goto(f.link);
      await expect(page.getByRole('heading', { name: '账号登录', exact: true })).toBeVisible();
      await page.getByLabel('账号', { exact: true }).fill('scanworker');
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
      await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('');
      await expect(page.locator('.production-only-header')).toContainText('扫码任务仓');
      if (mobile) await page.evaluate(() => navigator.serviceWorker.ready);
      expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: '返回单据详情', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
      const path = test.info().outputPath('production-task.pdf'); await download.saveAs(path);
      expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');
      expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
      await page.screenshot({ path: test.info().outputPath('production-task-detail.png'), fullPage: true });
    } finally { await f.close(); }
  });
});

test('scanning switches warehouse before registration and rejects foreign group or missing membership', async ({ page }) => {
  const f = await fixture(page);
  try {
    await f.post('/auth/login', { username: 'scanworker', password });
    await page.goto(`${f.base}/?warehouse_id=1#production`);
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '扫码登记', exact: true }).click();
    await page.getByLabel('生产登记链接', { exact: true }).fill(f.link);
    await page.getByRole('button', { name: '打开登记', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await expect(page.locator('.production-only-header')).toContainText('扫码任务仓');
    expect(await page.evaluate(() => localStorage.getItem('77erp-warehouse'))).toBe(String(f.warehouse.id));
    for (const username of ['otherworker', 'nogroup']) {
      await f.post('/auth/logout', {}); await f.post('/auth/login', { username, password });
      await page.goto(f.link);
      await expect(page.getByRole('alert')).toContainText('不属于您可查看的生产小组');
      await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toHaveCount(0);
    }
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
  } finally { await f.close(); }
});

test('camera decodes a production QR and opens registration without manual input', async ({ page }) => {
  const f = await fixture(page);
  try {
    await f.post('/auth/login', { username: 'scanworker', password });
    const qrImage = await QRCode.toDataURL(f.link, { width: 480, margin: 4 });
    await page.addInitScript(image => {
      // A real video stream of a QR exercises CameraScanner and its decoder end to end.
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
        const context = canvas.getContext('2d');
        const qr = new Image(); qr.src = image; await qr.decode();
        const draw = () => { context.fillStyle = 'white'; context.fillRect(0, 0, 640, 640); context.drawImage(qr, 80, 80, 480, 480); };
        draw(); const stream = canvas.captureStream(10);
        const timer = setInterval(draw, 100);
        const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        return stream;
      } });
    }, qrImage);
    await page.goto(`${f.base}/?warehouse_id=${f.warehouse.id}#production`);
    await page.getByRole('button', { name: '扫码登记', exact: true }).click();
    await page.getByRole('button', { name: '使用相机扫码', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveValue('');
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
  } finally { await f.close(); }
});
