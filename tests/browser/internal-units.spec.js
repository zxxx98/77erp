import { test, expect, devices } from '@playwright/test';
import { chooseOption } from './dropdown-helpers.js';
import { chooseContact } from './contact-helpers.js';

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect([201, 409]).toContain(response.status());
});

for (const device of [null, 'Pixel 7', 'iPhone 13']) {
  test(`${device || 'desktop'} creates an internal unit and uses it for both directions without changing trading totals`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', serviceWorkers: device === 'iPhone 13' ? 'allow' : 'block', ...(device ? devices[device] : { viewport: { width: 1440, height: 1000 } }) });
    await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const suffix = `${(device || 'desktop').replaceAll(' ', '-')}-${Date.now()}`;
    const name = `内部产线-${suffix}`, productName = `回库物料-${suffix}`;
    try {
      const created = await context.request.post('/api/products', { data: { name: productName, barcode: `INT-${suffix}`, category: '内部流转', unit: '件', cost: 10, price: 30, threshold: 0 } });
      expect(created.status()).toBe(201);
      const { id: productId } = await created.json();
      expect((await context.request.post('/api/orders', { data: { type: 'in', partner: `初始供应商-${suffix}`, items: [{ product_id: productId, quantity: 10, price: 10 }] } })).status()).toBe(201);
      const before = await (await context.request.get('/api/dashboard')).json();
      await page.goto('/?manage=data');
      await page.getByRole('button', { name: '往来单位', exact: true }).click();
      await chooseOption(page.getByRole('combobox', { name: '往来类型', exact: true }), 'internal');
      await page.getByLabel('单位名称', { exact: true }).fill(name);
      await page.getByRole('button', { name: '保存往来单位', exact: true }).click();
      await expect(page.getByLabel('单位名称', { exact: true })).toHaveValue('');
      const contact = (await (await context.request.get('/api/contacts')).json()).find(contact => contact.name === name);
      expect(contact.role).toBe('internal');
      const orders = [];
      for (const type of ['out', 'in']) {
        await page.goto('/#overview');
        if (device) await page.getByRole('button', { name: type === 'in' ? '采购入库' : '销售出库', exact: true }).click();
        else {
          await page.getByRole('link', { name: type === 'in' ? '采购入库' : '销售出库', exact: true }).click();
          await page.getByRole('button', { name: type === 'in' ? '新建入库' : '新建出库', exact: true }).click();
        }
        await chooseContact(page, name, type === 'in' ? '供应商' : '客户 / 往来单位');
        const label = type === 'in' ? '内部入库' : '内部出库';
        const dialog = page.getByRole('dialog', { name: device ? label : `新建${label}`, exact: true });
        await expect(dialog).toContainText('不计入采购额、销售额');
        const search = device ? dialog.getByRole('searchbox', { name: '搜索要添加的物料或条码' }) : dialog.getByRole('textbox', { name: '查找并添加物料' });
        await search.fill(productName);
        if (device) await dialog.getByRole('button', { name: new RegExp(`${productName}，库存`) }).click();
        else await dialog.locator('.picker-results button').filter({ hasText: productName }).click();
        await dialog.getByRole('spinbutton', { name: `${productName} 数量`, exact: true }).fill('2');
        await dialog.getByRole('spinbutton', { name: `${productName} 单价`, exact: true }).fill(type === 'in' ? '10' : '999');
        const saved = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: type === 'in' ? '确认入库' : '确认出库', exact: true }).click();
        if (device) await page.getByRole('dialog', { name: `确认${label}？`, exact: true }).getByRole('button', { name: '确认提交', exact: true }).click();
        const response = await saved;
        expect(response.status()).toBe(201);
        const order = await response.json();
        orders.push(order);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const detail = await (await context.request.get(`/api/orders/${order.id}`)).json();
        expect(detail.order.kind).toBe('internal');
        expect(detail.order.partner_id).toBe(contact.id);
        expect(detail.order.settlement_tracked).toBe(0);
      }
      await page.goto('/#history');
      await page.getByRole('button', { name: /^内部流转/ }).click();
      await expect(page.getByText(orders[0].number, { exact: true })).toBeVisible();
      await expect(page.getByText(orders[1].number, { exact: true })).toBeVisible();
      if (device) await page.locator('.mw-card').filter({ hasText: orders[0].number }).click();
      else await page.getByRole('button', { name: `查看单据 ${orders[0].number}` }).click();
      const detail = page.getByRole('dialog');
      await expect(detail).toContainText('内部出库');
      await expect(detail).toContainText('不计入采购、销售、利润及应收应付');
      await expect(detail.getByRole('heading', { name: '收付款' })).toHaveCount(0);
      await expect(detail.getByRole('button', { name: '确认退货', exact: true })).toHaveCount(0);
      const after = await (await context.request.get('/api/dashboard')).json();
      expect(after.today).toEqual(before.today);
      const product = await (await context.request.get(`/api/products/${productId}`)).json();
      expect(product.product.stock).toBe(10);
      expect(product.product.inventory_value_cents).toBe(10000);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await page.screenshot({ path: `/tmp/77erp-internal-${device || 'desktop'}.png`, fullPage: true });
    } finally { await context.close(); }
  });
}
