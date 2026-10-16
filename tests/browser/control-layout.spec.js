import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';
import { chooseOption } from './dropdown-helpers.js';

// A value assertion alone misses inputs whose text area has collapsed to zero.
async function expectReadable(control, minimum = 90) {
  await expect(control).toBeVisible();
  const metrics = await control.evaluate(input => {
    const style = getComputedStyle(input);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = style.font;
    return {
      available: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      text: context.measureText(input.value).width,
    };
  });
  expect(metrics.available).toBeGreaterThanOrEqual(Math.min(minimum, metrics.text));
}

for (const scenario of [
  { name: 'desktop', width: 1440 },
  { name: 'narrow desktop', width: 390 },
  { name: 'mobile web', width: 390, mobile: true },
  { name: 'small mobile web', width: 320, mobile: true },
]) {
  test(`warehouse actions align and select text stays readable on ${scenario.name}`, async ({ browser }) => {
    const { app, db } = createApp(':memory:');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ baseURL, viewport: { width: scenario.width, height: 900 },
      ...(scenario.mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', isMobile: true, hasTouch: true } : {}),
    });
    try {
      await context.request.post('/api/auth/setup', { data: { username: 'layout', password: 'Test-admin-123' } });
      for (const name of ['短仓', 'VN仓-副仓 越南专用仓（Kho phụ - Kho chuyên dụng tại Việt Nam）']) {
        expect((await context.request.post('/api/warehouses', { data: { name } })).ok()).toBe(true);
      }
      const page = await context.newPage();
      await page.goto(scenario.mobile ? '/#more' : '/#products');
      await page.getByRole('button', { name: scenario.mobile ? '商户与仓库设置' : '系统设置', exact: true }).click();
      const rows = page.locator('.warehouse-row');
      await expect(rows).toHaveCount(3);
      const aligned = async (name, expectedCount) => {
        const buttons = rows.getByRole('button', { name, exact: true });
        await expect(buttons).toHaveCount(expectedCount);
        const positions = await buttons.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().x));
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
      };
      await aligned('改名', 3);
      const deletePositions = await rows.locator('button[aria-label^="删除仓库"]').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().x));
      expect(Math.max(...deletePositions) - Math.min(...deletePositions)).toBeLessThanOrEqual(1);
      await rows.nth(1).getByRole('button', { name: '改名', exact: true }).click();
      await expect(rows.nth(1).getByRole('textbox')).toHaveValue('短仓');
      const save = await rows.nth(1).getByRole('button', { name: '保存名称', exact: true }).boundingBox();
      const rename = await rows.first().getByRole('button', { name: '改名', exact: true }).boundingBox();
      expect(Math.abs(save.x - rename.x)).toBeLessThanOrEqual(1);
      await rows.nth(1).getByRole('textbox').fill('改名后的仓库');
      await rows.nth(1).getByRole('button', { name: '保存名称', exact: true }).click();
      await expect(rows.nth(1)).toContainText('改名后的仓库');
      await chooseOption(page.getByRole('combobox', { name: '起始仓库', exact: true }), '1');
      await page.getByRole('button', { name: '添加仓库项', exact: true }).click();
      await page.getByRole('button', { name: '添加仓库项', exact: true }).click();
      for (let index = 1; index <= 2; index++) {
        const operator = page.getByRole('combobox', { name: `第 ${index} 项运算符`, exact: true });
        await expectReadable(operator);
        await chooseOption(operator, '-');
        await expect(operator).toHaveValue('−');
        await expectReadable(operator);
        await expectReadable(page.getByRole('combobox', { name: `第 ${index} 项仓库`, exact: true }));
      }
      // Check the actual modal scroller as well as the page for horizontal overflow.
      expect(await page.locator('.settings-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      if (!scenario.mobile) await page.goto('/#scanner');
      await page.getByRole('button', { name: scenario.mobile ? '出入库二维码' : '管理出入库二维码', exact: true }).click();
      await expectReadable(page.getByRole('combobox', { name: '按操作类型筛选', exact: true }));
      await expectReadable(page.getByRole('combobox', { name: '按二维码状态筛选', exact: true }));
      expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      db.close();
    }
  });
}
