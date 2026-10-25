import { test, expect, devices } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

async function session(browser, mobile) {
  const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block',
    ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1440, height: 1000 } }),
  });
  expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
  const page = await context.newPage();
  const scripts = [], errors = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, scripts, errors };
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} home defers business modules and settings panels retain unsaved edits`, async ({ browser }) => {
    const { context, page, scripts, errors } = await session(browser, mobile);
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
      expect(scripts.filter(url => /\/(Settings|Commerce|Operations|ProductDialogs|OrderForm|OrderDetail|MobileOrderForm|MobileOrderDetail|Users|NotificationSettings|R2BackupSettings)-/.test(url))).toEqual([]);
      expect(scripts.some(url => /\/MobileShell-/.test(url))).toBe(mobile);
      expect(scripts.some(url => /\/Dashboard-/.test(url))).toBe(!mobile);
      if (mobile) {
        await page.getByRole('button', { name: '更多', exact: true }).click();
        await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click();
      } else await page.getByRole('button', { name: '系统设置', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '工作空间设置' })).toBeVisible();
      expect(scripts.some(url => /\/Settings-/.test(url))).toBe(true);
      expect(scripts.filter(url => /\/(NotificationSettings|R2BackupSettings|ImagebedSettings)-/.test(url))).toEqual([]);
      await page.getByRole('button', { name: /^通知设置/ }).click();
      const input = page.getByRole('region', { name: '通知设置' }).getByLabel('Webhook 地址', { exact: true });
      await input.fill('https://hooks.77erp.test/unsaved-lazy-panel');
      expect(scripts.some(url => /\/NotificationSettings-/.test(url))).toBe(true);
      await page.getByRole('button', { name: /^基础设置/ }).click();
      await page.getByRole('button', { name: /^通知设置/ }).click();
      await expect(input).toHaveValue('https://hooks.77erp.test/unsaved-lazy-panel');
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });

  test(`${mobile ? 'mobile' : 'desktop'} a delayed template module preserves the open order and typed notes`, async ({ browser }) => {
    const { context, page, errors } = await session(browser, mobile);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      await page.route('**/assets/Commerce-*.js', async route => { await gate; await route.continue(); });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
      await page.getByRole('button', { name: mobile ? '入库' : '新建入库', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('status').filter({ hasText: '正在加载…' }).first()).toBeVisible();
      const note = dialog.getByRole('textbox', { name: /备注/ });
      await note.fill('模块加载期间填写的备注');
      const loaded = page.waitForResponse(response => /\/assets\/Commerce-[^/]+\.js$/.test(response.url()));
      release(); await loaded;
      await expect(dialog.getByRole('status').filter({ hasText: '正在加载…' })).toHaveCount(0);
      await expect(note).toHaveValue('模块加载期间填写的备注');
      expect(errors).toEqual([]);
    } finally { release(); await context.close(); }
  });
}
