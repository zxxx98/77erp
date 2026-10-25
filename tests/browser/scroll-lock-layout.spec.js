import { test, expect, chromium, devices } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`overlays preserve background width on ${mobile ? 'mobile' : 'desktop with classic scrollbars'}`, async () => {
    // Headless Chromium normally hides scrollbars, masking this regression.
    const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199',
      ...(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } }), serviceWorkers: 'block' });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
      await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
      await context.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } });
      const name = `滚动条布局-${mobile ? '手机' : '桌面'}`;
      const response = await context.request.post('/api/products', { data: { name, barcode: `SCROLL-${mobile}`,
        category: '布局测试', unit: '个', cost: 1, price: 2, threshold: 0, image: 'https://img.77erp.test/file/scroll.png' } });
      expect(response.ok(), await response.text()).toBe(true);
      const page = await context.newPage();
      await page.route('https://img.77erp.test/**', route => route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' }));
      await page.goto('/#products');
      await page.getByRole(mobile ? 'searchbox' : 'textbox', { name: mobile ? '搜索名称、条码、规格或客户料号' : '筛选物料', exact: true }).fill(name);
      const shell = page.locator(mobile ? '.mw-shell' : '.main-shell');
      await expect(shell).toBeVisible();
      // Guarantee a scrolling background regardless of fixture data or viewport.
      await page.addStyleTag({ content: `${mobile ? '.mw-shell' : '.main-shell'} { min-height: 2400px; }` });
      const geometry = () => shell.evaluate(el => {
        const body = document.body.getBoundingClientRect(), shell = el.getBoundingClientRect();
        return { bodyX: body.x, bodyWidth: body.width, shellX: shell.x, shellWidth: shell.width };
      });
      const before = await geometry();
      if (!mobile) expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
      const open = mobile ? shell.getByRole('button', { name: new RegExp(`^${name}，库存`) })
        : page.getByRole('button', { name: `查看 ${name} 物料详情`, exact: true });
      await open.click();
      const details = page.getByRole('dialog', { name: '物料详情', exact: true });
      await expect(details).toBeVisible();
      expect(await geometry()).toEqual(before);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      await details.getByRole('button', { name: `放大查看 ${name}`, exact: true }).click();
      await expect(page.getByRole('button', { name: '关闭图片预览', exact: true })).toBeVisible();
      expect(await geometry()).toEqual(before);
      await page.getByRole('button', { name: '关闭图片预览', exact: true }).click();
      expect(await geometry()).toEqual(before);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      await details.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await expect(details).toHaveCount(0);
      expect(await geometry()).toEqual(before);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      await page.getByRole('button', { name: '管理分类', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await geometry()).toEqual(before);
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await geometry()).toEqual(before);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
