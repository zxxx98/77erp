import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile Web' : 'desktop Web'}: material history, active default, catalog reuse and warehouse deletion`, async ({ browser }) => {
    const context = await browser.newContext({ ...(mobile ? devices['Pixel 7'] : {}), baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
      expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
      const suffix = `${mobile ? 'mobile' : 'desktop'}-${Date.now()}`;
      const source = await (await context.request.post('/api/warehouses', { data: { name: `记录来源-${suffix}` } })).json();
      const headers = { 'X-Warehouse-ID': String(source.id) };
      const root = await (await context.request.post('/api/categories', { headers, data: { name: '完整分类' } })).json();
      const child = await (await context.request.post('/api/categories', { headers, data: { name: '子分类', parent_id: root.id } })).json();
      await context.request.post('/api/categories', { headers, data: { name: '空分类' } });
      const body = { name: `记录物料-${suffix}`, barcode: `HIST-${suffix}`, category_id: child.id, unit: '件', cost: 10, price: 20, threshold: 1 };
      const product = await (await context.request.post('/api/products', { headers, data: body })).json();
      const inactive = await (await context.request.post('/api/products', { headers, data: { ...body, name: `停用物料-${suffix}`, barcode: `OFF-${suffix}` } })).json();
      expect((await context.request.post(`/api/products/${inactive.id}/status`, { headers, data: { active: 0 } })).ok()).toBe(true);
      let order;
      for (let i = 0; i < 21; i++) {
        const response = await context.request.post('/api/orders', { headers, data: { type: 'in', partner: '记录供应商', items: [{ product_id: product.id, quantity: 1, price: 10 }] } });
        expect(response.ok()).toBe(true);
        order = await response.json();
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/?warehouse_id=${source.id}#products`);
      const status = page.getByRole('group', { name: mobile ? '使用状态' : '物料使用状态', exact: true });
      await expect(status.getByRole('button', { name: '已启用', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const rows = page.locator(mobile ? '.mw-product-list .mw-product-row' : '.product-table tbody tr');
      await expect(rows).toHaveCount(1);
      await status.getByRole('button', { name: '全部状态', exact: true }).click();
      await expect(rows).toHaveCount(2);
      await status.getByRole('button', { name: '已启用', exact: true }).click();
      await rows.getByRole('button', { name: mobile ? `${body.name}，库存 21 件` : `查看 ${body.name} 物料详情`, exact: true }).click();
      await page.getByRole('button', { name: '查看操作记录', exact: true }).click();
      const history = page.getByRole('region', { name: '当前物料操作记录', exact: true });
      await expect(history.locator('li')).toHaveCount(20);
      await history.getByRole('button', { name: '加载更多记录', exact: true }).click();
      await expect(history.locator('li')).toHaveCount(21);
      await history.getByRole('button', { name: '收起操作记录', exact: true }).click();
      await history.getByRole('button', { name: '查看操作记录', exact: true }).click();
      await expect(history.locator('li')).toHaveCount(20);
      await history.getByRole('button', { name: order.number, exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText(order.number);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).first().click();
      const openSettings = async () => {
        if (mobile) {
          await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: '更多', exact: true }).click();
          await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click();
        } else await page.getByRole('button', { name: '系统设置', exact: true }).click();
      };
      await openSettings();
      const copiedName = `复用仓库-${suffix}`;
      await page.getByRole('textbox', { name: '新仓库名称', exact: true }).fill(copiedName);
      await page.getByRole('radio', { name: '复用分类和物料信息', exact: true }).check();
      await page.getByRole('button', { name: '新增仓库', exact: true }).click();
      await expect(page.locator('.warehouse-row').filter({ hasText: copiedName })).toBeVisible();
      const warehouses = await (await context.request.get('/api/warehouses')).json();
      const copied = warehouses.find(w => w.name === copiedName);
      const data = await (await context.request.get('/api/data', { headers: { 'X-Warehouse-ID': String(copied.id) } })).json();
      expect(data.categories).toHaveLength(3);
      expect(data.products).toHaveLength(2);
      expect(data.products.every(p => p.stock === 0)).toBe(true);
      expect(data.products.find(p => p.barcode === `OFF-${suffix}`).active).toBe(0);
      expect(data.orders).toHaveLength(0);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: `删除仓库 ${source.name}`, exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('不能删除');
      const copiedHeaders = { 'X-Warehouse-ID': String(copied.id) };
      const copiedProduct = data.products.find(p => p.active !== 0);
      const inbound = await context.request.post('/api/orders', { headers: copiedHeaders, data: { type: 'in', partner: '删除验证供应商', items: [{ product_id: copiedProduct.id, quantity: 1, price: 10 }] } });
      expect(inbound.ok()).toBe(true);
      const inboundId = (await inbound.json()).id;
      expect((await context.request.post(`/api/orders/${inboundId}/payments`, { headers: copiedHeaders, data: { request_id: randomUUID(), amount: 1, method: '现金', note: '' } })).ok()).toBe(true);
      expect((await context.request.post('/api/orders', { headers: copiedHeaders, data: { type: 'out', partner: '删除验证客户', items: [{ product_id: copiedProduct.id, quantity: 1, price: 20 }] } })).ok()).toBe(true);
      expect((await context.request.post('/api/stocktakes', { headers: copiedHeaders, data: { request_id: randomUUID(), reason: '零库存盘点', items: [{ product_id: copiedProduct.id, expected_stock: 0, counted: 0 }] } })).ok()).toBe(true);
      await page.goto(`/?warehouse_id=${copied.id}#products`);
      await openSettings();
      const deleteButton = page.getByRole('button', { name: `删除仓库 ${copiedName}`, exact: true });
      page.once('dialog', async dialog => {
        expect(dialog.message()).toContain('全部历史单据');
        expect(dialog.message()).toContain('收付款记录');
        expect(dialog.message()).toContain('永久删除');
        await dialog.dismiss();
      });
      await deleteButton.click();
      await expect(deleteButton).toBeVisible();
      page.once('dialog', dialog => dialog.accept());
      await deleteButton.click();
      await expect(deleteButton).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('77erp-warehouse'))).toBe('1');
      expect((await context.request.get('/api/data', { headers: { 'X-Warehouse-ID': String(copied.id) } })).status()).toBe(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
