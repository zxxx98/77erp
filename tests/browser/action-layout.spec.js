import { browserPosition } from './position-helpers.js';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';

async function expectAlignedActions(groups) {
  const positions = await groups.evaluateAll(elements => elements.map(el => [...el.children]
    .filter(child => !child.hidden)
    .map(child => {
      const rect = child.getBoundingClientRect();
      return { x: rect.x, centerY: rect.y + rect.height / 2 };
    })));
  expect(positions.length).toBeGreaterThan(1);
  for (const row of positions) {
    expect(row).toHaveLength(3);
    expect(Math.max(...row.map(item => item.centerY)) - Math.min(...row.map(item => item.centerY))).toBeLessThanOrEqual(1);
    row.forEach((item, index) => expect(Math.abs(item.x - positions[0][index].x)).toBeLessThanOrEqual(1));
  }
}

for (const scenario of [
  { width: 1440, mobile: false },
  { width: 390, mobile: false },
  { width: 390, mobile: true },
  { width: 320, mobile: true },
]) {
  test(`user and QR actions align at ${scenario.width}px on ${scenario.mobile ? 'mobile web' : 'desktop'}`, async ({ browser }) => {
    const { app, db } = createApp(':memory:');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ locale: 'zh-CN', baseURL, viewport: { width: scenario.width, height: 1000 },
      ...(scenario.mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', isMobile: true, hasTouch: true } : {}),
    });
    try {
      const post = async (path, data) => {
        const response = await context.request.post('/api' + path, { data });
        expect(response.ok(), await response.text()).toBe(true);
        return response.json();
      };
      await post('/auth/setup', { username: 'owner', password: 'Test-admin-123' });
      await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
      for (const username of ['staff', 'staff_with_a_long_name_123456789']) {
        await post('/users', { position_id: await browserPosition(context.request), username, password: 'Test-admin-123', role: 'employee' });
      }
      const products = [];
      for (const [index, name, note] of [[1, '短物料', ''], [2, '有额外说明的物料', '有备注的卡片与其他卡片的操作区应对齐']]) {
        products.push(await post('/products', { name, barcode: `ACTION-${index}`, category: '日用', unit: '个', cost: 1, price: 2, threshold: 0, note }));
      }
      for (const [index, name] of [[1, '短二维码'], [2, '很长的二维码名称，用于检查操作区是否会因为名称变化而错位或者超出手机屏幕']]) {
        await post('/stock-qrs', { name, type: 'in', partner: '布局供应商', max_scans: 3, request_id: `layout-qr-${index}`,
          items: [{ product_id: products[0].id, quantity: 1, price_e4: 10000 }] });
      }
      const page = await context.newPage();
      await page.goto(scenario.mobile ? '/#more' : '/#products');
      await page.getByRole('button', { name: scenario.mobile ? '商户与仓库设置' : '系统设置', exact: true }).click();
      await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /用户管理/ }).click();
      await expect(page.locator('.user-row')).toHaveCount(3);
      await expectAlignedActions(page.locator('.user-actions'));
      expect(await page.locator('.settings-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.locator('.user-list').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const employee = page.locator('.user-row').filter({ hasText: 'staff_with_a_long_name_123456789' });
      await employee.getByRole('button', { name: '权限配置', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'staff_with_a_long_name_123456789 的权限配置', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '取消配置', exact: true }).click();
      page.once('dialog', dialog => dialog.accept());
      await employee.getByRole('button', { name: '停用', exact: true }).click();
      await expect(employee).toContainText('已停用');
      await expectAlignedActions(page.locator('.user-actions'));
      await page.getByRole('button', { name: '取消', exact: true }).click();
      if (!scenario.mobile) {
        await page.getByRole('button', { name: '网格视图', exact: true }).click();
        await expect(page.locator('.product-grid-card')).toHaveCount(2);
        const cards = await page.locator('.product-grid-card').evaluateAll(elements => elements.map(el => ({
          top: el.getBoundingClientRect().top,
          actionY: el.querySelector('.product-grid-actions').getBoundingClientRect().bottom,
          bottom: el.getBoundingClientRect().bottom,
        })));
        expect(Math.abs((cards[0].bottom - cards[0].actionY) - (cards[1].bottom - cards[1].actionY))).toBeLessThanOrEqual(1);
        if (Math.abs(cards[0].top - cards[1].top) <= 1) expect(Math.abs(cards[0].actionY - cards[1].actionY)).toBeLessThanOrEqual(1);
        await page.goto('/#scanner');
      }
      await page.getByRole('button', { name: scenario.mobile ? '出入库二维码' : '管理出入库二维码', exact: true }).click();
      const records = page.locator('.stock-qr-record');
      await expect(records).toHaveCount(2);
      await expectAlignedActions(records.locator('.stock-qr-actions'));
      expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await records.first().getByRole('button', { name: /^编辑 / }).click();
      await expect(page.getByRole('dialog').getByLabel('二维码名称', { exact: true })).toHaveValue(/二维码/);
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      db.close();
    }
  });
}
