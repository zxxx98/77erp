import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
async function fixture(page) {
  const {app,db}=createApp(':memory:'),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data,warehouse=1)=>{const r=await page.request.post(`${base}/api${path}`,{headers:{'X-Warehouse-ID':String(warehouse)},data:{request_id:randomUUID(),...data}});const body=await r.json();expect(r.ok(),JSON.stringify(body)).toBe(true);return body;};
  await post('/auth/setup',{username:'todosadmin',password:'Password-123'});
  await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const p=await post('/products',{name:'通知测试物料',barcode:'TODO-BROWSER',unit:'kg',category:'原料',cost:1,price:2,threshold:0});
  const submit=()=>post('/orders',{type:'in',partner:'通知测试供应商',items:[{product_id:p.id,quantity:1,price:2}]});
  return {base,post,submit,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}
for(const mobile of [false,true]) test(`${mobile?'mobile PWA shell':'desktop'} tasks merge notifications and remember only explicit acknowledgement`,async({page})=>{
  test.setTimeout(90000);
  if(mobile){await page.setViewportSize({width:390,height:844});await page.addInitScript(ua=>Object.defineProperty(navigator,'userAgent',{value:ua}),iphone);}
  const f=await fixture(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    const a=await f.submit(),b=await f.submit();
    await page.goto(`${f.base}/#todos`);
    const notice=page.getByRole('complementary',{name:'审核通知'}),tasks=page.getByRole('region',{name:'我的待办'});
    await expect(tasks).toContainText('共 2 项待审核');
    await expect(notice).toContainText('收到 2 项新的审核申请');
    await expect(page.getByRole('complementary',{name:'审核通知'})).toHaveCount(1);
    await notice.getByRole('button',{name:'查看待办',exact:true}).click();
    await page.reload();await expect(notice).toBeVisible();
    await page.route('**/api/todo-notifications/acknowledge',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'确认失败，请重试'})}),{times:1});
    await notice.getByRole('button',{name:'我知道了',exact:true}).click();
    await expect(notice.getByRole('alert')).toContainText('确认失败');
    await notice.getByRole('button',{name:'我知道了',exact:true}).click();
    await expect(notice).toHaveCount(0);
    await page.reload();await expect(tasks).toContainText('共 2 项待审核');await expect(notice).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath('my-todos.png'),fullPage:true});
    await tasks.getByRole('button',{name:'查看并审批',exact:true}).first().click();
    await expect(page).toHaveURL(new RegExp(`#purchases\\?approval=ordinary&q=${a.number}`));
    await page.getByRole('button',{name:'查看并审批',exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('dialog').getByRole('button',{name:'审核通过',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(notice).toContainText('您提交的 1 项审核已通过');
    await f.post(`/orders/${b.id}/approve`,{version:1});
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(notice).toContainText('您提交的 2 项审核已通过');
    await page.reload();await expect(notice).toContainText('您提交的 2 项审核已通过');
    await page.screenshot({path:test.info().outputPath('merged-notifications.png'),fullPage:true});
    await notice.getByRole('button',{name:'我知道了',exact:true}).click();await expect(notice).toHaveCount(0);
    const c=await f.submit();
    // A submission from another client is picked up without refreshing the workspace.
    await expect(notice).toContainText('收到 1 项新的审核申请',{timeout:20000});await expect(notice).toContainText(c.number);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await notice.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(mobile?390:1440);
    expect(errors).toEqual([]);
  } finally {await f.close();}
});

test.describe('PWA notification persistence',()=>{
  test.use({serviceWorkers:'allow'});
  test('service-worker controlled visits read live notifications and retain explicit acknowledgement',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(ua=>Object.defineProperty(navigator,'userAgent',{value:ua}),iphone);
    const f=await fixture(page);
    try {
      await f.submit();await page.goto(`${f.base}/#todos`);
      await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
      await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
      const notice=page.getByRole('complementary',{name:'审核通知'});
      await page.reload();await expect(notice).toContainText('收到 1 项新的审核申请');
      await notice.getByRole('button',{name:'我知道了',exact:true}).click();await expect(notice).toHaveCount(0);
      await page.reload();await expect(page.getByRole('region',{name:'我的待办'})).toContainText('共 1 项待审核');await expect(notice).toHaveCount(0);
      const urls=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(request=>request.url)))).flat();});
      expect(urls.some(url=>url.includes('/api/'))).toBe(false);
    } finally {await f.close();}
  });
});
