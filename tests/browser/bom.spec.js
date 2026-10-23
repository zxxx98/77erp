import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { parseCSV } from '../../src/data-files.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(base + '/api' + path, { data: { request_id: randomUUID(), ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'bomadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const products = [];
  for (const [name, barcode, unit, stock] of [['示例桌子', 'TABLE-001', '张', 0], ['小号桌子', 'TABLE-002', '张', 0],
    ['桌面材料', 'TOP-001', '块', 8], ['桌腿材料', 'LEG-001', '根', 50], ['螺丝材料', 'SCREW-001', '颗', 100]]) {
    const product = await post('/products', { name, barcode, unit, category: '生产', cost: 1, price: 2, threshold: 0 });
    db.prepare('UPDATE products SET stock=?,inventory_value_cents=? WHERE id=?').run(stock, stock * 100, product.id);
    products.push(db.prepare('SELECT * FROM products WHERE id=?').get(product.id));
  }
  const definition = { name: '桌子配方', product_id: products[0].id, base_quantity: 1, base_unit: '张', note: '', enabled: 1,
    items: products.slice(2).map((product, i) => ({ product_id: product.id, quantity: [1, 4, 16][i], unit: product.unit, note: '' })) };
  return { base, db, post, products, definition, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} creates a recipe, merges repeated materials, calculates and exports frozen stock, copies and toggles status`, async ({ page }) => {
    test.setTimeout(60000);
    if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    const f = await fixture(page), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      const before = f.db.prepare('SELECT * FROM products ORDER BY id').all();
      await page.goto(f.base + '/#bom');
      await expect(page.getByRole('group', { name: '业务模式' }).getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: '新建用料清单', exact: true }).click();
      await page.getByRole('searchbox', { name: '搜索成品', exact: true }).fill('TABLE-001');
      await page.getByRole('button', { name: '选择成品 示例桌子', exact: true }).click();
      await page.getByLabel('清单名称', { exact: true }).fill('桌子配方');
      await page.getByLabel('基准产量', { exact: true }).fill('2');
      const material = page.getByRole('searchbox', { name: '搜索材料', exact: true });
      await material.fill('桌面');
      await page.getByRole('button', { name: '添加材料 桌面材料', exact: true }).click();
      await page.getByLabel('桌面材料用量', { exact: true }).fill('2');
      await material.fill('LEG-001');
      await page.getByRole('button', { name: '按条码添加', exact: true }).click();
      await expect(page.getByLabel('桌腿材料用量', { exact: true })).toHaveValue('1');
      await material.fill('LEG-001');
      await page.getByRole('button', { name: '按条码添加', exact: true }).click();
      await expect(page.getByLabel('桌腿材料用量', { exact: true })).toHaveValue('2');
      await page.getByLabel('桌腿材料用量', { exact: true }).fill('8');
      await material.fill('螺丝');
      await page.getByRole('button', { name: '添加材料 螺丝材料', exact: true }).click();
      await page.getByLabel('螺丝材料用量', { exact: true }).fill('32');
      await page.screenshot({ path: test.info().outputPath('bom-editor.png'), fullPage: true });
      await page.getByRole('button', { name: '保存用料清单', exact: true }).click();
      await expect(page.locator('.bom-success')).toContainText('用料清单已保存');
      await page.getByRole('button', { name: '测算备料', exact: true }).click();
      await page.getByLabel('生产数量', { exact: true }).fill('10');
      await page.getByRole('button', { name: '开始测算', exact: true }).click();
      await expect(page.locator('.bom-result-summary')).toHaveText('共 3 种材料，2 种缺料。');
      const rows = page.locator('.bom-result-table tbody tr');
      await expect(rows.nth(0).locator('td').nth(2)).toHaveText('10 块');
      await expect(rows.nth(0).locator('td').nth(4)).toHaveText('2 块');
      await expect(rows.nth(2).locator('td').nth(4)).toHaveText('60 颗');
      await page.screenshot({ path: test.info().outputPath('bom-result.png'), fullPage: true });
      expect(f.db.prepare('SELECT * FROM products ORDER BY id').all()).toEqual(before);
      expect(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n).toBe(0);
      f.db.prepare('UPDATE products SET stock=99 WHERE id=?').run(f.products[2].id);
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出备料表', exact: true }).click();
      const csv = parseCSV(await readFile(await (await downloaded).path(), 'utf8'));
      expect(csv[5].slice(4, 8)).toEqual(['2', '10', '8', '2']);
      if (mobile) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.setViewportSize({ width: 844, height: 390 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page.getByLabel('生产数量', { exact: true }).fill('20');
      await expect(page.getByRole('button', { name: '导出备料表', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '返回用料清单', exact: true }).click();
      await page.getByRole('button', { name: '复制', exact: true }).click();
      await expect(page.getByLabel('基准产量', { exact: true })).toHaveValue('2');
      await expect(page.getByLabel('螺丝材料用量', { exact: true })).toHaveValue('32');
      await expect(page.getByRole('button', { name: '保存用料清单', exact: true })).toBeDisabled();
      await page.getByRole('searchbox', { name: '搜索成品', exact: true }).fill('TABLE-002');
      await page.getByRole('button', { name: '选择成品 小号桌子', exact: true }).click();
      await page.getByRole('button', { name: '保存用料清单', exact: true }).click();
      await expect(page.locator('.bom-list-item')).toHaveCount(2);
      const original = page.locator('.bom-list-item').filter({ has: page.getByText('桌子配方', { exact: true }) });
      await original.getByRole('button', { name: '停用', exact: true }).click();
      await expect(original.getByText('已停用', { exact: true })).toBeVisible();
      await expect(original.getByRole('button', { name: '测算备料', exact: true })).toBeDisabled();
      await original.getByRole('button', { name: '启用', exact: true }).click();
      await expect(original.getByRole('button', { name: '测算备料', exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
    } finally { await f.close(); }
  });

  test(`${mobile ? 'mobile' : 'desktop'} opens a product's BOM and protects unsaved edits and concurrent changes`, async ({ page }) => {
    if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    const f = await fixture(page);
    try {
      const bom = await f.post('/boms', f.definition);
      await page.goto(f.base + '/#products');
      await page.getByRole('button', { name: mobile ? /^示例桌子，库存/ : '查看 示例桌子 物料详情' }).click();
      await page.getByRole('button', { name: '查看用料清单', exact: true }).click();
      await expect(page).toHaveURL(/#bom$/);
      await expect(page.locator('.bom-list-item')).toHaveCount(1);
      await expect(page.locator('.bom-filter-product')).toContainText('示例桌子');
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await page.getByLabel('清单名称', { exact: true }).fill('本地未保存');
      const nav = page.getByRole('navigation', { name: mobile ? '移动端主导航' : '主导航', exact: true });
      await nav.getByRole(mobile ? 'button' : 'link', { name: mobile ? '用料' : '用料清单', exact: true }).click();
      await expect(page.getByLabel('清单名称', { exact: true })).toHaveValue('本地未保存');
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('group', { name: '业务模式' }).getByRole('button', { name: '仓储', exact: true }).click();
      await expect(page).toHaveURL(/#bom$/);
      await expect(page.getByLabel('清单名称', { exact: true })).toHaveValue('本地未保存');
      await f.post(`/boms/${bom.id}`, { ...f.definition, name: '另一设备已保存', version: bom.version });
      await page.getByRole('button', { name: '保存用料清单', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('已被修改');
      await expect(page.getByLabel('清单名称', { exact: true })).toHaveValue('本地未保存');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '重新读取已保存清单', exact: true }).click();
      await expect(page.getByLabel('清单名称', { exact: true })).toHaveValue('另一设备已保存');
      await page.getByRole('button', { name: '返回用料清单', exact: true }).click();
    } finally { await f.close(); }
  });
}

test('mobile PWA loads the BOM route, scans a material and keeps the form when returning from the camera', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone, serviceWorkers: 'allow' });
  const page = await context.newPage(), f = await fixture(page);
  try {
    await page.addInitScript(() => {
      window.BarcodeDetector = class { static async getSupportedFormats() { return ['code_128']; } async detect() { return [{ rawValue: 'TOP-001' }]; } };
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 800;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, 640, 800);
        return canvas.captureStream(10);
      };
    });
    await page.goto(f.base + '/#bom');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: '新建用料清单', exact: true }).click();
    await page.getByLabel('清单名称', { exact: true }).fill('PWA扫码配方');
    await page.getByRole('button', { name: '扫码添加材料', exact: true }).click();
    await expect(page.getByLabel('桌面材料用量', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('清单名称', { exact: true })).toHaveValue('PWA扫码配方');
    await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Saved data remains on the server; leaving the unfinished form is explicit.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '返回用料清单', exact: true }).click();
    expect(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n).toBe(0);
  } finally { await context.close(); await f.close(); }
});
