import { test, expect, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const release = JSON.parse(readFileSync(new URL('../../shared/release-notes.json', import.meta.url), 'utf8'))[version];

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

async function session(browser, device, credentials = { username: 'admin', password: 'Test-admin-123' }, options = {}) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', ...(device ? devices[device] : {}), ...options });
  expect((await context.request.post('/api/auth/login', { data: credentials })).ok()).toBe(true);
  const page = await context.newPage();
  return { context, page };
}

test('built-in release notice is readable on desktop, Android and iPhone with shared receipts', async ({ browser }) => {
  const owner = await session(browser);
  const credentials = { username: `release-${Date.now()}`, password: 'Test-reader-123' };
  try {
    expect((await owner.context.request.post('/api/users', { data: { ...credentials, permissions: [] } })).status()).toBe(201);
    for (const device of [null, 'Pixel 7', 'iPhone 13']) {
      const { context, page } = await session(browser, device, credentials);
      try {
        await page.goto('/#announcements');
        const card = page.locator('.announcement-card').filter({ hasText: `77 ERP ${version} 更新公告` });
        await expect(card).toContainText(device ? '已读' : '未读');
        await card.click();
        const detail = page.getByRole('dialog', { name: '公告详情' });
        await expect(detail).toContainText('系统更新');
        await expect(detail.locator('.announcement-content')).toHaveText(`${release.date}\n\n${release.content.join('\n')}`);
        await expect(detail.getByRole('button', { name: '编辑公告', exact: true })).toHaveCount(0);
        await expect(card).toContainText('已读');
        await detail.getByRole('button', { name: '关闭', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally { await context.close(); }
    }
  } finally { await owner.context.close(); }
});

for (const device of [null, 'Pixel 7', 'iPhone 13']) {
  test(`${device || 'desktop'} can publish, read, update, pin and delete an announcement`, async ({ browser }) => {
    const { context, page } = await session(browser, device);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const title = `${device || '桌面'}盘点公告-${Date.now()}`;
    let id;
    const detailRequests = [];
    page.on('request', request => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/announcements/${id}`) detailRequests.push(request.url());
    });
    try {
      await page.clock.install();
      const expectNoUpdateNotice = async () => {
        const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
        await page.clock.fastForward(30000);
        expect((await checked).ok()).toBe(true);
        await expect(page.getByRole('status', { name: '数据更新提示' })).toHaveCount(0);
      };
      await page.goto('/');
      await page.getByRole(device ? 'button' : 'link', { name: '公告中心', exact: true }).click();
      await expect(page.getByRole('heading', { name: '公告中心', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '发布公告', exact: true }).click();
      await page.getByRole('textbox', { name: '公告标题', exact: true }).fill(title);
      await page.getByRole('textbox', { name: '公告正文', exact: true }).fill('周五下午盘点\n请提前整理库位。\n<script>alert("test")</script>');
      await page.getByRole('checkbox', { name: '置顶公告' }).check();
      const published = page.waitForResponse(response => response.url().endsWith('/api/announcements') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '确认发布', exact: true }).click();
      const response = await published;
      expect(response.status()).toBe(201);
      id = (await response.json()).id;
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const card = page.locator('.announcement-card').filter({ hasText: title });
      await expect(card).toContainText('置顶');
      await expect(card).toContainText('未读');
      await expectNoUpdateNotice();
      await card.click();
      const dialog = page.getByRole('dialog', { name: '公告详情' });
      await expect(dialog).toContainText('<script>alert("test")</script>');
      await expect.poll(async () => (await (await context.request.get(`/api/announcements/${id}`)).json()).unread).toBe(0);
      await expect(card).toContainText('已读');
      await expectNoUpdateNotice();
      await expect(dialog).toContainText('<script>alert("test")</script>');
      expect(detailRequests).toHaveLength(1);
      await dialog.getByRole('button', { name: '编辑公告', exact: true }).click();
      await page.getByRole('textbox', { name: '公告正文', exact: true }).fill('盘点改为周六上午。');
      await page.getByRole('checkbox', { name: '置顶公告' }).uncheck();
      await page.getByRole('button', { name: '保存修改', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(card).toContainText('未读');
      await expect(card).toContainText('盘点改为周六上午。');
      await expect(card).not.toContainText('置顶');
      await expectNoUpdateNotice();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `output/ui-preview/announcements-${device || 'desktop'}.png`, fullPage: true });
      await card.click();
      await expect(dialog).toContainText('盘点改为周六上午。');
      if (device) {
        await page.goBack();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await card.click();
      }
      page.once('dialog', confirm => confirm.accept());
      await dialog.getByRole('button', { name: '删除公告', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(card).toHaveCount(0);
      await expectNoUpdateNotice();
      expect(errors).toEqual([]);
    } finally {
      if (id) {
        const response = await context.request.get(`/api/announcements/${id}`);
        if (response.ok()) await context.request.delete(`/api/announcements/${id}`, { data: { version: (await response.json()).version } });
      }
      await context.close();
    }
  });
}

test('employee reading on mobile is reflected on desktop, with no management controls', async ({ browser }) => {
  const owner = await session(browser);
  const username = `reader-${Date.now()}`;
  const credentials = { username, password: 'Test-reader-123' };
  expect((await owner.context.request.post('/api/users', { data: { ...credentials, permissions: [] } })).status()).toBe(201);
  const published = await owner.context.request.post('/api/announcements', { data: { title: `跨设备公告-${username}`, content: '请查阅今日工作安排。', pinned: true } });
  const item = await published.json();
  const desktop = await session(browser, null, credentials);
  const mobile = await session(browser, 'Pixel 7', credentials);
  try {
    await desktop.page.goto('/#announcements');
    const desktopCard = desktop.page.locator('.announcement-card').filter({ hasText: item.title });
    await expect(desktopCard).toContainText('未读');
    await expect(desktop.page.getByRole('button', { name: '发布公告', exact: true })).toHaveCount(0);
    await mobile.page.goto('/#announcements');
    await mobile.page.locator('.announcement-card').filter({ hasText: item.title }).click();
    await expect(mobile.page.getByRole('dialog', { name: '公告详情' })).toContainText(item.content);
    await expect(mobile.page.getByRole('button', { name: '编辑公告', exact: true })).toHaveCount(0);
    await expect(mobile.page.getByRole('button', { name: '删除公告', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await (await mobile.context.request.get(`/api/announcements/${item.id}`)).json()).unread).toBe(0);
    await desktop.page.getByRole('button', { name: '刷新公告', exact: true }).click();
    await expect(desktopCard).toContainText('已读');
    await desktop.page.getByRole('group', { name: '公告筛选' }).getByRole('button', { name: /^只看未读/ }).click();
    await expect(desktopCard).toHaveCount(0);
  } finally {
    await owner.context.request.delete(`/api/announcements/${item.id}`, { data: { version: item.version } });
    await desktop.context.close(); await mobile.context.close(); await owner.context.close();
  }
});

test('PWA keeps the announcement form when offline and can publish after reconnecting', async ({ browser }) => {
  const { context, page } = await session(browser, 'Pixel 7', undefined, { serviceWorkers: 'allow' });
  let item;
  const detailRequests = [];
  page.on('request', request => {
    if (request.method() === 'GET' && item && new URL(request.url()).pathname === `/api/announcements/${item.id}`) detailRequests.push(request.url());
  });
  try {
    await page.goto('/#announcements');
    await expect(page.getByRole('heading', { name: '公告中心', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    await page.getByRole('button', { name: '发布公告', exact: true }).click();
    const title = `离线重连公告-${Date.now()}`;
    await page.getByRole('textbox', { name: '公告标题', exact: true }).fill(title);
    await page.getByRole('textbox', { name: '公告正文', exact: true }).fill('联网后发布这条公告。');
    await context.setOffline(true);
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('当前离线');
    await expect(page.getByRole('textbox', { name: '公告标题', exact: true })).toHaveValue(title);
    await context.setOffline(false);
    const published = page.waitForResponse(response => response.url().endsWith('/api/announcements') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '确认发布', exact: true }).click();
    item = await (await published).json();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const card = page.locator('.announcement-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.click();
    await expect(card).toContainText('已读');
    const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/updates');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await checked).ok()).toBe(true);
    await expect(page.getByRole('status', { name: '数据更新提示' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '公告详情' })).toContainText('联网后发布这条公告。');
    expect(detailRequests).toHaveLength(1);
  } finally {
    await context.setOffline(false);
    if (item?.id) await context.request.delete(`/api/announcements/${item.id}`, { data: { version: item.version } });
    await context.close();
  }
});
