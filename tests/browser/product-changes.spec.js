import { test, expect, devices } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} defers heavy features and shows price audit in product history`, async ({ browser }) => {
  const context = await browser.newContext({
    ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1440, height: 1000 } }),
    baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block',
  });
  try {
    expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
    const suffix = Date.now();
    const name = `改价审计-${mobile ? '手机' : '桌面'}-${suffix}`;
    const barcode = `AUDIT-${mobile}-${suffix}`;
    const created = await context.request.post('/api/products', { data: { name, barcode, category: '审计测试', unit: '件', cost: 10, price: 20, threshold: 0 } });
    expect(created.status()).toBe(201);
    const product = await (await context.request.get(`/api/products/barcode/${barcode}`)).json();
    expect((await context.request.put(`/api/products/${product.id}`, { data: { ...product, cost: 12.34, price: 25.67 } })).ok()).toBe(true);
    const page = await context.newPage();
    const scripts = [];
    page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
    await page.goto('/#products');
    await expect(page.getByRole('heading', { name: '物料管理', exact: true })).toBeVisible();
    expect(scripts.filter(url => /\/(AiAssistant|CameraScanner|Barcode|StockQr|Encoder)-/.test(url))).toEqual([]);
    if (mobile) {
      await page.getByRole('searchbox', { name: '搜索名称、条码、规格或客户料号', exact: true }).fill(name);
      await page.locator('.mw-product-list button').filter({ hasText: name }).click();
    } else {
      await page.getByRole('textbox', { name: '筛选物料', exact: true }).fill(name);
      await page.getByRole('button', { name: `查看 ${name} 物料详情`, exact: true }).click();
    }
    await page.getByRole('button', { name: '查看操作记录', exact: true }).click();
    const history = page.getByRole('region', { name: '当前物料操作记录', exact: true });
    await expect(history).toContainText('物料改价');
    await expect(history).toContainText('成本价：¥10.00 → ¥12.34');
    await expect(history).toContainText('售价：¥20.00 → ¥25.67');
    await expect(history).toContainText('操作人：admin');
    await expect(history).not.toContainText('期初已结转');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});
