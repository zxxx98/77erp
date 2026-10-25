import { test, expect, devices } from '@playwright/test';

for (const device of ['desktop', 'Pixel 7', 'iPhone 13']) {
  test(`${device}: production type can be set, edited, cleared and viewed`, async ({ browser }) => {
    const context = await browser.newContext({ locale: 'zh-CN', ...(device === 'desktop' ? {} : devices[device]), baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
      expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
      const warehouse = await (await context.request.post('/api/warehouses', { data: { name: `生产类型-${device}-${Date.now()}` } })).json();
      const headers = { 'X-Warehouse-ID': String(warehouse.id) };
      const product = await (await context.request.post('/api/products', { headers, data: { name: '类型测试物料', category: '其他', unit: '个', cost: 1, price: 2, threshold: 0 } })).json();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const mobile = device !== 'desktop';
      await page.goto(`/?warehouse_id=${warehouse.id}#products`);
      const row = () => page.locator(mobile ? '.mw-product-list .mw-product-row' : '.product-table tbody tr').filter({ hasText: '类型测试物料' });
      for (const type of ['成品', '半成品', '原料', '未设置']) {
        if (mobile) {
          await row().getByRole('button', { name: '类型测试物料，库存 0 个', exact: true }).click();
          await page.getByRole('button', { name: '编辑物料', exact: true }).click();
        } else await row().getByRole('button', { name: '编辑', exact: true }).click();
        await page.getByRole('combobox', { name: '生产类型', exact: true }).click();
        await page.getByText(type, { exact: true }).filter({ visible: true }).last().click();
        await page.getByRole('button', { name: '保存物料', exact: true }).click();
        await expect(page.getByRole('combobox', { name: '生产类型', exact: true })).toHaveCount(0);
        await expect.poll(async () => (await (await context.request.get(`/api/products/${product.id}`, { headers })).json()).product.production_type).toBe(type === '未设置' ? '' : type);
        if (type !== '未设置' || !mobile) await expect(row()).toContainText(type);
      }
      await row().getByRole('button', { name: mobile ? '类型测试物料，库存 0 个' : '查看 类型测试物料 物料详情', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('生产类型');
      await expect(page.getByRole('dialog')).toContainText('未设置');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
