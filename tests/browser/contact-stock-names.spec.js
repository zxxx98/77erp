import { test, expect, devices } from '@playwright/test';
import { createApp } from '../../server/app.js';
import { ensureContact } from './contact-helpers.js';

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile Web' : 'desktop Web'}: contacts delete, material returns and account names`, async ({ browser }) => {
    const { app, db } = createApp(':memory:');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ ...(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }), baseURL, serviceWorkers: 'block' });
    try {
      expect((await context.request.post('/api/auth/setup', { data: { username: 'owner', password: 'Test-password-123', name: '仓库管理员' } })).ok()).toBe(true);
      await context.request.post('/api/settings/reset', { data: { confirmation: 'RESET_BUSINESS_DATA' } });
      const product = await (await context.request.post('/api/products', { data: { name: '退料物料', barcode: 'RETURN-001', category: '日用', unit: '件', cost: 10, price: 20, threshold: 1 } })).json();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/#inventory');
      if (mobile) {
        await page.locator('.mw-product-row').getByRole('button', { name: /退料物料/ }).click();
      }
      await page.getByRole('button', { name: '增加库存（退料）', exact: true }).click();
      const increase = page.getByRole('dialog', { name: '增加库存（退料）', exact: true });
      await increase.getByRole('spinbutton').fill('1.123456');
      await increase.getByLabel('增加原因').fill('生产余料退回');
      page.once('dialog', dialog => dialog.accept());
      await increase.getByRole('button', { name: '确认增加', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock).toBe(1.123456);
      if (mobile) await page.locator('.mw-product-row').getByRole('button', { name: /退料物料/ }).click();
      else await page.getByRole('button', { name: '查看 退料物料 物料详情', exact: true }).click();
      await page.getByRole('button', { name: '查看操作记录', exact: true }).click();
      await expect(page.getByRole('region', { name: '当前物料操作记录' })).toContainText('增加库存（退料）');
      await expect(page.getByRole('region', { name: '当前物料操作记录' })).toContainText('生产余料退回');
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();

      for (const role of ['supplier', 'customer']) {
        const name = role === 'supplier' ? '可删除供应商' : '可删除客户';
        await ensureContact(context.request, name, { role });
        await page.goto('/?manage=data');
        await page.getByRole('button', { name: '往来单位', exact: true }).click();
        await page.getByRole('combobox', { name: '搜索往来单位', exact: true }).click();
        await page.getByRole('listbox').getByText(name, { exact: true }).click();
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: '删除往来单位', exact: true }).click();
        await expect(page.getByLabel('单位名称', { exact: true })).toHaveValue('');
        expect(db.prepare('SELECT 1 FROM contacts WHERE name=?').get(name)).toBeUndefined();
        await page.getByRole('button', { name: '取消', exact: true }).click();
      }
      if (mobile) {
        await page.getByRole('button', { name: '更多', exact: true }).click();
        await expect(page.locator('.mw-account')).toContainText('仓库管理员');
        await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click();
      } else {
        await expect(page.locator('.user-profile')).toContainText('仓库管理员');
        await page.getByRole('button', { name: '系统设置', exact: true }).click();
      }
      await page.getByRole('button', { name: /用户管理/ }).click();
      await page.getByLabel('新账号', { exact: true }).fill('staff');
      await page.getByLabel('账号名称', { exact: true }).fill('张三');
      await page.getByLabel('初始密码', { exact: true }).fill('Test-password-123');
      await page.getByRole('button', { name: '新增账号', exact: true }).click();
      const row = page.locator('.user-row').filter({ hasText: 'staff' });
      await expect(row).toContainText('张三');
      await row.getByRole('button', { name: '修改名称', exact: true }).click();
      const edit = page.getByRole('dialog', { name: '修改 staff 的名称', exact: true });
      await edit.getByLabel('名称', { exact: true }).fill('李四');
      await edit.getByRole('button', { name: '保存名称', exact: true }).click();
      await expect(edit).toHaveCount(0);
      await expect(row).toContainText('李四');
      expect(db.prepare("SELECT name FROM users WHERE username='staff'").get().name).toBe('李四');
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      db.close();
    }
  });
}
