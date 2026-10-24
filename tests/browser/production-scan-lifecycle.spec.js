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

for (const mobile of [false, true]) for (const manual of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} ${manual ? 'manual same-warehouse' : 'deep-link'} QR resumes after expired login`, async ({ page }) => {
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }));
  }
  const f = await fixture(page);
  try {
    f.db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(f.order.id);
    await page.goto(f.base + '/#production');
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    await page.route(`**/api/production-orders/${f.order.id}`, async route => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '登录已失效' }) });
      await page.unroute(`**/api/production-orders/${f.order.id}`);
    });
    if (manual) {
      await page.getByRole('button', { name: '扫码登记', exact: true }).click();
      await page.getByLabel('生产登记链接', { exact: true }).fill(f.link);
      await page.getByRole('button', { name: '打开登记', exact: true }).click();
    } else await page.evaluate(link => { location.href = link; }, f.link);
    await expect(page.getByRole('heading', { name: '账号登录', exact: true })).toBeVisible();
    expect(new URL(page.url()).hash).toBe(new URL(f.link).hash);
    await page.getByPlaceholder('请输入账号', { exact: true }).fill('scanadmin');
    await page.getByPlaceholder('请输入密码', { exact: true }).fill('Test-admin-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产登记', exact: true })).toBeVisible();
    expect(f.db.prepare('SELECT COUNT(*) n FROM production_batches').get().n).toBe(0);
  } finally { await f.close(); }
});

test('delayed QR response cannot discard a newly edited production draft without confirmation', async ({ page }) => {
  const f = await fixture(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.goto(f.base + '/#production');
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    let requested;
    const started = new Promise(resolve => { requested = resolve; });
    await page.route(`**/api/production-orders/${f.order.id}`, async route => { requested(); await gate; await route.continue(); });
    await page.evaluate(link => { history.replaceState(null, '', link); window.dispatchEvent(new HashChangeEvent('hashchange')); }, f.link);
    await started;
    await page.getByRole('button', { name: '新建生产单', exact: true }).click();
    await page.getByRole('button', { name: /^选择配方 / }).click();
    await page.getByLabel('生产备注', { exact: true }).fill('UNSAVEDNOTE');
    let confirmed = false;
    page.once('dialog', async dialog => { confirmed = true; await dialog.dismiss(); });
    release();
    await expect(page.getByRole('status').filter({ hasText: '正在读取生产单' })).toHaveCount(0);
    await expect(page.getByLabel('生产备注', { exact: true })).toHaveValue('UNSAVEDNOTE');
    expect(confirmed).toBe(true);
  } finally { release(); await f.close(); }
});

for (const unmount of [false, true]) test(`manual QR response is ignored after ${unmount ? 'unmount' : 'hash navigation'}`, async ({ page }) => {
  const f = await fixture(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.goto(f.base + '/#production');
    await page.getByRole('button', { name: '扫码登记', exact: true }).click();
    await page.getByLabel('生产登记链接', { exact: true }).fill(f.link);
    let requested;
    const started = new Promise(resolve => { requested = resolve; });
    await page.route(`**/api/production-orders/${f.order.id}`, async route => { requested(); await gate; await route.continue(); });
    await page.getByRole('button', { name: '打开登记', exact: true }).click();
    await started;
    await page.evaluate(unmount => { location.hash = unmount ? 'products' : 'production?view=list'; }, unmount);
    await expect(page.getByRole('heading', { name: unmount ? '物料管理' : '生产单', exact: true })).toBeVisible();
    const response = page.waitForResponse(`**/api/production-orders/${f.order.id}`);
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (unmount) await page.evaluate(() => { location.hash = 'production'; });
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe(unmount ? '#production' : '#production?view=list');
  } finally { release(); await f.close(); }
});
