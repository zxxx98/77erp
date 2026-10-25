import { test, expect, devices, webkit } from '@playwright/test';
import warehouseCatalog from '../../src/i18n/catalogs/warehouse.js';
import sharedCatalog from '../../src/i18n/catalogs/shared-ui.js';

const credentials = { username: 'admin', password: 'Test-admin-123' };
const label = (source, language) => Object.values({ ...warehouseCatalog, ...sharedCatalog }).find(values => values[0] === source)?.[language === 'en' ? 1 : 2] || source;
const switchTo = async (page, name) => {
  await page.locator('.language-trigger').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};

test.beforeAll(async ({ request }) => { await request.post('/api/auth/setup', { data: credentials }); });
test.afterEach(async ({ request }) => {
  await request.post('/api/auth/login', { data: credentials });
  await request.patch('/api/auth/language', { data: { language: 'zh-CN' } });
});

test('login switcher translates immediately, retains credentials and remembers the device', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill('unchanged-login');
  await switchTo(page, 'English');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  await expect(page.locator('input[autocomplete="username"]')).toHaveValue('unchanged-login');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await switchTo(page, 'Tiếng Việt');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đăng nhập');
  await expect(page.locator('.language-trigger img')).toHaveAttribute('src', '/flags/vn.svg');
  await page.screenshot({ path: 'output/ui-preview/i18n-login-vi.png', animations: 'disabled' });
});

test('desktop language change preserves the current page and search, and synchronizes the account', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: credentials });
  await page.goto('/#products');
  const search = page.locator('.global-search input');
  await search.fill('原始物料名称');
  await switchTo(page, 'English');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(search).toHaveValue('原始物料名称');
  await expect(page).toHaveURL(/#products$/);
  await expect.poll(async () => (await (await page.request.get('/api/auth/status')).json()).language).toBe('en');
  const other = await browser.newContext({ locale: 'zh-CN' });
  await other.request.post('http://127.0.0.1:3199/api/auth/login', { data: credentials });
  const otherPage = await other.newPage();
  await otherPage.goto('http://127.0.0.1:3199/#inventory');
  await expect(otherPage.locator('html')).toHaveAttribute('lang', 'en');
  await other.close();
  await page.screenshot({ path: 'output/ui-preview/i18n-desktop-en.png', animations: 'disabled' });
});

test('mobile Vietnamese header remains usable at 360px and keyboard can open the language menu', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 800 }, locale: 'zh-CN' });
  await context.request.post('http://127.0.0.1:3199/api/auth/login', { data: credentials });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3199/#overview');
  await switchTo(page, 'Tiếng Việt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  const trigger = page.locator('.language-trigger');
  await expect(trigger).toBeVisible();
  expect((await trigger.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'English', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'English', exact: true })).toBeHidden();
  await page.screenshot({ path: 'output/ui-preview/i18n-mobile-vi.png', animations: 'disabled' });
  await context.close();
});

test('cached PWA switches languages offline and synchronizes the selection on reconnect', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'zh-CN', serviceWorkers: 'allow' });
  await context.request.post('http://127.0.0.1:3199/api/auth/login', { data: credentials });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3199/#overview');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await switchTo(page, 'Tiếng Việt');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.locator('.language-trigger img')).toHaveJSProperty('complete', true);
  await context.setOffline(false);
  await expect.poll(async () => (await (await context.request.get('http://127.0.0.1:3199/api/auth/status')).json()).language).toBe('vi');
  await context.close();
});

test('iOS WebKit supports the flag menu and preserves an edited form while another tab changes language', async () => {
  const safari = await webkit.launch();
  const context = await safari.newContext({ ...devices['iPhone 13'], locale: 'zh-CN', serviceWorkers: 'block' });
  try {
    await context.request.post('http://127.0.0.1:3199/api/auth/login', { data: credentials });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3199/#products');
    await page.getByRole('button', { name: '新增物料', exact: true }).first().click();
    const form = page.getByRole('dialog');
    const input = form.getByRole('textbox', { name: /物料名称/ });
    await input.fill('客户原始名称 / Tên riêng');
    const node = await input.elementHandle();
    const other = await context.newPage();
    await other.goto('http://127.0.0.1:3199/#overview');
    await switchTo(other, 'English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await node.evaluate(element => element.isConnected && element.value)).toBe('客户原始名称 / Tên riêng');
    await expect(form).toBeVisible();
    await page.screenshot({ path: 'output/ui-preview/i18n-ios-form-en.png', animations: 'disabled' });
  } finally { await context.close(); await safari.close(); }
});

for (const [language, name] of [['en', 'English'], ['vi', 'Tiếng Việt']]) {
  test(`${language} material editing keeps business names and submits the original production-type value`, async ({ page }) => {
    await page.request.post('/api/auth/login', { data: credentials });
    const warehouse = await (await page.request.post('/api/warehouses', { data: { name: `Language-${language}-${Date.now()}` } })).json();
    const headers = { 'X-Warehouse-ID': String(warehouse.id) };
    const businessName = '客户原始物料 / Tên riêng';
    const product = await (await page.request.post('/api/products', { headers, data: { name: businessName, category: '客户分类', unit: '个', cost: 1, price: 2, threshold: 0 } })).json();
    await page.goto(`/?warehouse_id=${warehouse.id}#products`);
    await switchTo(page, name);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const row = page.locator('.product-table tbody tr').filter({ hasText: businessName });
    await row.getByRole('button', { name: label('编辑', language), exact: true }).click();
    await page.getByRole('combobox', { name: label('生产类型', language), exact: true }).click();
    await page.getByText(label('成品', language), { exact: true }).filter({ visible: true }).last().click();
    await page.getByRole('button', { name: label('保存物料', language), exact: true }).click();
    await expect(page.getByRole('combobox', { name: label('生产类型', language), exact: true })).toHaveCount(0);
    const saved = (await (await page.request.get(`/api/products/${product.id}`, { headers })).json()).product;
    expect(saved.name).toBe(businessName);
    expect(saved.production_type).toBe('成品');
    await expect(row).toContainText(label('成品', language));
  });
}
