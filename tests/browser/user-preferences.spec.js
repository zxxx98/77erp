import { test, expect, devices, webkit } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserPosition } from './position-helpers.js';

const modalLabel = '点击空白处关闭弹窗';
const drawerLabel = '点击空白处关闭抽屉';

test.beforeAll(async ({ request }) => {
  await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
});

async function login(request) {
  expect((await request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
}

async function desktopPreferences(page) {
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.getByRole('button', { name: /用户习惯/ }).click();
  return page.getByRole('dialog', { name: '工作空间设置' });
}

test('preferences independently control dialogs and drawers, persist and preserve close guards', async ({ page }) => {
  await login(page.request);
  await page.goto('/#products');
  let settings = await desktopPreferences(page);
  await expect(settings.getByRole('switch', { name: modalLabel, exact: true })).not.toBeChecked();
  await expect(settings.getByRole('switch', { name: drawerLabel, exact: true })).not.toBeChecked();
  await page.mouse.click(6, 6);
  await expect(settings).toBeVisible();
  await settings.getByRole('switch', { name: modalLabel, exact: true }).click();
  await settings.getByRole('heading', { name: '用户习惯', exact: true }).click();
  await expect(settings).toBeVisible();
  // Dragging from content to the mask must not discard the form.
  const box = await settings.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(6, 6);
  await page.mouse.up();
  await expect(settings).toBeVisible();
  await page.mouse.click(6, 6);
  await expect(settings).toHaveCount(0);
  await page.getByRole('button', { name: '新增物料', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: '新增物料', exact: true });
  await page.mouse.click(6, 6);
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  settings = await desktopPreferences(page);
  await settings.getByRole('switch', { name: drawerLabel, exact: true }).click();
  await page.screenshot({ path: 'output/ui-preview/user-preferences-desktop.png', animations: 'disabled' });
  await page.reload();
  settings = await desktopPreferences(page);
  await expect(settings.getByRole('switch', { name: modalLabel, exact: true })).toBeChecked();
  await expect(settings.getByRole('switch', { name: drawerLabel, exact: true })).toBeChecked();
  await page.mouse.click(6, 6);
  await page.getByRole('button', { name: '新增物料', exact: true }).first().click();
  await drawer.getByRole('textbox', { name: /物料名称/ }).fill('保留未保存的输入');
  page.once('dialog', async prompt => { expect(prompt.message()).toContain('尚未保存'); await prompt.dismiss(); });
  await page.mouse.click(6, 6);
  await expect(drawer.getByRole('textbox', { name: /物料名称/ })).toHaveValue('保留未保存的输入');
  page.once('dialog', prompt => prompt.accept());
  await page.mouse.click(6, 6);
  await expect(drawer).toHaveCount(0);
});

test('preferences sync across tabs, isolate accounts and are available to employees', async ({ page, context }) => {
  await login(page.request);
  const positionId = await browserPosition(page.request);
  const username = `pref-${randomUUID().slice(0, 8)}`;
  expect((await page.request.post('/api/users', { data: { username, employee_no: username, password: 'Employee-pass-123', role: 'employee', name: '习惯测试员工', position_id: positionId } })).ok()).toBe(true);
  await page.goto('/#products');
  const settings = await desktopPreferences(page);
  const second = await context.newPage();
  await second.goto('/#products');
  const otherSettings = await desktopPreferences(second);
  await settings.getByRole('switch', { name: modalLabel, exact: true }).click();
  await expect(otherSettings.getByRole('switch', { name: modalLabel, exact: true })).toBeChecked();
  await second.close();
  await page.request.post('/api/auth/logout');
  expect((await page.request.post('/api/auth/login', { data: { username, password: 'Employee-pass-123' } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  const account = page.getByRole('dialog', { name: '账户设置', exact: true });
  await expect(account.getByRole('switch', { name: modalLabel, exact: true })).not.toBeChecked();
  await account.getByRole('switch', { name: drawerLabel, exact: true }).click();
  await page.request.post('/api/auth/logout');
  await login(page.request);
  await page.reload();
  await desktopPreferences(page);
  await expect(settings.getByRole('switch', { name: modalLabel, exact: true })).toBeChecked();
  await expect(settings.getByRole('switch', { name: drawerLabel, exact: true })).not.toBeChecked();
});

test('nested backdrop closes only the top dialog and storage failures remain visible', async ({ page }) => {
  await login(page.request);
  await page.goto('/#products');
  const settings = await desktopPreferences(page);
  await settings.getByRole('switch', { name: modalLabel, exact: true }).click();
  await settings.getByRole('button', { name: /用户管理/ }).click();
  await settings.getByRole('button', { name: '修改名称', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.mouse.click(6, 6);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: /用户习惯/ }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('77erp:preferences:')) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await settings.getByRole('switch', { name: drawerLabel, exact: true }).click();
  await expect(settings.getByRole('switch', { name: drawerLabel, exact: true })).toBeChecked();
  await expect(settings.getByRole('alert')).toContainText('浏览器未能保存用户习惯');
});

test('corrupt and non-boolean stored preferences fall back to disabled', async ({ page }) => {
  await login(page.request);
  await page.goto('/#products');
  const { user } = await (await page.request.get('/api/workspace')).json();
  for (const value of ['invalid json', JSON.stringify({ closeModalOnBackdrop: 'false', closeDrawerOnBackdrop: 1 })]) {
    await page.evaluate(({ id, value }) => localStorage.setItem(`77erp:preferences:v1:${id}`, value), { id: user.id, value });
    await page.reload();
    const settings = await desktopPreferences(page);
    await expect(settings.getByRole('switch', { name: modalLabel, exact: true })).not.toBeChecked();
    await expect(settings.getByRole('switch', { name: drawerLabel, exact: true })).not.toBeChecked();
  }
});

test('production-only mobile accounts can configure habits and return closes the panel first', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    await login(context.request);
    const tag = randomUUID().slice(0, 8);
    const post = async (path, data) => {
      const response = await context.request.post(`/api${path}`, { data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const group = await post('/production-groups', { name: `偏好班组-${tag}` });
    const position = await post('/positions', { name: `偏好岗位-${tag}`, access_mode: 'production_only', permissions: ['production_register'] });
    await post('/users', { username: `worker-${tag}`, employee_no: `worker-${tag}`, password: 'Worker-password-123', role: 'employee', position_id: position.id, production_group_id: group.id });
    await post('/auth/logout', {});
    await post('/auth/login', { username: `worker-${tag}`, password: 'Worker-password-123' });
    const page = await context.newPage();
    await page.goto('/');
    const url = page.url();
    await page.getByRole('button', { name: '用户习惯', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '用户习惯', exact: true });
    await dialog.getByRole('switch', { name: drawerLabel, exact: true }).click();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(url);
    await page.getByRole('button', { name: '用户习惯', exact: true }).click();
    await expect(dialog.getByRole('switch', { name: drawerLabel, exact: true })).toBeChecked();
    await page.touchscreen.tap(5, 5);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '用户习惯', exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('BOM detail drawer follows the same preference on narrow screens', async ({ page }) => {
  await login(page.request);
  const tag = randomUUID().slice(0, 8);
  const post = async (path, data) => {
    const response = await page.request.post(`/api${path}`, { data: { request_id: randomUUID(), ...data } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const product = await post('/products', { name: `偏好成品-${tag}`, barcode: `PREF-P-${tag}`, unit: '件', category: '生产', cost: 1, price: 2, threshold: 0 });
  const material = await post('/products', { name: `偏好原料-${tag}`, barcode: `PREF-M-${tag}`, unit: '件', category: '生产', cost: 1, price: 2, threshold: 0 });
  await post('/boms', { name: `偏好配方-${tag}`, product_id: product.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items: [{ product_id: material.id, quantity: 1, unit: '件', note: '' }] });
  const openDetails = async () => {
    await page.goto('/#bom');
    await page.getByRole('searchbox', { name: '搜索BOM', exact: true }).fill(`偏好配方-${tag}`);
    await page.getByRole('button', { name: '测算备料', exact: true }).click();
    await page.getByRole('button', { name: '开始测算', exact: true }).click();
    await page.getByRole('tab', { name: '配方结构', exact: true }).click();
    await page.getByRole('button', { name: `查看详情 偏好原料-${tag}`, exact: true }).click();
  };
  await page.setViewportSize({ width: 700, height: 900 });
  await openDetails();
  const details = page.getByRole('region', { name: '节点详情' });
  await page.locator('.ant-drawer-mask').click({ position: { x: 5, y: 5 } });
  await expect(details).toBeVisible();
  await page.goto('/#products');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settings = await desktopPreferences(page);
  await settings.getByRole('switch', { name: drawerLabel, exact: true }).click();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.setViewportSize({ width: 700, height: 900 });
  await openDetails();
  await page.locator('.ant-drawer-mask').click({ position: { x: 5, y: 5 } });
  await expect(details).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '备料测算', exact: true })).toBeVisible();
});

for (const scenario of [
  { name: 'Android', device: 'Pixel 7' },
  { name: 'iPhone', device: 'iPhone 13', webkit: true },
  { name: 'PWA', device: 'Pixel 7', standalone: true },
]) {
  test(`${scenario.name} bottom sheets use drawer preference and retain it after reload`, async ({ browser }) => {
    const safari = scenario.webkit ? await webkit.launch() : null;
    const context = await (safari || browser).newContext({ locale: 'zh-CN', ...devices[scenario.device], baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      if (scenario.standalone) await context.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : original(query);
      });
      await login(context.request);
      const page = await context.newPage();
      await page.goto('/#more');
      await page.getByRole('button', { name: '用户习惯', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '用户习惯', exact: true });
      await expect(dialog).toBeVisible();
      await page.touchscreen.tap(5, 5);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('switch', { name: drawerLabel, exact: true }).click();
      await page.screenshot({ path: `output/ui-preview/user-preferences-${scenario.name}.png`, animations: 'disabled' });
      await page.touchscreen.tap(5, 5);
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await page.getByRole('button', { name: '用户习惯', exact: true }).click();
      await expect(dialog.getByRole('switch', { name: drawerLabel, exact: true })).toBeChecked();
      await dialog.getByRole('switch', { name: drawerLabel, exact: true }).click();
      await page.touchscreen.tap(5, 5);
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); await safari?.close(); }
  });
}
