import { test, expect, devices } from '@playwright/test';
import sharp from 'sharp';

for (const device of [null, 'Pixel 7', 'iPhone 13']) test(`${device || 'desktop'} AI image attachments, paste, recovery and history`, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', serviceWorkers: device === 'iPhone 13' ? 'allow' : 'block', ...(device ? devices[device] : { viewport: { width: 1440, height: 1000 } }) });
  try {
    const setup = await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
    expect([201, 409]).toContain(setup.status());
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    expect((await context.request.put('/api/settings/ai', { data: { enabled: true, writes: true, base_url: 'https://ai.77erp.test/v1', model: 'test-model', secret: 'browser-test-key', daily_limit: 100 } })).ok()).toBe(true);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    if (device === 'iPhone 13') await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const open = async () => {
      if (device) await page.getByRole('button', { name: '更多', exact: true }).click();
      await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    };
    await open();
    const input = page.getByLabel('附加图片', { exact: true });
    await expect(input).toBeHidden();
    await expect(page.getByLabel('附加物料 Excel / CSV')).toBeHidden();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    const buffer = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#2563eb' } }).png().toBuffer();
    const photo = { name: '物料标签.png', mimeType: 'image/png', buffer };
    const chooserOpened = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '添加图片', exact: true }).click();
    await (await chooserOpened).setFiles(photo);
    const drafts = page.getByRole('group', { name: '待发送图片' });
    await expect(drafts.locator('img')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await drafts.getByRole('button', { name: '放大查看 物料标签.png', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '图片预览：物料标签.png' })).toBeVisible();
    await page.getByRole('button', { name: '关闭图片预览' }).click();
    await page.getByRole('button', { name: '移除图片 物料标签.png', exact: true }).click();
    await expect(drafts).toHaveCount(0);
    await input.setInputFiles(photo);
    await expect(drafts.locator('img')).toHaveCount(1);

    // Clipboard file data follows the same compression/validation path on both UIs.
    await page.getByLabel('你的需求').evaluate((element, base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([bytes], '粘贴截图.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, buffer.toString('base64'));
    await expect(drafts.locator('img')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '添加图片', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    await page.screenshot({ path: `output/ui-preview/ai-image-drafts-${device || 'desktop'}.png` });
    await input.setInputFiles([photo, photo]);
    await expect(page.getByRole('alert')).toContainText('最多添加 3 张');
    await expect(drafts.locator('img')).toHaveCount(2);
    await input.setInputFiles({ name: '不是图片.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
    await expect(page.getByRole('alert')).toContainText('图片无法读取');
    await expect(drafts.locator('img')).toHaveCount(2);
    await page.getByRole('button', { name: '移除图片 粘贴截图.png', exact: true }).click();

    // A real offline send is rejected before networking, including with a controlling SW.
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('离线');
    await expect(drafts.locator('img')).toHaveCount(1);
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    const request = page.waitForRequest(req => req.url().endsWith('/api/ai/chat'));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const body = (await request).postDataJSON();
    expect(body.message).toBe('请帮我分析上传的图片。');
    expect(body.images).toHaveLength(1);
    expect(Buffer.from(body.images[0].data_url.split(',')[1], 'base64').length).toBeLessThanOrEqual(1024 * 1024);
    const metadata = await sharp(Buffer.from(body.images[0].data_url.split(',')[1], 'base64')).metadata();
    expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(2048);
    await expect(page.locator('.ai-markdown')).toContainText('已收到 1 张图片');
    await expect(page.getByRole('group', { name: '消息图片' }).locator('img')).toHaveCount(1);
    await expect(drafts).toHaveCount(0);
    await page.reload();
    await open();
    await expect(page.getByRole('group', { name: '消息图片' }).locator('img')).toHaveCount(1);
    await expect(page.getByRole('group', { name: '消息图片' }).locator('img')).toBeVisible();
    await expect(page.getByLabel('你的需求')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/ui-preview/ai-images-${device || 'desktop'}.png` });
    await input.setInputFiles(photo);
    await expect(drafts.locator('img')).toHaveCount(1);
    await page.getByRole('button', { name: '开始新对话', exact: true }).click();
    await expect(drafts).toHaveCount(0);
    await expect(page.getByRole('group', { name: '消息图片' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
