import { test, expect, devices } from '@playwright/test';
import { createRequire } from 'node:module';
const ExcelJS=createRequire(import.meta.url)('exceljs');

test.beforeAll(async({request})=>{
  const response=await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}});
  expect([201,409]).toContain(response.status());
});
for(const chartType of ['line','pie'])for(const device of [null,'Pixel 7','iPhone 13'])test(`${device||'desktop'} ${chartType} AI recommends and saves a quality chart after confirmation`,async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3199',serviceWorkers:device==='iPhone 13'?'allow':'block',...(device?devices[device]:{viewport:{width:1440,height:1000}})});
  try{
    await context.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}});
    const warehouse=await(await context.request.post('/api/warehouses',{data:{name:`AI品质-${device}-${Date.now()}`}})).json();
    const headers={'X-Warehouse-ID':String(warehouse.id)};
    const config=await(await context.request.get('/api/settings/r2-backup')).json();
    expect((await context.request.put('/api/settings/r2-backup',{data:{...config,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'key',secret_key:'secret'}})).ok()).toBe(true);
    expect((await context.request.put('/api/settings/ai',{data:{enabled:true,writes:true,base_url:'https://ai.77erp.test/v1',model:'test-model',secret:'browser-test-key',daily_limit:100}})).ok()).toBe(true);
    const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('品质');sheet.getCell('A1').value='2026-10-20';sheet.getCell('B1').value=95;
    const file={name:'品质.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await excel.xlsx.writeBuffer())};
    const definition={sheetName:'品质',fields:[{id:'date',name:'检验日期',customKey:true,valueRegion:'A1',type:'date'},{id:'rate',name:'合格率',customKey:true,valueRegion:'B1',type:'number',unit:'%'}]};
    const created=await context.request.post('/api/quality/templates',{headers,multipart:{file,name:'AI图表模板',definition:JSON.stringify(definition),request_id:`template-${Date.now()}`}});expect(created.ok()).toBe(true);
    const draft=await created.json(),published=await context.request.post(`/api/quality/templates/${draft.id}/publish`,{headers,data:{version:draft.version}}),template=await published.json();
    const acceptance=await context.request.post('/api/quality/acceptances',{headers,multipart:{file,name:'AI真实数据',template_id:String(template.id),revision_id:String(template.published_revision),request_id:`acceptance-${Date.now()}`}});expect(acceptance.ok()).toBe(true);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`/?warehouse_id=${warehouse.id}`);
    if(device==='iPhone 13')await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    if(device)await page.getByRole('button',{name:'更多',exact:true}).click();
    await page.getByRole('button',{name:'AI 助手',exact:true}).click();
    await page.getByRole('button',{name:'推荐品质图表',exact:true}).click();
    await expect(page.getByLabel('你的需求')).toHaveValue(/推荐可以生成哪些品质图表/);
    await page.getByLabel('你的需求').fill('推荐图表参数：'+JSON.stringify({revision_id:template.published_revision}));
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.locator('.ai-markdown')).toContainText('当前有 1 张验收单，可生成：合格率趋势');
    await expect(page.locator('.ai-action')).toHaveCount(0);
    const chart={revision_id:template.published_revision,name:'每日合格率趋势',config:{schemaVersion:1,kind:'ordinary',chartType,objectId:null,x:{fieldId:'date'},dateField:{fieldId:'date'},bucket:'day',groupBy:null,metric:{aggregation:'avg',value:{fieldId:'rate'}}}};
    await page.getByLabel('你的需求').fill('图表参数：'+JSON.stringify(chart));await page.getByRole('button',{name:'发送',exact:true}).click();
    const action=page.locator('.ai-action');await expect(action).toContainText('品质图表配置预览 · 待确认');
    await expect(action).toContainText('AI图表模板 v1');await expect(action).toContainText('平均值 · 合格率');
    await expect(action.getByRole('img',{name:'每日合格率趋势'})).toBeVisible();
    await action.getByRole('button',{name:'全屏查看',exact:true}).click();
    const fullscreen=page.locator('.chart-fullscreen-modal');await expect(fullscreen.getByRole('img',{name:'每日合格率趋势',exact:true})).toBeVisible();
    for(const viewport of [device?devices[device].viewport:{width:1440,height:1000},...(device?[{width:844,height:390}]:[])]){
      await page.setViewportSize(viewport);
      await expect.poll(async()=>{const box=await fullscreen.boundingBox();return Math.max(Math.abs(box.x),Math.abs(box.y),Math.abs(box.width-viewport.width),Math.abs(box.height-viewport.height));}).toBeLessThan(2);
      await expect(fullscreen.getByRole('button',{name:'退出全屏',exact:true})).toBeInViewport();
      expect(await fullscreen.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    }
    await page.screenshot({path:`output/ui-preview/chart-fullscreen-${device||'desktop'}.png`});
    if(device)await page.goBack();
    else await fullscreen.getByRole('button',{name:'退出全屏',exact:true}).click();
    await expect(fullscreen).toHaveCount(0);await expect(action.getByRole('button',{name:'确认保存图表',exact:true})).toBeVisible();
    if(device)await page.setViewportSize(devices[device].viewport);
    expect((await(await context.request.get('/api/quality/charts',{headers})).json()).total).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await action.getByRole('button',{name:'确认保存图表',exact:true}).click();
    await expect(action).toHaveCount(0);
    await expect(page.locator('.ai-action-result')).toContainText('已保存图表“每日合格率趋势”');
    await page.getByRole('button',{name:'查看图表与详情',exact:true}).click();
    await expect(action.getByRole('img',{name:'每日合格率趋势',exact:true})).toBeVisible();
    await action.getByRole('button',{name:'全屏查看',exact:true}).click();
    await expect(fullscreen.getByRole('img',{name:'每日合格率趋势',exact:true})).toBeVisible();
    await fullscreen.getByRole('button',{name:'退出全屏',exact:true}).click();
    await page.getByRole('button',{name:'收起详情',exact:true}).click();
    await page.getByLabel('你的需求').fill('保存好了，继续聊天');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByLabel('你的需求')).toBeEnabled();
    await expect(page.locator('.ai-turn').last()).toContainText('保存好了，继续聊天');
    await expect(page.locator('.ai-turn').nth(1).locator('.ai-action-result')).toContainText('已保存图表');
    await expect(page.locator('.ai-turn').last().locator('.ai-action-result')).toHaveCount(0);
    const charts=await(await context.request.get('/api/quality/charts',{headers})).json();expect(charts.total).toBe(1);expect(charts.charts[0].config.chartType).toBe(chartType);
    await page.reload();if(device)await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'AI 助手',exact:true}).click();
    await expect(page.locator('.ai-action-result')).toContainText('已保存图表“每日合格率趋势”');
    await expect(page.locator('.ai-turn').nth(1).locator('.ai-action-result')).toHaveCount(1);
    await expect(page.locator('.ai-turn').last()).toContainText('保存好了，继续聊天');
    await expect(page.locator('.ai-action')).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await context.close();}
});
