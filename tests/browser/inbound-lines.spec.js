import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { chooseContact } from './contact-helpers.js';

for (const device of [null, 'Pixel 7', 'iPhone 13']) {
  test(`${device || 'desktop'} inbound fields, independent repeated rows and status icons`, async ({ browser }) => {
    const context=await browser.newContext({locale:'zh-CN',baseURL:'http://127.0.0.1:3199',serviceWorkers:'block',...(device ? devices[device] : {})});
    try {
      await context.request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});
      await context.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}});
      const warehouse=await (await context.request.post('/api/warehouses',{data:{name:`入库行-${randomUUID()}`}})).json();
      const headers={'X-Warehouse-ID':String(warehouse.id)};
      const product=await (await context.request.post('/api/products',{headers,data:{name:'重复入库物料',barcode:`IN-${randomUUID()}`,unit:'件',cost:2,price:5,threshold:0,category:"测试"}})).json();
      expect(product.id,JSON.stringify(product)).toBeTruthy();product.name="重复入库物料";
      await context.request.post('/api/contacts',{headers,data:{request_id:randomUUID(),name:'送货供应商',role:'supplier',active:1,person:'',phone:'',address:'',note:''}});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`/?warehouse_id=${warehouse.id}`);
      await page.getByRole('button',{name:device ? '入库' : '新建入库',exact:true}).first().click();
      const dialog=page.getByRole('dialog');await chooseContact(page,'送货供应商');
      const add=async()=>{
        await dialog.getByRole(device ? 'searchbox':'textbox',{name:device ? '搜索要添加的物料或条码':'查找并添加物料',exact:true}).fill(product.name);
        if(device)await dialog.getByRole('button',{name:new RegExp(`${product.name}，库存`)}).click();
        else await dialog.locator('.picker-results').getByRole('button',{name:new RegExp(product.name)}).click();
      };
      await add();await add();await add();
      const quantities=dialog.getByRole('spinbutton',{name:`${product.name} 数量`,exact:true});
      await expect(quantities).toHaveCount(3);
      await quantities.nth(0).fill('2');await quantities.nth(1).fill('3');await quantities.nth(2).fill('4');
      const prices=dialog.getByRole('spinbutton',{name:`${product.name} 单价`,exact:true});await prices.nth(1).fill('9');
      await dialog.getByRole('button',{name:`移除 ${product.name}`,exact:true}).nth(0).click();
      await expect(quantities).toHaveCount(2);await expect(quantities.nth(0)).toHaveValue('3');await expect(quantities.nth(1)).toHaveValue('4');await expect(prices.nth(0)).toHaveValue('9');
      await dialog.getByLabel('送货单号',{exact:true}).fill('DN-003');await dialog.getByLabel('送货时间',{exact:true}).fill('2026-11-04T09:30');await dialog.getByLabel('订单号码',{exact:true}).fill('PO-005');
      await dialog.getByRole('button',{name:'提交审核',exact:true}).click();
      if(device)await page.getByRole('button',{name:'确认提交',exact:true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const orders=await (await context.request.get('/api/orders',{headers})).json();const order=orders.orders[0];
      const detail=await (await context.request.get(`/api/orders/${order.id}`,{headers})).json();
      expect(detail.order.delivery_number).toBe('DN-003');expect(detail.order.delivery_time).toBe('2026-11-04T09:30');expect(detail.order.order_number).toBe('PO-005');
      expect(detail.order.items.map(i=>[i.quantity,i.price])).toEqual([[3,9],[4,2]]);
      const records=`/?warehouse_id=${warehouse.id}#purchases`;
      await page.goto(records);const row=()=>device ? page.locator('.mw-order-summary').filter({hasText:order.number}) : page.locator('tr').filter({hasText:order.number});
      await expect(row().locator('.order-icon')).toHaveClass(/blue/);
      await row().click();await expect(page.getByRole('dialog')).toContainText('DN-003');await expect(page.getByRole('dialog')).toContainText('PO-005');
      await expect(page.locator('.stock-approval-balance').nth(0).locator('span').nth(1)).toHaveText('7 件');
      await expect(page.locator('.stock-approval-balance').nth(1).locator('span').nth(1)).toHaveText('7 件');
      await context.request.post(`/api/orders/${order.id}/approve`,{headers,data:{request_id:randomUUID(),version:order.version}});
      await page.goto(records);await page.reload();await expect(row().locator('.order-icon')).toHaveClass(/green/);
      await context.request.post(`/api/orders/${order.id}/void`,{headers,data:{request_id:randomUUID(),reason:'浏览器验证作废'}});
      await page.reload();await expect(row().locator('.order-icon')).toHaveClass(/red/);expect(errors).toEqual([]);
    } finally {await context.close();}
  });
}
