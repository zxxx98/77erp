import { browserPosition } from './position-helpers.js';
import { chooseOption, selectedControl } from './dropdown-helpers.js';
import { test, expect, devices } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

for (const device of [null, 'Pixel 7', 'iPhone 13']) {
  test(`${device || 'desktop'} checks for changes without replacing data until refresh is clicked`, async ({ browser }) => {
    const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', serviceWorkers: device === 'iPhone 13' ? 'allow' : 'block', ...(device ? devices[device] : {}) });
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let workspaceReads = 0, businessReads = 0, updateReads = 0;
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/workspace') workspaceReads++;
      if (path === '/api/updates') updateReads++;
      if (['/api/dashboard', '/api/orders', '/api/announcements', '/api/announcements/unread-count'].includes(path)) businessReads++;
    });
    try {
      await page.clock.install();
      // Initialize the release announcement before capturing the workspace baseline.
      await context.request.get('/api/announcements');
      await page.goto('/#announcements');
      await expect(page.locator('.announcement-card').first()).toBeVisible();
      const initial = { workspaceReads, businessReads };
      const notice = page.getByRole('status', { name: '数据更新提示' });
      const check = async action => {
        const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
        await action();
        expect((await response).ok()).toBe(true);
      };
      await check(() => page.clock.fastForward(30000));
      await expect(notice).toHaveCount(0);
      expect({ workspaceReads, businessReads }).toEqual(initial);
      for (const event of ['focus', 'online', 'visibilitychange', 'focus']) {
        await page.evaluate(event => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)), event);
      }
      await page.clock.fastForward(10000);
      expect(updateReads).toBe(1);

      const title = `手动刷新-${device || 'desktop'}-${Date.now()}`;
      const created = await context.request.post('/api/announcements', { data: { title, content: '外部修改，等待手动刷新。', pinned: true } });
      expect(created.ok()).toBe(true);
      await check(() => page.clock.fastForward(20000));
      await expect(notice).toBeVisible();
      if (!device) await expect(page.locator('.sync-state')).toHaveText('有数据变更');
      await expect(page.locator('.announcement-card').filter({ hasText: title })).toHaveCount(0);
      for (const event of ['focus', 'online', 'visibilitychange']) {
        await page.evaluate(event => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)), event);
      }
      await page.clock.fastForward(90000);
      expect(updateReads).toBe(2);
      expect({ workspaceReads, businessReads }).toEqual(initial);
      await notice.getByRole('button', { name: '刷新数据', exact: true }).click();
      await expect(page.locator('.announcement-card').filter({ hasText: title })).toBeVisible();
      await expect(notice).toHaveCount(0);
      if (!device) await expect(page.locator('.sync-state')).toHaveText('数据已读取');
      expect(workspaceReads).toBe(initial.workspaceReads + 1);
      await check(() => page.clock.fastForward(30000));
      await expect(notice).toHaveCount(0);
      expect(updateReads).toBe(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('update checks avoid overlapping requests and pause while hidden or offline', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
  await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
  const page = await context.newPage();
  let attempts = 0, releaseCheck;
  const pendingCheck = new Promise(resolve => { releaseCheck = resolve; });
  await page.route('**/api/updates', async route => {
    attempts++;
    if (attempts === 1) {
      await pendingCheck;
      await route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    } else await route.continue();
  });
  try {
    await page.clock.install();
    await page.goto('/#announcements');
    await expect(page.locator('.announcement-card').first()).toBeVisible();
    const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
    await page.clock.fastForward(30000);
    await expect.poll(() => attempts).toBe(1);
    for (const event of ['focus', 'online', 'visibilitychange']) {
      await page.evaluate(event => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)), event);
      await page.clock.fastForward(5000);
    }
    expect(attempts).toBe(1);
    releaseCheck();
    expect((await failed).status()).toBe(503);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.fastForward(5000);
    expect(attempts).toBe(1);
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
    await page.clock.fastForward(30000);
    expect(attempts).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(30000);
    expect(attempts).toBe(1);
    const recovered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect((await recovered).ok()).toBe(true);
    expect(attempts).toBe(2);
    await expect(page.getByRole('status', { name: '数据更新提示' })).toHaveCount(0);
  } finally { releaseCheck(); await context.close(); }
});

test('switching warehouses clears an update notice even when their revision values match', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
  await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
  const warehouseName = `更新检查隔离-${Date.now()}`;
  const created = await context.request.post('/api/warehouses', { data: { name: warehouseName } });
  expect(created.ok()).toBe(true);
  const { id: warehouseId } = await created.json();
  const page = await context.newPage();
  await page.route('**/api/workspace', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), revision: 'same-baseline' } });
  });
  await page.route('**/api/updates', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), revision: Number(route.request().headers()['x-warehouse-id']) === warehouseId ? 'same-baseline' : 'changed' } });
  });
  try {
    await page.clock.install();
    await page.goto('/#announcements');
    await expect(page.locator('.announcement-card').first()).toBeVisible();
    const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
    await page.clock.fastForward(30000);
    await checked;
    const notice = page.getByRole('status', { name: '数据更新提示' });
    await expect(notice).toBeVisible();
    const warehouse = page.getByRole('combobox', { name: '当前仓库', exact: true });
    await chooseOption(warehouse, String(warehouseId));
    await expect(selectedControl(warehouse)).toContainText(warehouseName);
    await expect(notice).toHaveCount(0);
    const secondCheck = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
    await page.clock.fastForward(30000);
    await secondCheck;
    await expect(notice).toHaveCount(0);
  } finally { await context.close(); }
});

test('employee editing is preserved while updates are detected, and revoked sessions still log out', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
  await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
  const username = `updates-${Date.now()}`;
  const created = await context.request.post('/api/users', { data: { position_id: await browserPosition(context.request, ['basic_view', 'products']), username, employee_no: username, password: 'Test-staff-123' } });
  const { id } = await created.json();
  const user = (await (await context.request.get('/api/users')).json()).find(user => user.id === id);
  const employee = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:3199', ...devices['Pixel 7'], serviceWorkers: 'block' });
  await employee.request.post('/api/auth/login', { data: { username, password: 'Test-staff-123' } });
  const page = await employee.newPage();
  try {
    await page.clock.install();
    await page.goto('/#products');
    await page.getByRole('button', { name: '新增物料', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const name = dialog.getByRole('textbox').first();
    await name.fill('尚未保存的物料');
    await context.request.post('/api/products', { data: { name: '外部新增物料', category: '检查更新', unit: '件', cost: 1, price: 2, threshold: 0 } });
    const checked = page.waitForResponse(response => response.url().endsWith('/api/updates'));
    await page.clock.fastForward(30000); await checked;
    await expect(page.locator('.data-update-notice')).toContainText('数据有变更');
    await expect(name).toHaveValue('尚未保存的物料');
    await expect(dialog).toBeVisible();
    await employee.request.post('/api/auth/logout', { data: {} });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: '账号登录', exact: true })).toBeVisible();
  } finally { await employee.close(); await context.close(); }
});
