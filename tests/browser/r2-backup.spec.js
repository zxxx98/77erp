import { test, expect, devices } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(r.status());
});
for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} R2 backup settings persist and redact credentials`, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', ...(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }) });
  try {
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const page = await context.newPage();
    const open = async () => {
      await page.goto('/');
      if (mobile) { await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click(); }
      else await page.getByRole('button', { name: '系统设置', exact: true }).click();
      await page.getByRole('button', { name: /^备份与恢复/ }).click();
    };
    await open();
    const region = page.getByRole('region', { name: 'R2 自动备份' });
    await region.getByLabel('Cloudflare Account ID').fill('a'.repeat(32));
    await region.getByLabel('R2 存储桶', { exact: true }).fill('erp-backups');
    await region.getByLabel('R2 Access Key ID', { exact: true }).fill('browser-access');
    await region.getByLabel('R2 Secret Access Key', { exact: true }).fill('browser-secret');
    await region.getByLabel('Cron 表达式（五段）').fill('0 * * * *');
    await region.getByRole('button', { name: '保存备份设置' }).click();
    await expect(region.getByText('R2 备份设置已保存。')).toBeVisible();
    await expect(region.getByLabel('R2 Secret Access Key', { exact: true })).toHaveValue('');
    await open();
    await expect(region.getByLabel('Cron 表达式（五段）')).toHaveValue('0 * * * *');
    await expect(region.getByLabel('R2 Secret Access Key', { exact: true })).toHaveAttribute('placeholder', '已保存，留空保留');
    await expect(region.getByText('最近 50 次备份')).toHaveCount(0);
    await expect(region.getByLabel('备份通知格式')).toHaveCount(0);
    await page.getByRole('button', { name: /^通知设置/ }).click();
    const notifications = page.getByRole('region', { name: '通知设置' });
    await notifications.getByRole('checkbox', { name: /^数据库备份/ }).check();
    await notifications.getByRole('button', { name: '保存通知设置', exact: true }).click();
    await expect(notifications.getByText('通知设置已保存。')).toBeVisible();
    const config = await (await context.request.get('/api/settings/notifications')).json();
    expect(config.events).toContain('database_backup');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await context.close(); }
});
