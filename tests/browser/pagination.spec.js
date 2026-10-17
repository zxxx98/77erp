import { test, expect, devices } from '@playwright/test';
import { createApp } from '../../server/app.js';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} loads bounded lists, searches unloaded products and opens order details on demand`, async ({ browser }) => {
    const { app, db } = createApp(':memory:');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ baseURL, ...(mobile ? devices['Pixel 7'] : {}), serviceWorkers: 'block' });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'paging', password: 'Test-password-123' } });
      await context.request.post('/api/settings/reset', { data: { confirmation: 'RESET_BUSINESS_DATA' } });
      for (let i = 0; i < 125; i++) {
        const name = `分页物料${String(i).padStart(3, '0')}`;
        const response = await context.request.post('/api/products', { data: { name, barcode: `PAGE-${i}`, category: '分页', unit: '件', cost: 10, price: 20, threshold: 0 } });
        expect(response.status()).toBe(201);
        const product = await response.json();
        expect((await context.request.post('/api/orders', { data: { type: 'in', partner: name, items: [{ product_id: product.id, quantity: 1, price: 10 }] } })).ok()).toBe(true);
      }
      const legacyBytes = (await (await context.request.get('/api/data')).body()).length;
      const bootstrapBytes = (await (await context.request.get('/api/workspace')).body()).length;
      expect(bootstrapBytes).toBeLessThan(legacyBytes / 10);
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push(url); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/#products');
      if (mobile) {
        await expect(page.locator('.mw-product-list .mw-product-row')).toHaveCount(30);
        for (const count of [60, 90, 120, 125]) {
          await page.getByRole('button', { name: '加载更多物料' }).click();
          await expect(page.locator('.mw-product-list .mw-product-row')).toHaveCount(count);
        }
        await expect(page.getByRole('button', { name: '加载更多物料' })).toHaveCount(0);
        await page.locator('.mw-search input').fill('分页物料124');
        await expect(page.locator('.mw-product-list .mw-product-row')).toHaveCount(1);
      } else {
        await expect(page.locator('.product-table tbody tr')).toHaveCount(8);
        await page.getByRole('button', { name: '下一页' }).click();
        await expect(page.locator('.product-table tbody')).toContainText('分页物料008');
        await page.getByRole('textbox', { name: '筛选物料' }).fill('分页物料124');
        await expect(page.locator('.product-table tbody tr')).toHaveCount(1);
      }
      await expect(page.getByText('分页物料124', { exact: true }).first()).toBeVisible();
      await page.goto('/#history');
      if (mobile) {
        await expect(page.locator('.mw-order-summary')).toHaveCount(30);
        for (const count of [60, 90, 120, 125]) {
          await page.getByRole('button', { name: '加载更多单据' }).click();
          await expect(page.locator('.mw-order-summary')).toHaveCount(count);
        }
        await page.locator('.mw-order-summary').first().click();
      } else {
        await expect(page.locator('.orders-table tbody tr')).toHaveCount(8);
        await expect(page.locator('.order-summary')).toContainText('1,250.00');
        await page.locator('.orders-table tbody tr').first().click();
      }
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(requests.some(url => /^\/api\/orders\/\d+$/.test(url.pathname))).toBe(true);
      expect(requests.some(url => url.pathname === '/api/data')).toBe(false);
      expect(requests.filter(url => ['/api/products', '/api/orders'].includes(url.pathname)).every(url => Number(url.searchParams.get('limit')) <= 30)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    }
  });
}
