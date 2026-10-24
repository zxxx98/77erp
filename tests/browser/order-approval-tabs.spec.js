import { browserPosition } from './position-helpers.js';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(`${base}/api${path}`, {data:{request_id:randomUUID(),...data}});
    const body = await response.json(); expect(response.ok(),JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup',{username:'tabadmin',password:'Test-admin-123'});
  await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const product = await post('/products',{name:'审批测试成品',barcode:'TAB-OUTPUT',unit:'件',category:'生产',cost:0,price:2,threshold:0});
  const material = await post('/products',{name:'审批测试原料',barcode:'TAB-INPUT',unit:'kg',category:'生产',cost:2,price:3,threshold:0});
  db.prepare('UPDATE products SET stock=1000,inventory_value_cents=200000 WHERE id=?').run(material.id);
  const bom = await post('/boms',{name:'审批测试配方',product_id:product.id,base_quantity:1,base_unit:'件',note:'',enabled:1,items:[{product_id:material.id,quantity:2,unit:'kg',note:''}]});
  const orders=[];
  for(let i=0;i<11;i++){
    const order=await post('/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:5,note:`审批分页测试${i+1}`});
    orders.push(await post(`/production-orders/${order.id}/start`,{version:order.version,schema_version:2}));
  }
  return {base,db,post,orders,material,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}

for(const mobile of [false,true]) test(`${mobile?'mobile':'desktop'} approval tabs keep records compact and approve from paged detail`,async({page})=>{
  test.setTimeout(90000);
  if(mobile){await page.setViewportSize({width:390,height:844});await page.addInitScript(ua=>Object.defineProperty(navigator,'userAgent',{value:ua}),iphone);}
  const f=await fixture(page), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(`${f.base}/#sales`);
    const tabs=page.getByRole('tablist',{name:'单据分类'});
    await expect(tabs.getByRole('tab',{name:'出库记录',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('tabpanel',{name:'出库记录',exact:true})).toBeVisible();
    await tabs.getByRole('tab',{name:'出库记录',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab',{name:/领料.*补料待出库/})).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab',{name:/领料.*补料待出库.*11/})).toBeVisible();
    await expect(page.getByRole('region',{name:'生产领料出库单',exact:true})).toHaveCount(0);
    await tabs.getByRole('tab',{name:/领料.*补料待出库/}).click();
    const queue=page.getByRole('region',{name:'生产领料出库单',exact:true});
    await expect(queue.getByRole('button',{name:/查看并审批/})).toHaveCount(10);
    await expect(queue.getByRole('button',{name:'批准并确认出库',exact:true})).toHaveCount(0);
    await queue.getByRole('button',{name:'下一页生产材料单',exact:true}).click();
    await expect(queue.getByRole('button',{name:/查看并审批/})).toHaveCount(1);
    await queue.getByRole('button',{name:/查看并审批/}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog).toContainText('审批测试原料');
    await expect(dialog).toContainText('10 kg');
    if(mobile){
      await page.goBack();
      await expect(dialog).toHaveCount(0);
      await expect(tabs.getByRole('tab',{name:/领料.*补料待出库/})).toHaveAttribute('aria-selected','true');
      await queue.getByRole('button',{name:/查看并审批/}).click();
      await expect(dialog).toBeVisible();
    }
    await page.screenshot({path:test.info().outputPath('approval-detail.png'),fullPage:true,animations:'disabled'});
    if(mobile) await expect.poll(()=>dialog.evaluate(el=>Math.abs(el.getBoundingClientRect().height-innerHeight)<2)).toBe(true);
    let releaseApproval, requestStarted;
    if(mobile){
      const held=new Promise(resolve=>{releaseApproval=resolve;});
      let notifyStarted;
      requestStarted=new Promise(resolve=>{notifyStarted=resolve;});
      await page.route('**/api/production-material-documents/*/confirm',async route=>{notifyStarted();await held;await route.continue();},{times:1});
    }
    page.once('dialog',dialog=>dialog.accept());
    await dialog.getByRole('button',{name:'批准并确认出库',exact:true}).click();
    if(mobile){
      await requestStarted;
      try{
        await page.goBack();
        await expect(dialog).toBeVisible();
        await expect(tabs.getByRole('tab',{name:/领料.*补料待出库/})).toHaveAttribute('aria-selected','true');
      }finally{releaseApproval();}
    }
    await expect(dialog).toHaveCount(0);
    await expect(tabs.getByRole('tab',{name:/领料.*补料待出库.*10/})).toBeVisible();
    await expect(queue.getByRole('button',{name:/查看并审批/})).toHaveCount(10);
    expect(f.db.prepare('SELECT stock FROM products WHERE id=?').get(f.material.id).stock).toBe(990);
    await page.reload();
    await expect(tabs.getByRole('tab',{name:/领料.*补料待出库/})).toHaveAttribute('aria-selected','true');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('approval-tabs.png'),fullPage:true,animations:'disabled'});
    await tabs.getByRole('tab',{name:'出库记录',exact:true}).click();
    await expect(queue).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{await f.close();}
});

test('approval counts retry, failed approval keeps detail, cancellation updates counts and readonly users keep records',async({page})=>{
  const f=await fixture(page);
  try{
    await page.route('**/api/production-material-documents?**',async route=>{
      const url=new URL(route.request().url());
      if(url.searchParams.get('limit')==='1')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试数量读取失败'})});
      await route.continue();
    });
    await page.goto(`${f.base}/#sales`);
    await expect(page.getByRole('alert').filter({hasText:'待办数量读取失败'})).toBeVisible();
    await expect(page.getByRole('tab',{name:/领料.*补料待出库/})).toContainText('—');
    await page.unroute('**/api/production-material-documents?**');
    await page.getByRole('button',{name:'重试待办数量',exact:true}).click();
    await expect(page.getByRole('tab',{name:/领料.*补料待出库/})).toContainText('11');
    await page.getByRole('tab',{name:/领料.*补料待出库/}).click();
    await page.getByRole('button',{name:/查看并审批/}).first().click();
    f.db.prepare('UPDATE products SET stock=0,inventory_value_cents=0 WHERE id=?').run(f.material.id);
    page.once('dialog',dialog=>dialog.accept());
    const detail=page.getByRole('dialog');
    await detail.getByRole('button',{name:'批准并确认出库',exact:true}).click();
    await expect(detail.getByRole('alert')).toContainText('不足');
    await expect(detail).toBeVisible();
    expect(f.db.prepare("SELECT COUNT(*) n FROM production_material_documents WHERE status='confirmed'").get().n).toBe(0);
    await detail.getByRole('button',{name:'取消申请',exact:true}).click();
    await detail.getByLabel('取消申请原因').fill('不再生产');
    await detail.getByRole('button',{name:'确认取消申请',exact:true}).click();
    await expect(detail).toHaveCount(0);
    await expect(page.getByRole('tab',{name:/领料.*补料待出库/})).toContainText('10');
    const readonly=await f.post('/users',{position_id:await browserPosition(page.request, [], f.base),username:'tabreader',password:'Test-reader-123'});
    await f.post('/auth/login',{username:'tabreader',password:'Test-reader-123'});
    await page.reload();
    await expect(page.getByRole('tablist',{name:'单据分类'}).getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab',{name:'出库记录',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('region',{name:'生产领料出库单',exact:true})).toHaveCount(0);
  }finally{await f.close();}
});


