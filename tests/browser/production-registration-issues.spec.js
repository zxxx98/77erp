import { test, expect, devices } from '@playwright/test';
import { productionIssuesFixture } from '../helpers/production-issues.js';
import { confirmFinishPipeline } from './production-ui-helpers.js';

function dismissApprovalNotices(page) {
  return page.addLocatorHandler(page.getByRole('complementary', { name: '审核通知' }), async notice => {
    await notice.getByRole('button', { name: '我知道了', exact: true }).click();
  });
}

for(const device of ['desktop','mobile','pwa']) test(`${device} corrects pending consumption and settles without replacing the registration`,async({page,browser})=>{
  const context=device==='desktop'?page.context():await browser.newContext({locale:'zh-CN',...devices[device==='mobile'?'Pixel 7':'iPhone 13'],serviceWorkers:device==='pwa'?'allow':'block'});
  if(device!=='desktop') page=await context.newPage();
  await dismissApprovalNotices(page);
  const f=await productionIssuesFixture();
  try {
    const order=f.ok(await f.complete(f.order,12,[[f.raw,24],[f.other,12]]));
    const split=f.cookie.indexOf('=');
    await context.addCookies([{name:f.cookie.slice(0,split),value:f.cookie.slice(split+1),url:f.base}]);
    await page.goto(`${f.base}/#production?order=${order.id}`);
    const records=page.getByRole('region',{name:'登记与待处理问题'});
    await expect(records.getByRole('heading')).toContainText('未核对/总数 1/1');
    await expect(records.getByRole('button',{name:'调整本次用料'})).toHaveCount(0);
    await records.locator('.registration-record-summary').click();
    await records.getByRole('button',{name:'调整本次用料'}).click();
    for(const label of ['原料 本次用量','原料 差异原因']) {
      const input=records.getByLabel(label);
      if(device==='desktop') await expect(input).toHaveClass(/ant-input/);
      else await expect(input.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " erp-mobile-input ")]')).toBeVisible();
    }
    await records.getByLabel('原料 本次用量').fill('20');
    await records.getByLabel('原料 差异原因').fill('核对实际用量');
    await records.getByLabel('辅料 本次用量').fill('10');
    await records.getByLabel('辅料 差异原因').fill('核对实际用量');
    await records.getByRole('button',{name:'保存用料'}).click();
    await expect(records).toContainText('用料调整记录');
    await records.getByRole('button',{name:'核对并结算',exact:true}).click();
    await expect(records).toContainText('已结算');
    await expect(records.getByRole('heading')).toContainText('未核对/总数 0/1');
    const updated=await f.get();
    expect(updated.pending_registration_count).toBe(0);
    expect(updated.operation_registrations[0].id).toBe(order.operation_registrations[0].id);
  } finally {if(device!=='desktop') await context.close(); await f.close();}
});

