import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs');

async function expectStableHover(button, container = button) {
  await expect(button).toBeVisible();
  await button.page().mouse.move(0, 0);
  const before = await container.boundingBox();
  const size = await button.boundingBox();
  await button.hover();
  // Cover the transition as well as the settled state.
  for (const delay of [0, 200]) {
    if (delay) await button.page().waitForTimeout(delay);
    expect(await container.boundingBox()).toEqual(before);
    expect(await button.boundingBox()).toEqual(size);
    await expect(button).toHaveCSS('border-top-width', '0px');
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
}

for (const device of ['desktop', 'narrow desktop', 'mobile']) {
  test(`text actions and image close stay unframed on ${device}`, async ({ page }) => {
    if (device !== 'desktop') await page.setViewportSize({ width: 390, height: 844 });
    if (device === 'mobile') await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    }));
    await page.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
    await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    await page.request.put('/api/settings/imagebed', { data: { base_url: 'https://img.77erp.test', auth_type: 'none', upload_folder: '77erp/products' } });
    const name = `按钮样式-${device}`;
    const response = await page.request.post('/api/products', { data: {
      name, barcode: `BUTTON-${device.replaceAll(" ", "-")}`, category: '按钮测试', unit: '个', cost: 1, price: 2, threshold: 0,
      image: 'https://img.77erp.test/file/button.png',
    } });
    expect(response.ok(), await response.text()).toBe(true);
    await page.route('https://img.77erp.test/**', route => route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' }));
    await page.goto('/#products');
    if (device !== 'mobile') {
      await page.getByRole('textbox', { name: '筛选物料', exact: true }).fill(name);
      const row = page.locator('.product-table tbody tr').filter({ hasText: name });
      for (const button of await row.locator('.row-actions button:visible').all()) await expectStableHover(button, row);
      await row.getByRole('button', { name: `查看 ${name} 物料详情`, exact: true }).click();
      const tabs = page.getByRole('tablist', { name: '物料详情视图' });
      for (const tab of await tabs.getByRole('tab').all()) {
        await expectStableHover(tab, tabs);
        await expect(tab).toHaveCSS('border-radius', '0px');
      }
      await tabs.getByRole('tab', { name: '品质图表', exact: true }).click();
      await expect(tabs.getByRole('tab', { name: '品质图表', exact: true })).toHaveAttribute('aria-selected', 'true');
      await tabs.getByRole('tab', { name: '物料信息', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    const thumbnail = page.getByRole('button', { name: `放大查看 ${name}`, exact: true }).first();
    await thumbnail.click();
    const close = page.getByRole('button', { name: '关闭图片预览', exact: true });
    await expectStableHover(close);
    await expect(close).toHaveCSS('padding', '0px');
    expect(await close.boundingBox()).toMatchObject({ width: 44, height: 44 });
    await close.click();
    await expect(close).toHaveCount(0);

    await page.goto('/#quality');
    if (device === 'mobile') await page.getByRole('navigation', { name: '品质管理功能' }).getByRole('button', { name: '模板配置', exact: true }).click();
    const book = new ExcelJS.Workbook();
    book.addWorksheet('按钮测试').addRow(['项目', '合格']);
    await page.getByLabel('上传模板 Excel').setInputFiles({ name: '按钮测试.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await book.xlsx.writeBuffer()) });
    await page.getByLabel('导入模板字段配置').setInputFiles({ name: '按钮测试.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, sheetName: '按钮测试', fields: [
        { id: 'result', name: '项目', type: 'string', labelRegion: 'A1', valueRegion: 'B1', configured: true },
      ] })) });
    await page.locator('.quality-field').click();
    const fieldTabs = page.getByRole('tablist', { name: '字段编辑视图' });
    for (const tab of await fieldTabs.getByRole('tab').all()) {
      await expectStableHover(tab, fieldTabs);
      await expect(tab).toHaveCSS('border-radius', '0px');
    }
    await fieldTabs.getByRole('tab', { name: '解析预览', exact: true }).click();
    await expect(fieldTabs.getByRole('tab', { name: '解析预览', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
}
