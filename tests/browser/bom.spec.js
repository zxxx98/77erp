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
      await page.getByRole('button', { name: '新建BOM', exact: true }).click();
      await page.getByRole('searchbox', { name: '搜索成品', exact: true }).fill('TABLE-001');
      await page.getByRole('button', { name: '选择成品 示例桌子', exact: true }).click();
      await page.getByLabel('BOM 名称', { exact: true }).fill('桌子配方');
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
      await page.getByRole('button', { name: '保存BOM', exact: true }).click();
      await expect(page.locator('.bom-success')).toContainText('BOM已保存');
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
      await page.getByRole('button', { name: '返回BOM', exact: true }).click();
      await page.getByRole('button', { name: '复制', exact: true }).click();
      await expect(page.getByLabel('基准产量', { exact: true })).toHaveValue('2');
      await expect(page.getByLabel('螺丝材料用量', { exact: true })).toHaveValue('32');
      await expect(page.getByRole('button', { name: '保存BOM', exact: true })).toBeEnabled();
      await page.getByRole('searchbox', { name: '搜索成品', exact: true }).fill('TABLE-002');
      await page.getByRole('button', { name: '选择成品 小号桌子', exact: true }).click();
      await page.getByRole('button', { name: '保存BOM', exact: true }).click();
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
      await page.getByRole('button', { name: '查看BOM', exact: true }).click();
      await expect(page).toHaveURL(/#bom$/);
      await expect(page.locator('.bom-list-item')).toHaveCount(1);
      await expect(page.locator('.bom-filter-product')).toContainText('示例桌子');
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await page.getByLabel('BOM 名称', { exact: true }).fill('本地未保存');
      const nav = page.getByRole('navigation', { name: mobile ? '移动端主导航' : '主导航', exact: true });
      await nav.getByRole(mobile ? 'button' : 'link', { name: 'BOM', exact: true }).click();
      await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('本地未保存');
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('group', { name: '业务模式' }).getByRole('button', { name: '仓储', exact: true }).click();
      await expect(page).toHaveURL(/#bom$/);
      await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('本地未保存');
      await f.post(`/boms/${bom.id}`, { ...f.definition, name: '另一设备已保存', version: bom.version });
      await page.getByRole('button', { name: '保存BOM', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('已被修改');
      await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('本地未保存');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '重新读取已保存 BOM', exact: true }).click();
      await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('另一设备已保存');
      await page.getByRole('button', { name: '返回BOM', exact: true }).click();
    } finally { await f.close(); }
  });
}

