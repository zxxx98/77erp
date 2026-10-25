import { test, expect, devices } from '@playwright/test';
import { resolve } from 'node:path';

test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201,409]).toContain(r.status());
});
for (const device of [null, 'Pixel 7', 'iPhone 13']) test(`${device || 'desktop'} AI settings, Excel, transfer, stocktake confirmations and conversation recovery`, async ({ browser }) => {
  const mobile = !!device;
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', serviceWorkers: device === 'iPhone 13' ? 'allow' : 'block', ...(mobile ? devices[device] : { viewport: { width: 1440, height: 1000 } }) });
  try {
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const warehouse = await (await context.request.post('/api/warehouses', { data: { name: `AI-${mobile}-${Date.now()}` } })).json();
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?warehouse_id=${warehouse.id}`);
    if (device === 'iPhone 13') await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    if (mobile) { await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click(); }
    else await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /^AI 助手/ }).click();
    const settings = page.locator('.ai-settings');
    await settings.getByLabel('启用 AI 助手').check();
    await settings.getByLabel('API 基础地址').fill('https://ai.77erp.test/v1');
    await settings.getByLabel('模型名称').fill('test-model');
    await settings.getByLabel('API Key').fill('browser-test-key');
    await settings.getByRole('button', { name: '保存并测试连接', exact: true }).click();
    await expect(settings.getByText('配置已保存，连接测试成功。')).toBeVisible();
    await expect(settings.getByLabel('API Key')).toHaveValue('');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await page.getByRole('button', { name: '查询物料数量', exact: true }).click();
    await expect(page.getByLabel('你的需求')).toHaveValue('当前仓库有多少种物料？');
    await expect(page.getByLabel('附加物料 Excel / CSV')).toBeHidden();
    const chooserOpened = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '添加表格', exact: true }).click();
    const chooser = await chooserOpened;
    await chooser.setFiles(resolve('tests/fixtures/products.xlsx'));
    await expect(page.getByText('products.xlsx · 1 行')).toBeVisible();
    await page.getByLabel('你的需求').fill('导入上传表，新增物料档案，数量为期初库存。');
    const previewed = page.waitForResponse(response => response.url().endsWith('/api/ai/chat'));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const initial = await (await previewed).json();
    const action = page.locator('.ai-action');
    await expect(action).toContainText('新增物料预览 · 待确认');
    await expect(action).toContainText('001234');
    const before = await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json();
    expect(before.products).toHaveLength(0);

    // Continuing without confirmation dismisses the old preview and invalidates stale copies.
    await page.getByLabel('你的需求').fill('先不导入，继续聊聊');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(action).toHaveCount(0);
    await expect(page.getByLabel('你的需求')).toBeEnabled();
    await expect(action).toHaveCount(0);
    expect((await context.request.post('/api/ai/confirm', { data: { action_id: initial.actions[0].id } })).status()).toBe(409);
    expect((await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json()).products).toHaveLength(0);
    await page.reload();
    if (mobile) await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-user').filter({ hasText: '先不导入，继续聊聊' })).toBeVisible();
    await expect(action).toHaveCount(0);
    await page.getByLabel('你的需求').fill('重新导入上传表，新增物料档案，数量为期初库存。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(action).toHaveCount(1);
    await expect(action).toContainText('新增物料预览 · 待确认');
    await action.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(action).toHaveCount(0);
    await expect(page.locator('.ai-action-result')).toContainText('已完成，新增 1 个物料');
    await page.getByRole('button', { name: '查看操作详情', exact: true }).click();
    await expect(action).toContainText('新增物料预览 · 已完成');
    await expect(page.getByRole('button', { name: '确认执行本批操作' })).toHaveCount(0);
    await page.getByRole('button', { name: '收起详情', exact: true }).click();
    await expect(action).toHaveCount(0);
    await page.getByLabel('你的需求').fill('确认后继续聊天');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.ai-turn').last()).toContainText('确认后继续聊天');
    await expect(page.getByLabel('你的需求')).toBeEnabled();
    await expect(page.locator('.ai-turn').nth(2).locator('.ai-action-result')).toContainText('已完成，新增 1 个物料');
    await expect(page.locator('.ai-turn').last().locator('.ai-action-result')).toHaveCount(0);
    const after = await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json();
    expect(after.products).toHaveLength(1); expect(after.products[0].barcode).toBe('001234'); expect(after.products[0].stock).toBe(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    if (mobile) await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-action-result')).toContainText('已完成，新增 1 个物料');
    await expect(page.locator('.ai-turn').last()).toContainText('确认后继续聊天');
    await expect(page.locator('.ai-turn').nth(2).locator('.ai-action-result')).toHaveCount(1);
    const target = await (await context.request.post('/api/warehouses', { data: { name: `AI-target-${mobile}-${Date.now()}` } })).json();
    await page.getByRole('button', { name: '开始新对话' }).click();
    await page.getByLabel('你的需求').fill('调拨参数：' + JSON.stringify({ warehouse_id: warehouse.id, to_warehouse_id: target.id, reason: '门店补货', items: [{ product_id: after.products[0].id, quantity: 2 }] }));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.ai-action')).toContainText('仓库调拨预览 · 待确认');
    await expect(page.locator('.ai-action')).toContainText('将新建物料档案');
    await expect(page.locator('.ai-action')).toContainText('7 → 5');
    await page.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(page.locator('.ai-action')).toHaveCount(0);
    await expect(page.locator('.ai-action-result')).toContainText('已完成');
    const moved = await (await context.request.get(`/api/data?warehouse_id=${target.id}`)).json();
    expect(moved.products[0].stock).toBe(2);
    await page.getByRole('button', { name: '开始新对话' }).click();
    await page.getByLabel('你的需求').fill('盘点参数：' + JSON.stringify({ warehouse_id: warehouse.id, reason: '月末实盘', items: [{ product_id: after.products[0].id, counted: 3 }] }));
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.ai-action')).toContainText('库存盘点预览 · 待确认');
    await expect(page.locator('.ai-action')).toContainText('-2');
    await page.getByRole('button', { name: '确认执行本批操作' }).click();
    await expect(page.locator('.ai-action')).toHaveCount(0);
    await expect(page.locator('.ai-action-result')).toContainText('已完成，已盘点 1 种物料');
    const counted = await (await context.request.get(`/api/data?warehouse_id=${warehouse.id}`)).json();
    expect(counted.products[0].stock).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '开始新对话', exact: true }).click();
    await expect(page.getByText('今天，有什么')).toBeVisible();
    await page.screenshot({ path: `output/ai-design/welcome-${mobile ? 'mobile' : 'desktop'}.png` });
    if (mobile) await page.getByRole('button', { name: '查看历史对话' }).click();
    await page.locator('.ai-history-item').filter({ hasText: '导入上传表' }).first().click();
    await expect(page.locator('.ai-action-result')).toContainText('已完成，新增 1 个物料');
    await page.getByLabel('你的需求').fill('展示表格测试');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.ai-markdown table')).toContainText('不锈钢螺丝');
    await expect(page.locator('.ai-turn').last().locator('table')).toContainText('不锈钢螺丝');
    await expect(page.locator('.ai-turn').last().locator('.ai-action-result')).toHaveCount(0);
    await expect(page.locator('.ai-markdown script')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/ai-design/implemented-${mobile ? 'mobile' : 'desktop'}.png` });
    const urls = {
      HTTP: 'http://example.com/help', HTTPS: 'https://example.com/help', mixedCase: 'HtTpS://example.com/help',
      javascript: 'javascript:alert(1)', mixedJavascript: 'JaVaScRiPt:alert(1)', entityJavascript: 'java&#x73;cript:alert(1)',
      data: 'data:text/html;base64,PHNjcmlwdD4=', vbscript: 'vbscript:msgbox(1)', mailto: 'mailto:test@example.com',
      relative: '/settings', protocolRelative: '//example.com/help', fragment: '#help',
    };
    await page.route('**/api/ai/chat', route => route.fulfill({ json: {
      conversation_id: 'url-test', actions: [],
      messages: [{ role: 'assistant', content: Object.entries(urls).map(([name, url]) => `[${name}](${url})`).join('\n\n') }],
    } }));
    await page.getByLabel('你的需求').fill('链接安全测试');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const links = page.locator('.ai-markdown a');
    await expect(links).toHaveCount(Object.keys(urls).length);
    for (const [name, url] of Object.entries(urls)) {
      const link = links.filter({ hasText: new RegExp(`^${name}$`) });
      if (['HTTP', 'HTTPS', 'mixedCase'].includes(name)) {
        await expect(link).toHaveAttribute('href', url);
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      } else await expect(link).not.toHaveAttribute('href');
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