for (const device of ['desktop', 'Pixel 7', 'pwa']) test(`${device} groups editable inputs by material and preserves the original input order on save`, async ({ page, browser }) => {
  const context = device === 'desktop' ? page.context() : await browser.newContext({ locale: 'zh-CN',
    ...devices[device === 'pwa' ? 'iPhone 13' : device], serviceWorkers: device === 'pwa' ? 'allow' : 'block' });
  if (device !== 'desktop') page = await context.newPage();
  await dismissApprovalNotices(page);
  const f = await productionIssuesFixture(undefined, { staged: true });
  try {
    f.db.prepare('UPDATE products SET stock=20, inventory_value_cents=2000 WHERE id=?').run(f.semi);
    f.db.prepare("UPDATE products SET name='半成品' WHERE id=?").run(f.other);
    let order = f.ok(await f.complete(f.order, 8, [['1.1', 24]], { path: '1' }));
    const supplement = await f.supplement(order, [[f.semi, 5], [f.other, 2]]);
    order = await f.confirm(supplement.doc);
    const stockPath = `@stock:root:${f.semi}`, otherPath = `@stock:root:${f.other}`;
    order = f.ok(await f.complete(order, 7, [['1', 12], [otherPath, 1], [stockPath, 6]]));
    const semiCode = order.nodes.find(node => node.path === '1').barcode;
    const otherCode = order.items.find(item => item.product_id === f.other).barcode;
    const [name, value] = f.cookie.split('=');
    await context.addCookies([{ name, value, url: f.base }]);
    await page.goto(`${f.base}/#production?order=${order.id}`);
    if (device === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.locator('.registration-record-summary').click();
    await page.getByRole('button', { name: '调整本次用料', exact: true }).click();
    const editor = page.getByRole('region', { name: '调整本次用料', exact: true });
    const semi = editor.getByRole('region', { name: `半成品 · ${semiCode}`, exact: true });
    const other = editor.getByRole('region', { name: `半成品 · ${otherCode}`, exact: true });
    await expect(semi.locator('dt')).toHaveText(['仓库余量', '本单自制可用', '本单已领可用']);
    await expect(semi.locator('dd')).toHaveText(['15 kg', '8 kg', '5 kg']);
    await expect(other.locator('dd')).toHaveText(['998 kg', '—', '2 kg']);
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const balances = await semi.locator('.registration-input-balances').boundingBox();
    const heading = await semi.locator('strong').boundingBox();
    if (device === 'desktop') expect(balances.x).toBeGreaterThan(heading.x);
    else expect(balances.y).toBeGreaterThan(heading.y);
    for (const [source, next] of [['本单自制', '8'], ['仓库领用', '5']]) {
      await expect(semi.locator('.registration-input-source').filter({ hasText: new RegExp(`^${source}`) })).toBeVisible();
      await semi.getByLabel(new RegExp(`本次用量.*${source}`)).fill(next);
      await semi.getByLabel(new RegExp(`差异原因.*${source}`)).fill('核对实际用量');
    }
    await editor.getByRole('button', { name: '保存用料', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const [registration] = (await f.get()).operation_registrations;
    expect(registration.editable_inputs.map(({ path, quantity }) => [path, quantity])).toEqual([['1', 8], [otherPath, 1], [stockPath, 5]]);
  } finally {
    if (device !== 'desktop') await context.close();
    await f.close();
  }
});

test('settling a semi-finished registration updates the next record without reloading', async ({ page }) => {
  await dismissApprovalNotices(page);
  const f = await productionIssuesFixture(undefined, { staged: true });
  try {
    let order = f.ok(await f.complete(f.order, 24, [['1.1', 72]], { path: '1' }));
    order = f.ok(await f.complete(order, 12, [['1', 24]]));
    order = f.ok(await f.complete(order, 25, [['1.1', 75]], { path: '1' }));
    order = f.ok(await f.cancel(order, order.operation_registrations[0]));
    const added = await f.supplement(order, [[f.raw, 12]]);
    order = await f.confirm(added.doc);
    const [name, value] = f.cookie.split('=');
    await page.context().addCookies([{ name, value, url: f.base }]);
    await page.goto(`${f.base}/#production?order=${order.id}`);
    const section = page.getByRole('region', { name: '登记与待处理问题' });
    const heading = section.getByRole('heading');
    const rows = section.locator('.registration-record');
    const summaries = rows.locator('summary.registration-record-summary');
    const settle = row => row.getByRole('button', { name: '核对并结算', exact: true });
    const shortage = section.locator(':scope > p.bom-hint').filter({ hasText: '半成品 · 还缺 24 kg' });
    await expect(heading).toContainText('未核对/总数 2/3');
    await expect(summaries.locator('strong')).toHaveText(['半成品 · 24 kg', '成品 · 12 kg', '半成品 · 25 kg']);
    await expect(summaries.locator('.registration-record-number')).toHaveText(['1', '2', '3']);
    await expect(section.locator('.registration-record[open]')).toHaveCount(0);
    await expect(shortage).toBeVisible();
    await summaries.nth(0).click();
    await settle(rows.nth(0)).click();
    await expect(heading).toContainText('未核对/总数 1/3');
    await expect(summaries.nth(0)).toContainText('成品 · 12 kg');
    await expect(shortage).toHaveCount(0);
    await summaries.nth(0).click();
    await settle(rows.nth(0)).click();
    await expect(heading).toContainText('未核对/总数 0/3');
    expect((await f.get()).completed_quantity).toBe(12);
  } finally {
    await f.close();
  }
});

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
    await page.getByRole('button',{name:'结束生产',exact:true}).first().click();
    const finishDialog=page.getByRole('dialog',{name:'完结生产流水线',exact:true});
    await expect(finishDialog).toBeVisible();
    await finishDialog.getByRole('button',{name:'2. 单据与在制',exact:true}).click();
    await expect(finishDialog).toContainText('原料 · 还缺 4 kg');
    await expect(finishDialog.getByRole('button',{name:'下一步：处理结余',exact:true})).toBeDisabled();
    await finishDialog.getByRole('button',{name:'取消',exact:true}).click();
    await expect(finishDialog).toHaveCount(0);
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
  await dismissApprovalNotices(page);
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
    await finish.click();
    await confirmFinishPipeline(page);
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
    for(let i=0;i<16;i++) order=f.ok(await f.complete(order,12,[[f.raw,24],[f.other,12]]));
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
    const cards=drawer.locator('.registration-record');
    await expect(cards).toHaveCount(16);
    const firstMain=await cards.first().locator('summary.registration-record-summary').boundingBox();
    expect(firstMain.width).toBeGreaterThanOrEqual(device==='desktop'?260:200);
    await cards.last().scrollIntoViewIfNeeded();
    const scrolledTop=await body.evaluate(el=>el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);
    const lastBox=await cards.last().boundingBox();
    const viewportHeight=await page.evaluate(()=>window.innerHeight);
    expect(lastBox.y+lastBox.height).toBeLessThanOrEqual(viewportHeight+2);
  } finally { await f.close(); }
});
