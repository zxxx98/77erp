import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { chooseOption } from './dropdown-helpers.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

async function setupMultiLevelFixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), ...data } });
    const body = await response.json();
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    return body;
  };
  await post('/auth/setup', { username: 'orderadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });

  const customer = await post('/contacts', { role: 'customer', name: '创维电源客户', person: '张经理', phone: '13900001111', address: '', note: '', active: 1 });
  const raw = await post('/products', { name: '铜芯线材', barcode: 'RAW-CU', unit: '米', category: '生产', cost: 1, price: 2, threshold: 0 });
  db.prepare('UPDATE products SET stock=200,inventory_value_cents=20000 WHERE id=?').run(raw.id);
  const semi = await post('/products', {
    name: '半成品插头组件', barcode: 'SEMI-PLUG', unit: '件', category: '生产', cost: 2, price: 4, threshold: 0,
    customer_part_numbers: [{ customer_id: customer.id, part_number: 'CUST-SEMI-88' }],
  });
  const finished = await post('/products', {
    name: '美式电源线黑色 COCA0103', barcode: '72757168-0004', unit: 'PCS', category: '生产', cost: 5, price: 10, threshold: 0,
    customer_part_numbers: [{ customer_id: customer.id, part_number: 'CUST-FG-0103' }],
  });

  const semiBom = await post('/boms', {
    name: '插头组件BOM', product_id: semi.id, base_quantity: 1, base_unit: '件', note: '', enabled: 1,
    items: [{ product_id: raw.id, quantity: 2, unit: '米', note: '' }],
  });
  const fgBom = await post('/boms', {
    name: '美式电源线黑色 COCA0103-BOM表（成品）', product_id: finished.id, base_quantity: 1, base_unit: 'PCS', note: '', enabled: 1,
    items: [{ product_id: semi.id, quantity: 1, unit: '件', usage_mode: 'explode', child_bom_id: semiBom.id, note: '' }],
  });

  return {
    base,
    customer,
    fgBom,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); },
  };
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} creates production order with top order info and displays customer part numbers on finished and semi-finished cards`, async ({ page }) => {
    test.setTimeout(60000);
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
    }
    const f = await setupMultiLevelFixture(page);
    try {
      await page.goto(`${f.base}/#production`);
      await page.getByRole('button', { name: '新建生产单', exact: true }).click();

      const orderHeader = page.getByRole('region', { name: '订单信息', exact: true });
      await expect(orderHeader).toBeVisible();
      await orderHeader.getByLabel('订单号码', { exact: true }).fill('SO-261126-01');
      await chooseOption(orderHeader.getByRole('combobox', { name: '客户简称', exact: true }), String(f.customer.id));
      await orderHeader.getByLabel('交期', { exact: true }).fill('2026-12-20');

      await page.getByRole('button', { name: /美式电源线黑色 COCA0103/ }).click();

      // Both the finished good card and the semi-finished supply card pull in customer part numbers automatically.
      await expect(page.locator('.production-customer-part').filter({ hasText: '客户料号：CUST-FG-0103' }).first()).toBeVisible();
      await expect(page.locator('.production-supply .production-customer-part')).toContainText('客户料号：CUST-SEMI-88');

      await page.getByLabel('计划产量', { exact: true }).fill('10');

      // Verify "Save and continue with same order" keeps top order fields for creating another order.
      await page.getByRole('button', { name: '保存并按同订单继续建单', exact: true }).click();
      await expect(page.locator('.bom-success')).toContainText('已保留订单信息');
      await expect(orderHeader.getByLabel('订单号码', { exact: true })).toHaveValue('SO-261126-01');
      await expect(orderHeader.getByLabel('交期', { exact: true })).toHaveValue('2026-12-20');

      await page.getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.locator('.production-orders-table')).toContainText('SO-261126-01');
      await expect(page.locator('.production-orders-table')).toContainText('创维电源客户');
      await expect(page.locator('.production-orders-table')).toContainText('CUST-FG-0103');

      await page.getByRole('button', { name: /^查看生产单 SC/ }).first().click();
      const detailMeta = page.getByRole('region', { name: '订单信息', exact: true });
      await expect(detailMeta).toContainText('SO-261126-01');
      await expect(detailMeta).toContainText('创维电源客户');
      await expect(detailMeta).toContainText('2026-12-20');
      await expect(detailMeta).toContainText('CUST-FG-0103');

      // Progress tab cards display customer part numbers on both finished and semi-finished levels.
      await page.getByRole('tab', { name: '生产进度', exact: true }).click();
      const progress = page.locator('.production-progress-list');
      await expect(progress).toContainText('客户料号：CUST-FG-0103');
      await expect(progress).toContainText('客户料号：CUST-SEMI-88');

      // Recipe structure horizontal tree also displays customer part numbers on root and semi-finished cards.
      await page.getByRole('tab', { name: '配方结构', exact: true }).click();
      const tree = page.getByRole('region', { name: '配方横向树状图', exact: true });
      await expect(tree).toContainText('客户料号：CUST-FG-0103');
      await expect(tree).toContainText('客户料号：CUST-SEMI-88');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await f.close();
    }
  });
}
