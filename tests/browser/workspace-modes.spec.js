import { test, expect } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} switches modes, remembers pages and follows old quality links`, async ({ page }) => {
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }));
    }
    await page.goto('/#inventory');
    const mode = page.getByRole('group', { name: '业务模式' });
    await expect(mode.getByRole('button', { name: '仓储', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await mode.getByRole('button', { name: '生产', exact: true }).click();
    await expect(page).toHaveURL(/#quality$/);
    await expect(mode.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const nav = page.getByRole('navigation', { name: mobile ? '移动端主导航' : '主导航', exact: true });
    await expect(nav.getByRole(mobile ? 'button' : 'link', { name: mobile ? '品质' : '品质管理', exact: true })).toBeVisible();
    await expect(nav.getByText('库存', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(mode.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await mode.getByRole('button', { name: '仓储', exact: true }).click();
    await expect(page).toHaveURL(/#inventory$/);
    await page.goto('/#quality');
    await expect(mode.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/');
    await expect(mode.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (mobile) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('cancelled navigation preserves mode, page and remembered destination', async ({ page }) => {
  await page.goto('/#quality');
  const mode = page.getByRole('group', { name: '业务模式' });
  await expect(mode).toBeVisible();
  await page.evaluate(() => {
    window.blockModeNavigation = event => event.preventDefault();
    window.addEventListener('erp:before-navigate', window.blockModeNavigation);
  });
  await mode.getByRole('button', { name: '仓储', exact: true }).click();
  await expect(page).toHaveURL(/#quality$/);
  await expect(mode.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { location.hash = 'inventory'; });
  await expect(page).toHaveURL(/#quality$/);
  await page.evaluate(() => window.removeEventListener('erp:before-navigate', window.blockModeNavigation));
  await mode.getByRole('button', { name: '仓储', exact: true }).click();
  await expect(page).toHaveURL(/#overview$/);
});

test('unsaved quality configuration asks before switching modes', async ({ page }) => {
  await page.goto('/#quality');
  await page.getByRole('button', { name: '在线新建模板', exact: true }).click();
  await expect(page.getByRole('table', { name: '在线模板表格', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '模板名称', exact: true }).fill('模式切换未保存模板');
  const switcher = page.getByRole('group', { name: '业务模式' });
  page.once('dialog', dialog => dialog.dismiss());
  await switcher.getByRole('button', { name: '仓储', exact: true }).click();
  await expect(page).toHaveURL(/#quality$/);
  await expect(switcher.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
  page.once('dialog', dialog => dialog.accept());
  await switcher.getByRole('button', { name: '仓储', exact: true }).click();
  await expect(page).toHaveURL(/#overview$/);
});

test('shared pages retain mode through browser history', async ({ page }) => {
  await page.goto('/#quality');
  const switcher = page.getByRole('group', { name: '业务模式' });
  await page.getByRole('navigation', { name: '效率工具', exact: true }).getByRole('link', { name: '公告中心', exact: true }).click();
  await expect(page).toHaveURL(/#announcements\?mode=production$/);
  await switcher.getByRole('button', { name: '仓储', exact: true }).click();
  await page.goBack();
  await expect(switcher.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(switcher.getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('production mode keeps quality permission checks and account preferences isolated', async ({ page }) => {
  await page.goto('/#quality');
  await expect(page.getByRole('group', { name: '业务模式' }).getByRole('button', { name: '生产', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const username = `mode-reader-${Date.now()}`;
  expect((await page.request.post('/api/users', { data: { username, password: 'Reader-password-123', role: 'employee', permissions: [] } })).status()).toBe(201);
  expect((await page.request.post('/api/auth/login', { data: { username, password: 'Reader-password-123' } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('group', { name: '业务模式' }).getByRole('button', { name: '仓储', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: '业务模式' }).getByRole('button', { name: '生产', exact: true }).click();
  await expect(page.getByText('没有品质管理权限，请联系管理员。', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '品质管理', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/quality/templates')).status()).toBe(403);
});
