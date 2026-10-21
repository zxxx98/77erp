import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { expectCompleteChartAxis } from './chart-axis-helpers.js';
const bytes=await readFile('tests/fixtures/quality-template.xlsx');
const definition={sheetName:'Sheet1',fields:[
  {id:'date',name:'检验日期',type:'date',labelRegion:'A4',valueRegion:'B4'},
  {id:'rate',name:'合格率',type:'number',unit:'%',labelRegion:'A5',valueRegion:'B5'},
  {id:'name',name:'供应商',type:'string',labelRegion:'A11',valueRegion:'B11'},
]};
test.beforeAll(async({request})=>{expect([201,409]).toContain((await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}})).status());});
test.beforeEach(async({page})=>{
  expect((await page.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}})).ok()).toBe(true);
  const c=await(await page.request.get('/api/settings/r2-backup')).json();
  expect((await page.request.put('/api/settings/r2-backup',{data:{...c,account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret',excel_prefix:'excel',enabled:false}})).ok()).toBe(true);
});
async function choose(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
async function fixture(page,suffix){
  const templateName=`图表模板${suffix}`,productName=`品质图表物料${suffix}`;
  const product=await(await page.request.post('/api/products',{data:{name:productName,barcode:`CHART-${randomUUID().slice(0,8)}`,category:'图表验证',unit:'件',cost:1,price:2,threshold:0}})).json();
  expect(product.id,JSON.stringify(product)).toBeTruthy();
  const body=await page.request.post('/api/quality/templates',{multipart:{file:{name:'图表模板.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes},name:templateName,definition:JSON.stringify(definition),request_id:randomUUID()}});
  expect(body.ok()).toBe(true);let template=await body.json();template=await(await page.request.post(`/api/quality/templates/${template.id}/publish`,{data:{version:template.version}})).json();
  const zip=unzipSync(bytes);let sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);
  for(const [cell,text] of [['B4','2026-10-20'],['B5','95%']])sheet=sheet.replace(new RegExp(`<c r="${cell}"[^>]*>[\\s\\S]*?<\\/c>`),`<c r="${cell}" t="inlineStr"><is><t>${text}</t></is></c>`);
  zip['xl/worksheets/sheet1.xml']=strToU8(sheet);const file={name:'95合格率.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(zipSync(zip))};
  const data={file,template_id:String(template.id),revision_id:String(template.published_revision),sheet_names:JSON.stringify(['Sheet1'])};
  const p=await page.request.post('/api/quality/acceptances/preview',{multipart:data});expect(p.ok()).toBe(true);const preview=await p.json();
  const saved=await page.request.post('/api/quality/acceptances',{multipart:{...data,name:`品质数据${suffix}`,note:'',preview_token:preview.preview_token,request_id:randomUUID(),bindings:JSON.stringify([{sheetName:'Sheet1',mode:'manual',product_id:product.id}])}});expect(saved.ok(),await saved.text()).toBe(true);
  return {template,templateName,productName,product,acceptance:await saved.json()};
}
async function charts(page){await page.goto('/#quality');await page.getByRole('button',{name:'图表',exact:true}).click();}
test('configure a normal chart from a numeric rate field, preview saved data, trace sources and edit categories',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page,'普通');
  await charts(page);await page.getByRole('button',{name:'新建图表',exact:true}).click();
  await page.getByRole('textbox',{name:'图表名称',exact:true}).fill('直接读取合格率');await choose(page,'图表数据模板',`${f.templateName} · v1`);
  await expect(page.getByRole('combobox',{name:'数值字段',exact:true})).toHaveValue('合格率（%）');
  await expect(page.getByRole('combobox',{name:'横轴字段',exact:true})).toHaveValue('检验日期');
  await page.getByRole('button',{name:'生成预览',exact:true}).click();await expect(page.getByRole('img',{name:'直接读取合格率预览',exact:true})).toBeVisible();
  const fullscreenButton=page.getByRole('button',{name:'全屏查看',exact:true});
  await fullscreenButton.click();const fullscreen=page.locator('.chart-fullscreen-modal');
  await expect(fullscreen.getByRole('img',{name:'直接读取合格率预览',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(fullscreen).toHaveCount(0);await expect(fullscreenButton).toBeFocused();
  await page.locator('.quality-chart-table summary').click();await expect(page.locator('.quality-chart-table tbody')).toContainText('95%');
  await page.screenshot({path:'output/ui-preview/quality-chart-editor.png',fullPage:true});
  await page.getByRole('button',{name:'保存图表',exact:true}).click();const row=page.getByRole('row').filter({hasText:'直接读取合格率'});await expect(row).toBeVisible();
  await row.getByRole('button',{name:'查看图表',exact:true}).click();const modal=page.getByRole('dialog',{name:'直接读取合格率',exact:true});
  await modal.getByRole('button',{name:'全屏查看',exact:true}).click();
  await fullscreen.getByRole('button',{name:/查看来源 2026-10-20/}).click();const source=page.getByRole('dialog',{name:'图表数据来源',exact:true});await expect(source).toContainText(f.acceptance.number);
  await source.getByRole('button',{name:'查看验收单',exact:true}).click();await expect(source.getByRole('heading',{name:'品质数据普通',exact:true})).toBeVisible();await source.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await expect(fullscreen).toBeVisible();await fullscreen.getByRole('button',{name:'退出全屏',exact:true}).click();await expect(modal).toBeVisible();
  await choose(page,'图表数据范围','单张验收单');await choose(page,'图表验收单',`品质数据普通 · ${f.acceptance.number}`);await expect(modal.getByRole('img')).toBeVisible();
  await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();await row.getByRole('button',{name:'编辑图表',exact:true}).click();
  await choose(page,'横轴字段','供应商');await choose(page,'图表样式','柱状图');await choose(page,'日期筛选字段','不启用日期筛选');await page.getByRole('button',{name:'保存图表',exact:true}).click();
  await row.getByRole('button',{name:'查看图表',exact:true}).click();await expect(modal.getByRole('img')).toBeVisible();await expect(modal.getByLabel('直接读取合格率 开始日期')).toHaveCount(0);expect(errors).toEqual([]);
});
test('material chart rules have a temporary preview product and appear on matching material details even for empty dates',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page,'物料');
  const unused=await(await page.request.post('/api/products',{data:{name:'图表无数据物料',barcode:'CHART-EMPTY',category:'图表验证',unit:'件',cost:1,price:2,threshold:0}})).json();expect(unused.id).toBeTruthy();
  await charts(page);await page.getByRole('button',{name:'新建图表',exact:true}).click();await page.getByRole('textbox',{name:'图表名称',exact:true}).fill('物料合格率趋势');
  await choose(page,'图表分类','物料图表');await choose(page,'图表数据模板',`${f.templateName} · v1`);await expect(page.getByRole('button',{name:'生成预览',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'选择预览物料',exact:true}).click();const picker=page.getByRole('dialog',{name:'选择预览物料',exact:true});await picker.getByRole('textbox',{name:'搜索绑定物料'}).fill(f.productName);await picker.getByRole('button',{name:'选择此物料',exact:true}).click();
  await page.getByRole('button',{name:'生成预览',exact:true}).click();await expect(page.getByRole('img',{name:'物料合格率趋势预览',exact:true})).toBeVisible();
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/quality/charts')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存图表',exact:true}).click();const chart=await(await saved).json();expect(chart.config.product_id).toBeUndefined();expect(chart.product_id).toBeUndefined();
  await page.goto('/#products');await page.getByRole('textbox',{name:'筛选物料'}).fill(f.productName);await page.getByRole('button',{name:`查看 ${f.productName} 物料详情`,exact:true}).click();
  const detail=page.getByRole('dialog',{name:'物料详情',exact:true});await detail.getByRole('tab',{name:'品质图表',exact:true}).click();await detail.getByRole('button',{name:/物料合格率趋势/}).click();await expect(detail.getByRole('img',{name:'物料合格率趋势',exact:true})).toBeVisible();
  await detail.getByLabel('物料合格率趋势 开始日期').fill('2027-01-01');await expect(detail).toContainText('该范围暂无可用数据');await expect(detail.getByRole('button',{name:/物料合格率趋势/})).toBeVisible();
  await detail.getByRole('button',{name:'全部时间',exact:true}).click();await expect(detail.getByRole('img')).toBeVisible();await expect(detail.getByText('正在读取图表…',{exact:true})).toHaveCount(0);await page.screenshot({path:'output/ui-preview/material-quality-charts.png',fullPage:true});
  await detail.getByRole('button',{name:'全屏查看',exact:true}).click();
  const fullscreen=page.locator('.chart-fullscreen-modal');await expect(fullscreen.getByRole('img',{name:'物料合格率趋势',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(fullscreen).toHaveCount(0);await expect(detail).toBeVisible();
  await detail.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('textbox',{name:'筛选物料'}).fill('图表无数据物料');await page.getByRole('button',{name:'查看 图表无数据物料 物料详情',exact:true}).click();await detail.getByRole('tab',{name:'品质图表',exact:true}).click();await expect(detail).toContainText('暂无品质图表');expect(errors).toEqual([]);
});

test('dashboard trend opens at viewport size and returns to the selected period',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'近 30 天',exact:true}).click();
  await page.getByRole('button',{name:'全屏查看',exact:true}).click();const fullscreen=page.locator('.chart-fullscreen-modal');
  await expect(fullscreen.getByRole('img',{name:'最近 30 天采购与销售金额趋势',exact:true})).toBeVisible();
  await expect(fullscreen.locator('.trend-chart-x-label')).toHaveCount(30);
  const box=await fullscreen.boundingBox();expect(box.x).toBe(0);expect(box.y).toBe(0);expect(box.width).toBe(page.viewportSize().width);expect(box.height).toBe(page.viewportSize().height);
  await fullscreen.getByRole('button',{name:'退出全屏',exact:true}).click();await expect(fullscreen).toHaveCount(0);
  await expect(page.getByRole('img',{name:'最近 30 天采购与销售金额趋势',exact:true})).toBeVisible();
});

test('fullscreen line and bar charts keep every long axis label, wrap it and allow scrolling to the last point',async({page})=>{
  const f=await fixture(page,'完整坐标');
  const rows=Array.from({length:24},(_,i)=>({x:`第${i+1}号供应商的来料抽样检验合格率统计结果`,series:'rate',seriesLabel:'合格率',value:i-8,count:1}));
  for(const type of ['line','bar']){
    const name=`完整坐标${type}`;
    const response=await page.request.post('/api/quality/charts',{data:{name,template_id:f.template.id,revision_id:f.template.published_revision,request_id:randomUUID(),config:{schemaVersion:1,kind:'ordinary',chartType:type,objectId:null,x:{fieldId:'name'},metric:{aggregation:'avg',value:{fieldId:'rate'}}}}});
    expect(response.ok()).toBe(true);const chart=await response.json();
    await page.route(`**/api/quality/charts/${chart.id}/data*`,route=>route.fulfill({json:{rows,xType:'string',unit:'%',stats:{sheets:24,records:24,excluded:0,incompatibleSheets:0}}}));
    if(type==='bar')await page.reload();
    await charts(page);await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'查看图表',exact:true}).click();
    const viewer=page.getByRole('dialog',{name,exact:true});
    await expect(viewer.locator('.quality-chart-x-label').first().locator('tspan')).not.toHaveCount(1);
    await viewer.getByRole('button',{name:'全屏查看',exact:true}).click();
    const fullscreen=page.locator('.chart-fullscreen-modal'),svg=fullscreen.getByRole('img',{name,exact:true});
    const layout=await expectCompleteChartAxis(svg,rows.map(row=>row.x));expect(layout.labels.every(label=>label.lines>1)).toBe(true);
    const scroll=fullscreen.locator('.quality-chart-scroll');expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect(svg.locator('.quality-chart-x-label').last()).toBeInViewport();
    await svg.getByRole('button',{name:new RegExp(`查看来源 ${rows.at(-1).x}`)}).click();
    const source=page.getByRole('dialog',{name:'图表数据来源',exact:true});await expect(source).toBeVisible();await source.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await fullscreen.getByRole('button',{name:'退出全屏',exact:true}).click();await viewer.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  }
});

test('close numeric coordinates keep their scale while fullscreen labels use separate rows',async({page})=>{
  const f=await fixture(page,'数值密集坐标');
  const response=await page.request.post('/api/quality/charts',{data:{name:'数值密集坐标',template_id:f.template.id,revision_id:f.template.published_revision,request_id:randomUUID(),config:{schemaVersion:1,kind:'ordinary',chartType:'line',objectId:null,x:{fieldId:'rate'},metric:{aggregation:'count'}}}});
  expect(response.ok()).toBe(true);const chart=await response.json(),values=[0,0.000001,1000000000];
  await page.route(`**/api/quality/charts/${chart.id}/data*`,route=>route.fulfill({json:{rows:values.map((x,i)=>({x,series:'count',seriesLabel:'记录数',value:i+1,count:1})),xType:'number',unit:'',stats:{sheets:3,records:3,excluded:0,incompatibleSheets:0}}}));
  await charts(page);await page.getByRole('row').filter({hasText:'数值密集坐标'}).getByRole('button',{name:'查看图表',exact:true}).click();
  await page.getByRole('button',{name:'全屏查看',exact:true}).click();const svg=page.locator('.chart-fullscreen-modal').getByRole('img',{name:'数值密集坐标',exact:true});
  const layout=await expectCompleteChartAxis(svg,values);expect(layout.labels[1].box.y).toBeGreaterThan(layout.labels[0].box.y+layout.labels[0].box.height);
  const points=await svg.locator('circle').evaluateAll(elements=>elements.map(element=>Number(element.getAttribute('cx'))));
  expect((points[1]-points[0])/(points[2]-points[0])).toBeLessThan(0.000001);await expect(svg.getByRole('button')).toHaveCount(3);
});

test('wide grouped bars stay inside the plot and retain source actions',async({page})=>{
  const f=await fixture(page,'柱组边界');
  const response=await page.request.post('/api/quality/charts',{data:{name:'柱组边界回归',template_id:f.template.id,revision_id:f.template.published_revision,request_id:randomUUID(),config:{schemaVersion:1,kind:'ordinary',chartType:'bar',objectId:null,x:{fieldId:'date'},groupBy:{fieldId:'name'},metric:{aggregation:'avg',value:{fieldId:'rate'}}}}});
  expect(response.ok()).toBe(true);const chart=await response.json();
  const rows=['2026-10-20','2026-10-21'].flatMap(x=>Array.from({length:20},(_,i)=>({x,series:`供应商${i}`,seriesLabel:`供应商${i}`,value:i+1,count:1})));
  await page.route(`**/api/quality/charts/${chart.id}/data*`,route=>route.fulfill({json:{rows,xType:'date',unit:'%',stats:{sheets:40,records:40,excluded:0,incompatibleSheets:0}}}));
  await charts(page);await page.getByRole('row').filter({hasText:'柱组边界回归'}).getByRole('button',{name:'查看图表',exact:true}).click();
  await page.getByRole('button',{name:'全屏查看',exact:true}).click();
  const fullscreen=page.locator('.chart-fullscreen-modal'),svg=fullscreen.getByRole('img',{name:'柱组边界回归',exact:true});await expect(svg.locator('rect')).toHaveCount(40);
  const bounds=await svg.evaluate(element=>({width:element.viewBox.baseVal.width,bars:[...element.querySelectorAll('rect')].map(bar=>({x:bar.x.baseVal.value,width:bar.width.baseVal.value}))}));
  for(const bar of bounds.bars){expect(bar.x).toBeGreaterThanOrEqual(74);expect(bar.x+bar.width).toBeLessThanOrEqual(bounds.width-24);}
  await svg.getByRole('button',{name:'查看来源 2026-10-20 · 供应商0：1%'}).click();
  await expect(page.getByRole('dialog',{name:'图表数据来源',exact:true})).toBeVisible();
});

test('table charts support fullscreen statistics and source drilldown',async({page})=>{
  const f=await fixture(page,'统计表全屏');
  const response=await page.request.post('/api/quality/charts',{data:{name:'全屏统计表',template_id:f.template.id,revision_id:f.template.published_revision,request_id:randomUUID(),config:{schemaVersion:1,kind:'ordinary',chartType:'table',objectId:null,x:{fieldId:'date'},metric:{aggregation:'avg',value:{fieldId:'rate'}}}}});
  expect(response.ok()).toBe(true);await charts(page);
  await page.getByRole('row').filter({hasText:'全屏统计表'}).getByRole('button',{name:'查看图表',exact:true}).click();
  const viewer=page.getByRole('dialog',{name:'全屏统计表',exact:true});await viewer.getByRole('button',{name:'全屏查看',exact:true}).click();
  const fullscreen=page.locator('.chart-fullscreen-modal');await expect(fullscreen.getByRole('table')).toContainText('95%');
  await fullscreen.getByRole('button',{name:'查看来源',exact:true}).click();const source=page.getByRole('dialog',{name:'图表数据来源',exact:true});await expect(source).toContainText(f.acceptance.number);
  await page.keyboard.press('Escape');await expect(source).toHaveCount(0);await expect(fullscreen).toBeVisible();
  await page.keyboard.press('Escape');await expect(fullscreen).toHaveCount(0);await expect(viewer.getByRole('table')).toContainText('95%');
});
