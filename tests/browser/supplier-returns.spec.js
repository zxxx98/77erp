import { test, expect, devices } from '@playwright/test';
import { createApp } from '../../server/app.js';

for (const mobile of [false, true]) test.describe(mobile ? 'mobile warehouse' : 'desktop warehouse', () => {
  if (mobile) test.use({ userAgent: devices['iPhone 13'].userAgent, viewport: {width:390,height:844}, isMobile:true, hasTouch:true, serviceWorkers:'allow' });
  test('return selected source lines and receive supplier replacements', async ({ page }) => {
    const { app, db } = createApp(':memory:');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, data) => {
      const response = await page.request.post(base + '/api' + path, { data });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    try {
      await post('/auth/setup', { username: 'storekeeper', password: 'Test-password-123' });
      const product = await post('/products', {name:'铝管',barcode:'RETURN-AL',category:'原料',unit:'根',cost:5,price:6,threshold:1});
      const source = await post('/orders', {type:'in',partner:'测试供应商',order_number:'PO-62',delivery_number:'DN-9',
        items:[{product_id:product.id,price:5,quantity:8}]});
      await post(`/orders/${source.id}/approve`, {version:1,request_id:'approve-source'});
      await page.goto(base + (mobile ? '/#more' : '/#inventory'));
      if (mobile) {
        await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
        await page.reload();
        expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
      }
      await page.getByRole(mobile ? 'button' : 'link', {name:'退换货',exact:true}).click();
      await page.getByRole('button', {name:'新建退换货单'}).click();
      await page.getByRole('button', {name:source.number}).click();
      await expect(page.getByLabel('采购单号', {exact:true})).toHaveValue('PO-62');
      await expect(page.getByLabel('送货单号', {exact:true})).toHaveValue('DN-9');
      await page.getByRole('combobox', {name:'退货／换货'}).click();
      await page.getByRole('option', {name:'换货',exact:true}).click();
      await page.getByLabel('退货日期', {exact:true}).fill('2026-08-24');
      await page.getByLabel('操作原因').fill('来料损伤');
      await page.getByRole('spinbutton', {name:'铝管 退货数量'}).fill('2');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', {name:'确认换货出库'}).click();
      await expect(page.getByText('待补货', {exact:true})).toBeVisible();
      const exchange = db.prepare("SELECT * FROM orders WHERE return_mode='exchange'").get();
      const stock = () => db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock;
      expect(stock()).toBe(6);
      await page.getByRole('button', {name:exchange.number}).click();
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', {name:'确认补货收齐'}).click();
      await expect(page.getByText('已补收', {exact:true})).toBeVisible();
      expect(stock()).toBe(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      db.close();
    }
  });
});
