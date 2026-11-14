import { test, expect } from '@playwright/test';
import { productionIssuesFixture } from '../helpers/production-issues.js';

for (const device of ['desktop','mobile','pwa']) test(`${device} records shortages, displays live deficits and settles after actual replenishment`, async ({ page, browser }) => {
  test.setTimeout(90000);
  const context=device==='pwa'?await browser.newContext({locale:'zh-CN',serviceWorkers:'allow',viewport:{width:390,height:844}}):page.context();
  if(device==='pwa') page=await context.newPage();
  if(device==='mobile') await page.setViewportSize({width:390,height:844});
  const f=await productionIssuesFixture();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    const split=f.cookie.indexOf('=');
    await context.addCookies([{name:f.cookie.slice(0,split),value:f.cookie.slice(split+1),url:f.base,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`${f.base}/#production?order=${f.order.id}`);
    if(device==='pwa') await page.evaluate(()=>navigator.serviceWorker.ready);
    await expect(page.getByRole('button',{name:'登记',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
    await page.getByRole('button',{name:'登记',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'生产登记',exact:true});
    await drawer.getByLabel('本次数量',{exact:true}).fill('12');
    await drawer.getByRole('button',{name:'提交登记',exact:true}).click();
    await expect(drawer).toHaveCount(0);
    const records=page.getByRole('region',{name:'登记与待处理问题'});
    await expect(records).toContainText('待结算');
    await expect(records).toContainText('原料 · 还缺 4 kg');
    await expect(records).toContainText('辅料 · 还缺 2 kg');
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await expect(page.getByRole('button',{name:'结束生产',exact:true}).first()).toBeDisabled();
    await page.keyboard.press('Escape');
    let order=await f.get();
    expect(order.completed_quantity).toBeNull();expect(order.receipt_documents).toHaveLength(0);
    const added=await f.supplement(order,[[f.raw,4],[f.other,2]]);
    await page.reload();
    await expect(records).toContainText('原料 · 还缺 4 kg');
    await f.confirm(added.doc);
    await page.reload();
    await expect(records.locator('p.bom-hint').filter({hasText:'还缺'})).toHaveCount(0);
    await records.getByRole('button',{name:'统一核对并结算',exact:true}).click();
    await expect(records.getByRole('button',{name:'统一核对并结算',exact:true})).toHaveCount(0);
    await expect(records).toContainText('已结算');
    order=await f.get();expect(order.pending_registration_count).toBe(0);expect(order.completed_quantity).toBe(12);expect(order.receipt_documents).toHaveLength(1);
    const bounds=await records.boundingBox();expect(bounds.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
    expect(errors).toEqual([]);
    await page.screenshot({path:test.info().outputPath(`${device}-settled-registration.png`)});
  } finally { if(device==='pwa') await context.close();await f.close(); }
});

test('mobile predecessor with zero available quantity can be selected and recorded for later settlement',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const f=await productionIssuesFixture(undefined,{routed:true});
  try {
    const split=f.cookie.indexOf('=');await page.context().addCookies([{name:f.cookie.slice(0,split),value:f.cookie.slice(split+1),url:f.base}]);
    await page.goto(`${f.base}/#production?order=${f.order.id}`);
    await page.getByRole('tab',{name:'生产进度',exact:true}).click();
    await page.locator('.production-progress-item details').filter({hasText:'工序进度与登记'}).locator('summary').click();
    await page.getByRole('button',{name:'登记 组装',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'生产登记',exact:true});
    await drawer.getByLabel('本次数量',{exact:true}).fill('2');
    await drawer.getByRole('button',{name:'提交登记',exact:true}).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('region',{name:'登记与待处理问题'})).toContainText('前序报工不足');
    const order=await f.get();expect(order.pending_registration_count).toBe(1);expect(order.batches).toHaveLength(0);
  } finally {await f.close();}
});

for(const device of ['desktop','mobile','pwa']) test(`${device} uses unsettled semi-finished output and settles automatically when production ends`,async({page,browser})=>{
  test.setTimeout(90000);
  const context=device==='pwa'?await browser.newContext({locale:'zh-CN',serviceWorkers:'allow',viewport:{width:390,height:844}}):page.context();
  if(device==='pwa')page=await context.newPage();
  if(device==='mobile')await page.setViewportSize({width:390,height:844});
  const f=await productionIssuesFixture(undefined,{staged:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    let order=f.ok(await f.complete(f.order,24,[['1.1',72]],{path:'1'}));
    const split=f.cookie.indexOf('=');await context.addCookies([{name:f.cookie.slice(0,split),value:f.cookie.slice(split+1),url:f.base}]);
    await page.goto(`${f.base}/#production?order=${order.id}`);
    if(device==='pwa')await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.getByRole('tab',{name:'生产进度',exact:true}).click();
    const semi=page.locator('.production-progress-item').filter({has:page.getByRole('button',{name:'登记 半成品',exact:true})});
    await expect(semi).toContainText('24 / 20 kg');
    await page.getByRole('button',{name:'登记 成品',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'生产登记',exact:true});
    await drawer.getByLabel('本次数量',{exact:true}).fill('12');
    await drawer.getByRole('button',{name:'提交登记',exact:true}).click();
    await expect(drawer).toHaveCount(0);
    order=await f.get();expect(order.flow_progress.completed_quantity).toBe(12);expect(order.batches).toHaveLength(0);
    const added=await f.supplement(order,[[f.raw,12]]);order=await f.confirm(added.doc);
    expect(order.flow_progress.settlement_ready).toBe(true);
    await page.reload();
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    const finish=page.getByRole('button',{name:'结束生产',exact:true}).first();
    await expect(finish).toBeEnabled();
    page.once('dialog',dialog=>dialog.accept());await finish.click();
    await expect.poll(async()=>(await f.get()).status).toBe('completed');
    order=await f.get();expect(order.pending_registration_count).toBe(0);expect(order.completed_quantity).toBe(12);
    expect(order.receipt_documents).toHaveLength(1);expect(errors).toEqual([]);
    await page.screenshot({path:test.info().outputPath(`${device}-flow-finished.png`)});
  } finally {if(device==='pwa')await context.close();await f.close();}
});

for(const device of ['desktop','mobile']) test(`${device} registration drawer scrolls cleanly with many pending records`,async({page})=>{
  if(device==='mobile') await page.setViewportSize({width:390,height:844});
  const f=await productionIssuesFixture(undefined,{routed:true});
  try {
    let order=f.order;
    for(let i=0;i<6;i++) order=f.ok(await f.complete(order,12,[[f.raw,24],[f.other,12]]));
    const split=f.cookie.indexOf('=');
    await page.context().addCookies([{name:f.cookie.slice(0,split),value:f.cookie.slice(split+1),url:f.base,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`${f.base}/#production?order=${order.id}`);
    await page.getByRole('button',{name:'登记',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'生产登记',exact:true});
    await expect(drawer.getByLabel('本次数量',{exact:true})).toBeVisible();
    await expect(drawer.getByRole('button',{name:'提交登记',exact:true})).toBeVisible();
    const body=drawer.locator('.form-body');
    const scrollMetrics=await body.evaluate(el=>({scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth+1);
    const cards=drawer.locator('.process-history-card');
    await expect(cards).toHaveCount(6);
    const firstMain=await cards.first().locator('.process-history-main').boundingBox();
    expect(firstMain.width).toBeGreaterThanOrEqual(device==='desktop'?260:200);
    await cards.last().scrollIntoViewIfNeeded();
    const scrolledTop=await body.evaluate(el=>el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);
    const lastBox=await cards.last().boundingBox();
    const viewportHeight=await page.evaluate(()=>window.innerHeight);
    expect(lastBox.y+lastBox.height).toBeLessThanOrEqual(viewportHeight+2);
  } finally { await f.close(); }
});
