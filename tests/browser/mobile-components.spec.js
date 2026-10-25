import { test, expect, devices } from '@playwright/test';
import { chooseOption } from './dropdown-helpers.js';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

for (const scenario of [
  { name: 'Android Chrome', device: 'Pixel 7' },
  { name: 'iOS Safari', device: 'iPhone 13' },
  { name: 'installed PWA', device: 'Pixel 7', standalone: true },
]) {
  test(`${scenario.name} keeps touch tabs borderless, form validation and accessible mobile controls`, async ({ browser }) => {
    const context = await browser.newContext({ locale: 'zh-CN', ...devices[scenario.device], baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
    try {
      if (scenario.standalone) await context.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : original(query);
      });
      await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      const tabs = page.getByRole('navigation', { name: '移动端主导航' });
      await expect(tabs.locator('.adm-tab-bar')).toBeVisible();
      const products = tabs.getByRole('button', { name: '物料', exact: true });
      await products.tap();
      await expect(products).toHaveAttribute('aria-current', 'page');
      await expect(products).toHaveCSS('border-width', '0px');
      await expect(products).toHaveCSS('box-shadow', 'none');
      await expect(products).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await tabs.getByRole('button', { name: '库存', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#inventory$/);
      await products.tap();
      await page.getByRole('button', { name: '新增物料', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '新增物料', exact: true });
      await expect(dialog.locator('.adm-input').first()).toBeVisible();
      await expect(dialog.locator('.ant-btn, .ant-input')).toHaveCount(0);
      await dialog.getByRole('button', { name: '保存物料', exact: true }).click();
      await expect(dialog.getByText('请填写物料名称', { exact: true })).toBeVisible();
      await expect(dialog.getByText(/请填写参考采购价/)).toBeVisible();
      const name = `Mobile-controls-${scenario.name}-${Date.now()}`;
      await dialog.getByRole('textbox', { name: /物料名称/ }).fill(name);
      await dialog.getByRole('spinbutton', { name: /参考采购价/ }).fill('12.5');
      await dialog.getByRole('spinbutton', { name: /参考销售价/ }).fill('18.5');
      const workspace = await (await context.request.get('/api/data')).json();
      await chooseOption(dialog.getByRole('combobox', { name: '物料分类', exact: true }), String(workspace.categories[0].id));
      const asset = dialog.getByRole('checkbox', { name: /固定资产/ });
      await asset.check();
      await expect(asset).toBeChecked();
      await dialog.getByRole('button', { name: '保存物料', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const saved = (await (await context.request.get('/api/data')).json()).products.find(product => product.name === name);
      expect(saved?.is_fixed_asset).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('mobile login inherits form disabled state and keeps password controls accessible', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const account = page.getByLabel('账号', { exact: true });
    const password = page.getByLabel('密码', { exact: true });
    await account.fill('admin');
    await password.fill('Test-admin-123');
    await page.getByRole('button', { name: '显示密码', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
    await page.route('**/api/auth/login', async route => { await pending; await route.continue(); });
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(account).toBeDisabled();
    await expect(password).toBeDisabled();
    await expect(page.getByRole('button', { name: '显示密码', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  } finally { release(); await context.close(); }
});
