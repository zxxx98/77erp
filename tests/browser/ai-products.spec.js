import { test, expect, devices } from '@playwright/test';
import sharp from 'sharp';

for (const device of [null, 'Pixel 7', 'iPhone 13']) test(`${device || 'desktop'} AI product attributes, image upload, sync preview and confirmation`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', serviceWorkers: device === 'iPhone 13' ? 'allow' : 'block', ...(device ? devices[device] : { viewport: { width: 1440, height: 1000 } }) });
  try {
    const setup = await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
    expect([201, 409]).toContain(setup.status());
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    expect((await context.request.put('/api/settings/ai', { data: { enabled: true, writes: true, base_url: 'https://ai.77erp.test/v1', model: 'test-model', secret: 'browser-test-key', daily_limit: 100 } })).ok()).toBe(true);
    expect((await context.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } })).ok()).toBe(true);
    const warehouse = await (await context.request.post('/api/warehouses', { data: { name: `属性源仓-${device}-${Date.now()}` } })).json();
    const target = await (await context.request.post('/api/warehouses', { data: { name: `属性同步仓-${device}-${Date.now()}` } })).json();
    const headers = { 'X-Warehouse-ID': String(warehouse.id) };
    const created = await (await context.request.post('/api/products', { headers, data: { name: 'AI属性测试物料', barcode: 'AI-PRODUCT', category: '属性分类', unit: '个', cost: 1, price: 2, threshold: 0, production_type: '原料', sync_warehouse_ids: [target.id] } })).json();
    expect(created.id).toBeTruthy();
    const data = async id => (await (await context.request.get(`/api/data?warehouse_id=${id}`)).json()).products;
    const original = (await data(warehouse.id))[0], targetOriginal = (await data(target.id))[0];
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://img.77erp.test/file/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
    await page.goto(`/?warehouse_id=${warehouse.id}`);
    if (device === 'iPhone 13') await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const open = async () => {
      if (device) await page.getByRole('button', { name: '更多', exact: true }).click();
      await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    };
    await open();
    await page.locator('.ai-upload-help summary').click();
    const image = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#2563eb' } }).png().toBuffer();
    await page.getByLabel('上传物料图片', { exact: true }).setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: image });
    await expect(page.getByLabel('你的需求')).toHaveValue(/物料图片 URL：https:\/\/img\.77erp\.test\/file\//);
    const url = (await page.getByLabel('你的需求').inputValue()).split('：')[1];
    expect((await data(warehouse.id))[0].image).toBe('');
    const changes = { active: 0, production_type: '半成品', note: '通过AI修改', specification: '新规格', cost: 3.5, unit_round_up: 1, threshold: 1.2, image: url };
    await page.getByLabel('你的需求').fill('修改物料参数：' + JSON.stringify({ warehouse_id: warehouse.id, items: [{ product_id: created.id, version: created.version, changes, sync_warehouse_ids: [target.id] }] }));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const action = page.locator('.ai-action');
    await expect(action).toContainText('修改物料预览 · 待确认');
    await expect(action).toContainText(target.name);
    await expect(action.getByRole('row').filter({ hasText: '生产类型' }).first()).toContainText('原料');
    await expect(action.getByRole('row').filter({ hasText: '生产类型' }).first()).toContainText('半成品');
    await expect(action.getByRole('row').filter({ hasText: '安全库存' }).first()).toContainText('2');
    await expect(action.locator('img').first()).toBeVisible();
    expect((await data(warehouse.id))[0]).toEqual(original);
    expect((await data(target.id))[0]).toEqual(targetOriginal);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Pending cards survive reload, including in the PWA-controlled context.
    await page.reload(); await open();
    await expect(action).toContainText('修改物料预览 · 待确认');
    await action.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(page.locator('.ai-action-result')).toContainText('已完成，已修改 1 种物料');
    const saved = (await data(warehouse.id))[0], synced = (await data(target.id))[0];
    expect(saved).toMatchObject({ ...changes, threshold: 2, stock: original.stock });
    expect(synced).toMatchObject({ ...changes, active: 1, threshold: 2, stock: targetOriginal.stock });
    await page.getByRole('button', { name: '查看操作详情', exact: true }).click();
    await expect(action).toContainText('修改物料预览 · 已完成');
    await expect(action.getByRole('button', { name: '确认执行本批操作' })).toHaveCount(0);
    await page.reload(); await open();
    await expect(page.locator('.ai-action-result')).toContainText('已完成，已修改 1 种物料');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