async function fractionalRecipeFlow(page, pwa = false) {
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const products = [];
    for (const [name, barcode, unit] of [['电线成品', 'WIRE', '条'], ['包装纸箱', 'CARTON', '个'], ['分摊辅料', 'EXTRA', '米']]) {
      const product = await f.post('/products', { name, barcode, unit, category: '生产', cost: 1, price: 2, threshold: 0 });
      products.push(product);
    }
    for (const product of products.slice(1)) f.db.prepare('UPDATE products SET stock=10,inventory_value_cents=1000 WHERE id=?').run(product.id);
    await page.goto(f.base + '/#bom');
    if (pwa) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: '新建BOM', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索成品', exact: true }).fill('WIRE');
    await page.getByRole('button', { name: '选择成品 电线成品', exact: true }).click();
    const search = page.getByRole('searchbox', { name: '搜索材料', exact: true });
    await search.fill('CARTON');
    await page.getByRole('button', { name: '按条码添加', exact: true }).click();
    const carton = page.getByLabel('包装纸箱用量', { exact: true });
    await expect(carton).toHaveAttribute('inputmode', 'text');
    await carton.fill('1/40');
    await expect(page.getByText('折合约 0.025 个，按原分数测算。', { exact: false })).toBeVisible();
    await search.fill('CARTON');
    await page.getByRole('button', { name: '按条码添加', exact: true }).click();
    await expect(carton).toHaveValue('41/40');
    await carton.fill('1/0');
    await page.getByRole('button', { name: '保存BOM', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('分子、分母');
    await expect(carton).toHaveValue('1/0');
    await carton.fill('1/40');
    await search.fill('EXTRA');
    await page.getByRole('button', { name: '按条码添加', exact: true }).click();
    await page.getByLabel('分摊辅料用量', { exact: true }).fill('1/3');
    await page.screenshot({ path: test.info().outputPath('bom-fractions.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '保存BOM', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('BOM已保存');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByLabel('包装纸箱用量', { exact: true })).toHaveValue('1/40');
    await expect(page.getByLabel('分摊辅料用量', { exact: true })).toHaveValue('1/3');
    // Merely opening a saved fractional recipe must not mark it as changed.
    await page.getByRole('button', { name: '返回BOM', exact: true }).click();
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await expect(page.getByLabel('包装纸箱用量', { exact: true })).toHaveValue('1/40');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '测算备料', exact: true }).click();
    await page.getByLabel('生产数量', { exact: true }).fill('40');
    await page.getByRole('button', { name: '开始测算', exact: true }).click();
    const rows = page.locator('.bom-result-table tbody tr');
    await expect(rows.first().locator('td').nth(1)).toHaveText('1/40 个标准损耗率 0%');
    await expect(rows.first().locator('td').nth(2)).toHaveText('1 个');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出备料表', exact: true }).click();
    const csv = parseCSV(await readFile(await (await downloaded).path(), 'utf8'));
    expect(csv[5][4]).toBe('1/40（约 0.025）');
    await page.getByLabel('生产数量', { exact: true }).fill('3');
    await page.getByRole('button', { name: '开始测算', exact: true }).click();
    await expect(rows.nth(1).locator('td').nth(2)).toHaveText('1 米');
    await page.getByRole('button', { name: '按本次数量新建生产单', exact: true }).click();
    await expect(page.getByRole('heading', { name: '新建生产单', exact: true })).toBeVisible();
    await expect(page.locator('.production-material').nth(1)).toContainText('计划用量1 米');
    await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
    await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
    await page.getByLabel('计划产量', { exact: true }).fill('6');
    await expect(page.locator('.production-material').nth(1)).toContainText('计划用量2 米');
    await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
    await page.getByRole('button', { name: '登记完工', exact: true }).click();
    await expect(page.getByLabel('包装纸箱实际耗料', { exact: true })).toHaveValue('0.15');
    await expect(page.getByLabel('分摊辅料实际耗料', { exact: true })).toHaveValue('2');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '本批入库并结束生产', exact: true }).click();
    await expect(page.locator('.bom-success')).toContainText('合格成品已入库');
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(products[1].id).stock).toBe(9.85);
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(products[2].id).stock).toBe(8);
    expect(errors).toEqual([]);
  } finally { await f.close(); }
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} enters and preserves fractions, exports ratios and completes production with exact scaled consumption`, async ({ page }) => {
    test.setTimeout(60000);
    if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    await fractionalRecipeFlow(page);
  });
}

test('mobile PWA preserves fractional BOM recipes and exact production quantities with an active service worker', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone, serviceWorkers: 'allow' });
  try { await fractionalRecipeFlow(await context.newPage(), true); }
  finally { await context.close(); }
});

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
    await page.getByRole('button', { name: '新建BOM', exact: true }).click();
    await page.getByLabel('BOM 名称', { exact: true }).fill('PWA扫码配方');
    await page.getByRole('button', { name: '扫码添加材料', exact: true }).click();
    await expect(page.getByLabel('桌面材料用量', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('PWA扫码配方');
    await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Saved data remains on the server; leaving the unfinished form is explicit.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '返回BOM', exact: true }).click();
    expect(f.db.prepare('SELECT COUNT(*) n FROM boms').get().n).toBe(0);
  } finally { await context.close(); await f.close(); }
});

for (const profile of ['desktop', 'iphone', 'android-pwa']) {
  test(`${profile} selects among child recipes, copies the same product and completes a frozen multilevel order`, async ({ page: defaultPage, browser }) => {
    test.setTimeout(90000);
    const context = profile === 'android-pwa' ? await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'allow', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' }) : null;
    const page = context ? await context.newPage() : defaultPage;
    if (profile === 'iphone') { await page.setViewportSize({ width: 390, height: 844 }); await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone); }
    const { chooseOption } = await import('./dropdown-helpers.js');
    const f = await fixture(page), errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      const childBody = { ...f.definition, product_id: f.products[2].id, base_unit: f.products[2].unit,
        items: [{ product_id: f.products[4].id, quantity: 3, unit: f.products[4].unit, note: '' }] };
      const child = await f.post('/boms', { ...childBody, name: '桌面标准配方' });
      const alternate = await f.post('/boms', { ...childBody, name: '桌面替代配方', items: [{ ...childBody.items[0], quantity: 6 }] });
      await f.post('/boms', { ...f.definition, items: [{ product_id: f.products[2].id, quantity: 0.333334, quantity_fraction: '1/3', unit: f.products[2].unit, note: '', usage_mode: 'explode', child_bom_id: child.id }] });
      const before = f.db.prepare('SELECT stock,inventory_value_cents FROM products ORDER BY id').all();
      await page.goto(f.base + '/#bom');
      if (context) await page.evaluate(() => navigator.serviceWorker.ready);
      await page.getByRole('searchbox', { name: '搜索BOM', exact: true }).fill('桌子配方');
      await page.getByRole('button', { name: '复制', exact: true }).click();
      await expect(page.getByText('成品：示例桌子', { exact: true })).toBeVisible();
      await expect(page.getByLabel('BOM 名称', { exact: true })).toHaveValue('桌子配方副本');
      await chooseOption(page.getByRole('combobox', { name: '桌面材料用料方式', exact: true }), 'stock');
      await chooseOption(page.getByRole('combobox', { name: '桌面材料用料方式', exact: true }), 'explode');
      await page.getByRole('button', { name: `选择下级配方 桌面替代配方 #${alternate.id}`, exact: true }).click();
      await page.getByRole('button', { name: '查看下级配方', exact: true }).click();
      await expect(page.locator('.bom-child-preview')).toContainText('螺丝材料 · 6 颗');
      await page.getByRole('button', { name: '保存BOM', exact: true }).click();
      const copied = page.locator('.bom-list-item').filter({ has: page.getByText('桌子配方副本', { exact: true }) });
      await copied.getByRole('button', { name: '测算备料', exact: true }).click();
      await page.getByLabel('生产数量', { exact: true }).fill('3');
      await page.getByRole('button', { name: '开始测算', exact: true }).click();
      await expect(page.locator('.bom-result-summary')).toHaveText('共 1 种材料，0 种缺料。');
      await expect(page.locator('.bom-result-table tbody tr')).toContainText('6 颗');
      await expect(page.locator('.bom-warning')).toContainText('中间半成品库存未抵扣');
      await page.getByText('结构与各层需求', { exact: true }).click();
      await page.locator('.bom-structure-list > li > details > summary').click();
      await expect(page.locator('.bom-structure')).toContainText(`桌面替代配方 #${alternate.id}`);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出结构明细', exact: true }).click();
      const exported = await readFile(await (await download).path(), 'utf8');
      expect(exported).toContain('1/3'); expect(exported).toContain('桌面替代配方');
      await page.getByRole('button', { name: '按本次数量新建生产单', exact: true }).click();
      await page.getByRole('button', { name: /^选择配方 示例桌子 · 桌子配方副本 #/ }).click();
      await page.getByLabel('计划产量', { exact: true }).fill('3');
      await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
      await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
      await f.post(`/boms/${alternate.id}`, { ...childBody, name: alternate.name, version: alternate.version, items: [{ ...childBody.items[0], quantity: 9 }] });
      await page.getByRole('button', { name: '登记完工', exact: true }).click();
      await expect(page.getByLabel('螺丝材料实际耗料', { exact: true })).toHaveValue('6');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '本批入库并继续生产', exact: true }).click();
      await expect(page.locator('.bom-success')).toContainText('继续生产');
      await page.getByRole('button', { name: '登记完工', exact: true }).click();
      await expect(page.getByLabel('螺丝材料实际耗料', { exact: true })).toHaveValue('2');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '本批入库并结束生产', exact: true }).click();
      await expect(page.locator('.production-summary')).toContainText('4 张');
      const stock = f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.products[2].id).stock;
      expect(stock).toBe(8);
      expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.products[4].id).stock).toBe(92);
      await page.getByRole('button', { name: '作废生产单', exact: true }).click();
      await page.getByLabel('作废原因', { exact: true }).fill('多层生产回退');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '确认作废', exact: true }).click();
      await expect(page.locator('.bom-success')).toContainText('已作废');
      expect(f.db.prepare('SELECT stock,inventory_value_cents FROM products ORDER BY id').all()).toEqual(before);
      expect(errors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('multilevel-production.png'), fullPage: true });
    } finally { await f.close(); await context?.close(); }
  });
}
