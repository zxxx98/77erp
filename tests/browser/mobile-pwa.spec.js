import { ensureContact, chooseContact } from './contact-helpers.js';
import { test, expect, devices } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

async function mobile(browser, options = {}) {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', ...options });
  const response = await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect(response.ok()).toBe(true);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  return { context, page };
}

async function fixtureProduct(context, stock = 0) {
  const workspace = await (await context.request.get('/api/data')).json();
  const name = `PWA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const response = await context.request.post('/api/products', { data: { name, barcode: name, category: workspace.categories[0].name, category_id: workspace.categories[0].id, unit: '个', cost: 10, price: 20, threshold: 2 } });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  if (stock) expect((await context.request.post('/api/orders', { data: { type: 'in', partner: 'PWA初始供应商', items: [{ product_id: result.id, quantity: stock, price: 10 }] } })).ok()).toBe(true);
  return { ...result, name };
}

async function addItem(page, product) {
  await page.getByRole('searchbox', { name: '搜索要添加的物料或条码' }).fill(product.name);
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`${product.name}，库存`) }).click();
}

async function savedDrafts(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === '77erp-local-drafts')) return [];
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('77erp-local-drafts', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const result = await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return result;
  });
}

test('device identity chooses mobile on Android tablets and iPadOS, and PC on narrow desktop windows', async ({ browser }) => {
  const scenarios = [
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', viewport: { width: 1200, height: 800 }, touch: 5, mobile: true },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', viewport: { width: 1366, height: 1024 }, touch: 5, mobile: true },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', viewport: { width: 390, height: 844 }, touch: 10, mobile: false },
  ];
  for (const scenario of scenarios) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', userAgent: scenario.userAgent, viewport: scenario.viewport });
    await context.addInitScript(touch => { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => touch }); Object.defineProperty(navigator, 'userAgentData', { get: () => ({ mobile: false }) }); }, scenario.touch);
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const page = await context.newPage(); await page.goto('/');
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await expect(page.locator('.mw-tabs')).toHaveCount(scenario.mobile ? 1 : 0);
    await expect(page.locator('.sidebar')).toHaveCount(scenario.mobile ? 0 : 1);
    await page.setViewportSize({ width: scenario.mobile ? 320 : 1400, height: 700 });
    await expect(page.locator('.mw-tabs')).toHaveCount(scenario.mobile ? 1 : 0);
    await context.close();
  }
});

test('mobile purchase and sale preserve quantity precision and the confirmation flow', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const product = await fixtureProduct(context);
  await ensureContact(context.request, 'PWA采购供应商');
  await page.reload();
  await page.getByRole('button', { name: '采购入库', exact: true }).click();
  await chooseContact(page, 'PWA采购供应商');
  await addItem(page, product);
  await page.getByRole('spinbutton', { name: `${product.name} 数量` }).fill('10.1234');
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认采购入库？' })).toBeVisible();
  const confirmation = await page.getByRole('dialog', { name: '确认采购入库？' }).boundingBox();
  const viewport = page.viewportSize();
  expect(confirmation.width).toBe(viewport.width);
  expect(confirmation.height).toBeLessThan(viewport.height / 2);
  await expect.poll(async () => {
    const bounds = await page.getByRole('dialog', { name: '确认采购入库？' }).boundingBox();
    return Math.abs(bounds.y + bounds.height - viewport.height);
  }).toBeLessThan(2);
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: `${product.name} 数量` })).toHaveValue('10.1234');
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '销售出库', exact: true }).click();
  await addItem(page, product);
  await page.getByRole('spinbutton', { name: `${product.name} 数量` }).fill('99');
  await page.getByRole('button', { name: '确认出库', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('库存不足');
  await page.getByRole('spinbutton', { name: `${product.name} 数量` }).fill('0.0001');
  await page.getByRole('button', { name: '确认出库', exact: true }).click();
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const data = await (await context.request.get('/api/data')).json();
  expect(data.products.find(p => p.id === product.id).stock).toBe(10.1233);
  expect(await savedDrafts(page)).toHaveLength(0);
  await context.close();
});

test('drafts survive reload and offline editing, are isolated by warehouse and cleared on logout', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const product = await fixtureProduct(context, 8);
  await page.reload();
  await page.getByRole('button', { name: '销售出库', exact: true }).click();
  await addItem(page, product);
  await page.getByRole('spinbutton', { name: `${product.name} 数量` }).fill('2.125');
  await expect.poll(async () => (await savedDrafts(page))[0]?.items[0]?.quantity).toBe('2.125');
  await page.reload();
  await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: `${product.name} 数量` })).toHaveValue('2.125');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: '确认出库', exact: true })).toBeDisabled();
  await page.getByRole('spinbutton', { name: `${product.name} 数量` }).fill('3.125');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿并关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.setOffline(false);
  const newWarehouse = await (await context.request.post('/api/warehouses', { data: { name: `PWA隔离仓-${Date.now()}` } })).json();
  await page.getByRole('button', { name: '刷新数据', exact: true }).last().click();
  await page.getByRole('button', { name: '切换仓库', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`PWA隔离仓`) }).click();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无草稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '切换仓库', exact: true }).click();
  await page.getByRole('button', { name: '主仓库', exact: true }).click();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号登录', exact: true })).toBeVisible();
  expect(await savedDrafts(page)).toHaveLength(0);
  await context.close();
});

test('a lost committed response is recovered across reload using the same request without deducting stock twice', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const product = await fixtureProduct(context, 10);
  await page.reload();
  await page.getByRole('button', { name: '销售出库', exact: true }).click();
  await addItem(page, product);
  await page.getByRole('spinbutton', { name: `${product.name} 数量` }).fill('2');
  let committedRequest;
  await context.route('**/api/orders', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    committedRequest = route.request().postDataJSON();
    const result = await route.fetch(); expect(result.status()).toBe(201);
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: '确认出库', exact: true }).click();
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await expect(page.getByRole('heading', { name: '提交结果待确认', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: `${product.name} 数量` })).toBeDisabled();
  await expect.poll(async () => (await savedDrafts(page))[0]?.pending?.body?.request_id).toBe(committedRequest.request_id);
  await context.unroute('**/api/orders');
  await page.reload();
  await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await page.getByRole('button', { name: '继续核对', exact: true }).click();
  const retry = page.waitForRequest(request => request.url().endsWith('/api/orders') && request.method() === 'POST');
  await page.getByRole('button', { name: '核对并重试原提交', exact: true }).click();
  expect((await retry).postDataJSON()).toEqual(committedRequest);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const workspace = await (await context.request.get('/api/data')).json();
  expect(workspace.products.find(p => p.id === product.id).stock).toBe(8);
  expect(workspace.orders.filter(o => o.type === 'out' && o.items.some(i => i.product_id === product.id))).toHaveLength(1);
  expect(await savedDrafts(page)).toHaveLength(0);
  await context.close();
});

test('PWA caches the application shell, excludes API responses and shows an offline login state after reload', async ({ browser }) => {
  const { context, page } = await mobile(browser, { serviceWorkers: 'allow' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.reload();
  const manifest = await (await context.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true);
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const responses = await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => request.url))); return responses.flat(); });
  expect(cached.some(url => url.includes('/api/'))).toBe(false);
  expect(cached.some(url => url.includes('/index.html'))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('当前离线，请联网后登录');
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await context.close();
});

test('install guidance separates browser shortcuts, accepted requests and reported installation', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '安装应用', exact: true }).click();
  await expect(page.getByRole('status', { name: '应用状态' })).toContainText('Create shortcut');
  await expect(page.getByRole('status', { name: '应用状态' })).toContainText('保留浏览器地址栏');
  await page.getByRole('button', { name: '关闭应用提示' }).click();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.installPromptCalls = (window.installPromptCalls || 0) + 1; };
    event.userChoice = new Promise(resolve => { window.finishInstallChoice = resolve; });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: '安装应用', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在请求安装…', exact: true })).toBeDisabled();
  await page.evaluate(() => window.finishInstallChoice({ outcome: 'accepted' }));
  await expect(page.getByRole('status', { name: '应用状态' })).toContainText('当前尚未确认安装完成');
  expect(await page.evaluate(() => window.installPromptCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('status', { name: '应用状态' })).toContainText('浏览器已报告');
  await expect(page.getByRole('status', { name: '应用状态' })).toContainText('无法确认桌面图标');
  await page.getByRole('button', { name: '查看安装说明', exact: true }).click();
  await expect(page.getByRole('status', { name: '应用状态' })).toContainText('应用管理');
  await context.close();
});

test('canceling installation does not report success and changing to an app window hides installation', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  await context.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    const query = new EventTarget();
    query.matches = false;
    window.appDisplayQuery = query;
    window.matchMedia = value => value === '(display-mode: standalone)' ? query : original(value);
  });
  await page.reload();
  await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: '安装应用', exact: true }).click();
  await expect(page.getByRole('status', { name: '应用状态' })).toHaveText(/已取消安装/);
  await page.evaluate(() => { window.appDisplayQuery.matches = true; window.appDisplayQuery.dispatchEvent(new Event('change')); });
  await expect(page.getByRole('button', { name: '安装应用', exact: true })).toHaveCount(0);
  await context.close();
});

test('session replacement isolates drafts by account and hides read-only employee actions and costs', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const username = `pwa-reader-${Date.now()}`;
  expect((await context.request.post('/api/users', { data: { username, password: 'Reader-password-123', role: 'employee', permissions: [] } })).status()).toBe(201);
  const product = await fixtureProduct(context, 2);
  await ensureContact(context.request, '仅管理员可见的草稿');
  await page.reload();
  await page.getByRole('button', { name: '采购入库', exact: true }).click();
  await chooseContact(page, '仅管理员可见的草稿');
  // Background immediately, before the debounced autosave, including drafts without items.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(async () => (await savedDrafts(page))[0]?.partner).toBe('仅管理员可见的草稿');
  // Replacing the session models another account after expiry; explicit logout would delete drafts.
  expect((await context.request.post('/api/auth/login', { data: { username, password: 'Reader-password-123' } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '采购入库', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '销售出库', exact: true })).toHaveCount(0);
  await expect(page.locator('.mw-stat').filter({ hasText: '库存成本' })).toContainText('—');
  await page.locator('.mw-tabs').getByRole('button', { name: '物料', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增物料', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox').fill(product.name);
  await page.getByRole('button', { name: new RegExp(`${product.name}，库存`) }).click();
  await expect(page.locator('.mw-detail-row').filter({ hasText: '参考采购价' })).toContainText('—');
  await expect(page.getByRole('button', { name: '编辑物料', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无草稿', exact: true })).toBeVisible();
  expect(await savedDrafts(page)).toHaveLength(1);
  await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
  await page.reload();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await expect(page.getByText('仅管理员可见的草稿', { exact: true })).toBeVisible();
  await context.close();
});

test('browser back closes nested confirmations and preserves a dirty mobile order', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const product = await fixtureProduct(context, 5);
  await page.reload();
  await page.getByRole('button', { name: '销售出库', exact: true }).click();
  await addItem(page, product);
  await page.getByRole('button', { name: '确认出库', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '确认销售出库？' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: `${product.name} 数量` })).toHaveValue('1');
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '保存本地草稿？' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '保存本地草稿？' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: `${product.name} 数量` })).toHaveValue('1');
  await page.goBack();
  await page.getByRole('button', { name: '保存草稿并关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await expect.poll(async () => (await savedDrafts(page)).length).toBe(1);
  await context.close();
});

test('a session changed in another tab cannot reassign an open draft to the new account', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const original = await (await context.request.get('/api/auth/status')).json();
  const username = `pwa-second-${Date.now()}`;
  expect((await context.request.post('/api/users', { data: { username, password: 'Second-password-123', role: 'admin' } })).status()).toBe(201);
  await ensureContact(context.request, '原账号正在编辑');
  await page.reload();
  await page.getByRole('button', { name: '采购入库', exact: true }).click();
  await chooseContact(page, '原账号正在编辑');
  await expect.poll(async () => (await savedDrafts(page))[0]?.partner).toBe('原账号正在编辑');
  await context.request.post('/api/auth/login', { data: { username, password: 'Second-password-123' } });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '账号登录', exact: true })).toBeVisible();
  expect((await savedDrafts(page)).every(draft => draft.userId === original.id)).toBe(true);
  await page.reload();
  await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无草稿', exact: true })).toBeVisible();
  await context.close();
});

test('browser back closes image preview before its mobile product dialog', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  expect((await context.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } })).ok()).toBe(true);
  const product = await fixtureProduct(context);
  const workspace = await (await context.request.get('/api/data')).json();
  const saved = workspace.products.find(p => p.id === product.id);
  expect((await context.request.put(`/api/products/${product.id}`, { data: { ...saved, image: 'https://img.77erp.test/file/test.webp' } })).ok()).toBe(true);
  await page.reload();
  await page.locator('.mw-tabs').getByRole('button', { name: '物料', exact: true }).click();
  await page.getByRole('searchbox').fill(product.name);
  await page.getByRole('button', { name: new RegExp(`${product.name}，库存`) }).click();
  await page.getByRole('dialog').getByRole('button', { name: `放大查看 ${product.name}` }).click();
  await expect(page.getByRole('dialog', { name: `图片预览：${product.name}` })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: `图片预览：${product.name}` })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '物料详情', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});

test('leaving the foreground stops the scanner stream and preserves manual entry', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const drawing = canvas.getContext('2d');
      const timer = setInterval(() => drawing.fillRect(0, 0, 320, 240), 50);
      const stream = canvas.captureStream(20);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      window.scannerTestStream = stream;
      return stream;
    };
  });
  await page.getByRole('button', { name: '采购入库', exact: true }).click();
  await page.getByRole('button', { name: '扫码添加物料', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scannerTestStream?.getVideoTracks()[0]?.readyState)).toBe('live');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => page.evaluate(() => window.scannerTestStream.getVideoTracks()[0].readyState)).toBe('ended');
  await expect(page.locator('.camera-error')).toContainText('摄像头已暂停');
  await page.getByRole('button', { name: '手动输入条码', exact: true }).click();
  await expect(page.locator('.camera-scanner-immersive')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '扫描物料条码', exact: true })).toBeEnabled();
  await context.close();
});

test('mobile layouts, shared editors and scanner remain usable at phone and tablet sizes', async ({ browser }) => {
  const { context, page } = await mobile(browser);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 900, height: 600 }]) {
    await page.setViewportSize(viewport);
    for (const label of ['工作台', '物料', '库存', '单据', '更多']) {
      await page.locator('.mw-tabs').getByRole('button', { name: label, exact: true }).click();
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(size.scroll).toBeLessThanOrEqual(size.width);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mw-tabs').getByRole('button', { name: '工作台', exact: true }).click();
  await page.screenshot({ path: 'output/ui-preview/mobile-web-home.png', fullPage: true });
  await page.locator('.mw-tabs').getByRole('button', { name: '物料', exact: true }).click();
  await page.getByRole('button', { name: '新增物料', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await page.getByRole('dialog').boundingBox()).width).toBe(390);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '打开扫码工作台', exact: true }).click();
  await page.getByRole('button', { name: '手动输入条码', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '物料条码', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '手机扫码', exact: true }).click();
  await expect(page.locator('.camera-error')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('mobile bottom drawers fit their content and keep long forms usable in small and keyboard viewports', async ({ browser }) => {
  const { context, page } = await mobile(browser, { reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '切换仓库', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveCSS('border-top-left-radius', '22px');
  await expect(dialog).toHaveCSS('border-bottom-left-radius', '0px');
  // A short picker leaves the underlying page visible and doesn't open the keyboard.
  // Other suites may have added warehouses to this shared server, so the sheet is
  // only required to hug its content below the shared --mw-modal-max-height cap.
  const picker = await dialog.boundingBox();
  expect(picker.height).toBeGreaterThan(0);
  expect(picker.height).toBeLessThanOrEqual(page.viewportSize().height - 48);
  expect(picker.x).toBe(0);
  expect(picker.y).toBeGreaterThan(0);
  expect(picker.y + picker.height).toBe(page.viewportSize().height);
  await page.screenshot({ path: 'output/ui-preview/mobile-drawer-warehouse.png' });
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

  await page.locator('.mw-tabs').getByRole('button', { name: '物料', exact: true }).click();
  await page.getByRole('button', { name: '新增物料', exact: true }).click();
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '保存物料', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭弹窗', exact: true })).toBeFocused();
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 900, height: 600 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds.x >= 0 && bounds.y > 0 && bounds.x + bounds.width <= viewport.width && Math.abs(bounds.y + bounds.height - viewport.height) < 1;
    }).toBe(true);
    // The bottom action remains reachable even in landscape, where the form scrolls as a whole.
    const save = dialog.getByRole('button', { name: '保存物料', exact: true });
    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox();
    expect(bounds.y).toBeGreaterThan(0);
    expect(bounds.y + bounds.height).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/ui-preview/mobile-drawer-product.png' });
  await dialog.getByRole('textbox', { name: /物料名称/ }).fill('移动弹窗验证');
  // Chromium desktop emulation has no software keyboard; simulate its visual viewport resize.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 380 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveClass(/mw-keyboard/);
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return bounds.y > 0 && Math.abs(bounds.y + bounds.height - 380) < 1;
  }).toBe(true);
  await dialog.getByRole('button', { name: '保存物料', exact: true }).scrollIntoViewIfNeeded();
  const action = await dialog.getByRole('button', { name: '保存物料', exact: true }).boundingBox();
  expect(action.y + action.height).toBeLessThan(380);
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await context.close();
});
