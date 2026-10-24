import { test, expect, devices } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile Web/PWA' : 'desktop'} stock alerts exclude inactive products and refresh after reactivation`, async ({ browser }) => {
    const context = await browser.newContext({ ...(mobile ? devices['Pixel 7'] : {}), baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
      expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
      const warehouse = await (await context.request.post('/api/warehouses', { data: { name: `预警验收-${mobile}-${Date.now()}` } })).json();
      const headers = { 'X-Warehouse-ID': String(warehouse.id) };
      const products = [];
      for (const [name, quantity] of [['预警低库存物料', 1], ['预警缺货物料', 0]]) {
        const created = await context.request.post('/api/products', { headers, data: { name, barcode: `ALERT-${quantity}`, category: '预警', unit: '个', cost: 10, price: 20, threshold: 2 } });
        expect(created.status(), await created.text()).toBe(201);
        const product = { ...await created.json(), name };
        products.push(product);
        if (quantity) expect((await context.request.post('/api/orders', { headers, data: { type: 'in', partner: '供应商', items: [{ product_id: product.id, quantity, price: 10 }] } })).ok()).toBe(true);
      }
      const page = await context.newPage();
      const home = `/?warehouse_id=${warehouse.id}`;
      await page.goto(`${home}#overview`);
      const warning = mobile ? page.locator('.mw-card').filter({ has: page.getByRole('heading', { name: '库存预警', exact: true }) }) : page.locator('.warning-panel');
      await expect(warning).toContainText('2 件物料');
      for (const p of products) await expect(warning.getByText(p.name, { exact: true })).toBeVisible();

      for (const p of products) expect((await context.request.post(`/api/products/${p.id}/status`, { headers, data: { active: 0 } })).ok()).toBe(true);
      await page.reload();
      await expect(warning).toContainText('0 件物料');
      for (const p of products) await expect(warning.getByText(p.name, { exact: true })).toHaveCount(0);
      if (mobile) {
        await page.locator('.mw-tabs').getByRole('button', { name: '库存', exact: true }).click();
        await page.getByRole('button', { name: '库存预警', exact: true }).click();
        await expect(page.locator('.mw-product-list')).toBeEmpty();
        await page.getByRole('button', { name: '缺货', exact: true }).click();
        await expect(page.locator('.mw-product-list')).toBeEmpty();
      } else {
        await page.goto(`${home}#inventory`);
        await page.getByRole('button', { name: /^库存预警/ }).click();
        await expect(page.locator('.data-table tbody tr')).toHaveCount(0);
        await page.getByRole('button', { name: /^已缺货/ }).click();
        await expect(page.locator('.data-table tbody tr')).toHaveCount(0);
      }
      for (const p of products) expect((await context.request.post(`/api/products/${p.id}/status`, { headers, data: { active: 1 } })).ok()).toBe(true);
      await page.goto(`${home}#overview`);
      await expect(warning).toContainText('2 件物料');
      for (const p of products) await expect(warning.getByText(p.name, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile Web/PWA' : 'desktop'} zero safety stock disables warning badges, lists and counters`, async ({ browser }) => {
    const context = await browser.newContext({ ...(mobile ? devices['iPhone 13'] : {}), baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
      expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
      const warehouse = await (await context.request.post('/api/warehouses', { data: { name: `零安全库存-${mobile}-${Date.now()}` } })).json();
      const headers = { 'X-Warehouse-ID': String(warehouse.id) };
      const products = [];
      for (const [name, threshold] of [['无需预警物料', 0], ['需要预警物料', 2]]) {
        const response = await context.request.post('/api/products', { headers, data: { name, barcode: threshold ? 'ALERT-ON' : 'ALERT-OFF', category: '预警', unit: '件', cost: 10, price: 20, threshold } });
        expect(response.status()).toBe(201);
        products.push({ ...await response.json(), name });
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const home = `/?warehouse_id=${warehouse.id}`;
      await page.goto(`${home}#overview`);
      const warning = mobile ? page.locator('.mw-card').filter({ has: page.getByRole('heading', { name: '库存预警', exact: true }) }) : page.locator('.warning-panel');
      await expect(warning).toContainText('1 件物料');
      await expect(warning.getByText('无需预警物料', { exact: true })).toHaveCount(0);
      await expect(warning.getByText('需要预警物料', { exact: true })).toBeVisible();
      await page.goto(`${home}#products`);
      const row = page.locator(mobile ? '.mw-product-row' : '.product-table tbody tr').filter({ hasText: '无需预警物料' });
      await expect(row).toContainText('不预警');
      await expect(row.locator('.ant-tag').filter({ hasText: '不预警' })).toHaveCount(1);
      await expect(row.getByText('缺货', { exact: true })).toHaveCount(0);
      await page.goto(`${home}#inventory`);
      const inventoryRow = page.locator(mobile ? '.mw-product-row' : '.data-table tbody tr').filter({ hasText: '无需预警物料' });
      await expect(inventoryRow).toContainText('不预警');
      await expect(inventoryRow.locator('.red-text,.orange-text,.ant-tag-error,.ant-tag-warning')).toHaveCount(0);
      await page.getByRole('button', { name: mobile ? '库存预警' : /^库存预警/, exact: mobile }).click();
      const rows = page.locator(mobile ? '.mw-product-list .mw-product-row' : '.data-table tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText('需要预警物料');
      await page.getByRole('button', { name: mobile ? '缺货' : /^已缺货/, exact: mobile }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText('需要预警物料');
      const current = (await (await context.request.get(`/api/products/${products[1].id}`, { headers })).json()).product;
      expect((await context.request.put(`/api/products/${current.id}`, { headers, data: { ...current, threshold: 0 } })).ok()).toBe(true);
      await page.goto(`${home}#overview`);
      await expect(warning).toContainText('0 件物料');
      await expect(warning.getByText('需要预警物料', { exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
