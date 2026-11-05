import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

const graph = { nodes:[{id:'cut',name:'下料',note:'按图下料',x:24,y:24,multiplier:1.5,unit_price:2.5,currency:'CNY'},{id:'out',name:'检验',note:'',x:244,y:24,multiplier:2,unit_price:1,currency:'USD'}],edges:[{from:'cut',to:'out'}] };
async function fixture(page,{worker=false,multi=false,repeated=false}={}) {
  const {app,db}=createApp(':memory:');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body)=>{const response=await page.request.post(`${base}/api${path}`,{data:{request_id:randomUUID(),schema_version:2,stage_schema_version:1,operation_schema_version:1,...body}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;};
  await post('/auth/setup',{username:'routeadmin',password:'Route-test-123'});await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const route=await post('/process-routes',{name:'凳架路线',note:'测试路线',enabled:1,graph});
  const product=(name,routed=false)=>post('/products',{name,barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,production_type:routed?'成品':'原料',default_route_id:routed?route.id:null});
  const raw=await product('钢管'),half=await product('凳架',true),output=multi?await product('凳子',true):half;
  db.prepare('UPDATE products SET stock=1000,inventory_value_cents=100000 WHERE id=?').run(raw.id);
  const bom=(product_id,name,items)=>post('/boms',{name,product_id,base_quantity:1,base_unit:'件',note:'',enabled:1,items});
  const child=await bom(half.id,'凳架配方',[{product_id:raw.id,quantity:2,unit:'件',note:''}]);
  const branches=[];
  if(repeated) for(const name of ['黑芯','白芯']) {
    const branchProduct=await product(name);
    const branch=await bom(branchProduct.id,name+'配方',[{product_id:half.id,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:child.id}]);
    branches.push({product_id:branchProduct.id,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:branch.id});
  }
  const root=repeated?await bom(output.id,'双支配方',branches):multi?await bom(output.id,'凳子配方',[{product_id:half.id,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:child.id}]):child;
  let group=null;
  if(worker){group=await post('/production-groups',{name:'工艺生产组',description:''});const position=await post('/positions',{name:'工序登记员',access_mode:'production_only',permissions:['production_register']});await post('/users',{username:'routeworker',employee_no:'routeworker',password:'Worker-test-123',name:'李四',role:'employee',position_id:position.id,production_group_id:group.id});}
  const plan=await post('/production-orders/prepare',{bom_id:root.id,bom_version:root.version,planned_quantity:10});
  const draft=await post('/production-orders',{bom_id:root.id,bom_version:root.version,planned_quantity:10,structure_token:plan.structure_token,note:'',production_group_id:group?.id});
  const started=await post(`/production-orders/${draft.id}/start`,{version:draft.version}),doc=started.material_documents[0];await post(`/production-material-documents/${doc.id}/confirm`,{version:doc.version});
  const sourceId=db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  const link=productionRegistrationUrl({origin:base,warehouseId:1,orderId:draft.id,number:draft.number,sourceId});
  const get=async()=> (await page.request.get(`${base}/api/production-orders/${draft.id}`)).json();
  return {base,db,post,route,draft,link,raw,half,output,child,root,get,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}

for (const mode of ['desktop', 'android', 'ios-pwa']) test(`${mode} configures operation pay and reviews member wages`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ...(mode === 'desktop' ? {} : devices[mode === 'android' ? 'Pixel 7' : 'iPhone 13']), serviceWorkers: mode === 'ios-pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    let order = await f.get();
    order = await f.post(`/production-orders/${order.id}/operations/report`, {version:order.version,path:'',operation_node_id:'cut',quantity:4,note:'工资测试'});
    await f.post(`/production-orders/${order.id}/complete`, {version:order.version,path:'',operation_node_id:'out',completed_quantity:4,items:[{product_id:f.raw.id,quantity:8}],scraps:[],finish_order:false,note:''});
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(new Date());
    const yearMonth = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
    f.db.prepare("UPDATE production_operation_reports SET created_at=? WHERE node_id='cut'").run(`${yearMonth}-01T02:00:00.000Z`);
    f.db.prepare("UPDATE production_operation_reports SET created_at=? WHERE node_id='out'").run(`${yearMonth}-02T02:00:00.000Z`);
    await page.goto(`${f.base}/#process-routes`);
    if (mode === 'ios-pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', {name:'编辑路线',exact:true}).click();
    await expect(page.getByRole('spinbutton', {name:'工序倍率',exact:true})).toHaveValue('1.5');
    await page.getByRole('spinbutton', {name:'工序倍率',exact:true}).fill('1.25');
    await expect(page.getByRole('spinbutton', {name:'计件单价',exact:true})).toHaveValue('2.5');
    await page.getByRole('spinbutton', {name:'计件单价',exact:true}).fill('3.25');
    await page.getByRole('combobox', {name:'工资币种',exact:true}).click();
    await page.getByRole('option', {name:'VND',exact:true}).click();
    await page.getByRole('button', {name:'保存路线',exact:true}).click();
    await expect(page.getByRole('button', {name:'编辑路线',exact:true})).toBeVisible();
    const saved = await (await page.request.get(`${f.base}/api/process-routes/${f.route.id}`)).json();
    expect(saved.graph.nodes[0].multiplier).toBe(1.25);
    expect(saved.graph.nodes[0].unit_price).toBe(3.25);
    expect(saved.graph.nodes[0].currency).toBe('VND');
    if (mode === 'desktop') await page.getByRole('link', {name:'工资统计',exact:true}).click();
    else {
      await page.getByText('更多',{exact:true}).click();
      await page.getByRole('button', {name:'工资统计',exact:true}).click();
    }
    await expect(page.getByRole('heading', {name:'工资统计',exact:true})).toBeVisible();
    await page.getByRole('combobox', {name:'成员',exact:true}).click();
    await page.getByRole('option', {name:/routeadmin/}).click();
    await expect(page.locator('.payroll-totals')).toContainText('CNY 15.00');
    await expect(page.locator('.payroll-reports')).toContainText('4 件 × 1.5 × CNY 2.5');
    await expect(page.locator('.payroll-reports')).toContainText(order.number);
    await expect(page.getByRole('heading', {name:'工序工资汇总',exact:true})).toHaveCount(0);
    for (const name of ['本月','上月','刷新统计']) await expect(page.getByRole('button', {name,exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading', {name:'每日工资',exact:true})).toBeVisible();
    await page.getByRole('combobox', {name:'图表币种',exact:true}).click();
    await page.getByRole('option', {name:'CNY',exact:true}).click();
    await page.getByRole('button', {name:`${yearMonth}-01 · CNY 15.00 · 1 条计薪记录`,exact:true}).click();
    await expect(page.locator('.payroll-chart-selection')).toHaveText(`${yearMonth}-01 · CNY 15.00 · 1 条计薪记录`);
    await page.getByRole('combobox', {name:'图表币种',exact:true}).click();
    await page.getByRole('option', {name:'USD',exact:true}).click();
    await expect(page.locator('.payroll-chart-selection')).toHaveText(`${yearMonth}-02 · USD 8.00 · 1 条计薪记录`);
    const end = await page.getByLabel('结束日期',{exact:true}).inputValue();
    await page.getByLabel('开始日期',{exact:true}).fill(`${yearMonth}-03`);
    await expect(page.getByText('该成员在所选日期内暂无报工记录。',{exact:true})).toBeVisible();
    await page.getByLabel('开始日期',{exact:true}).fill(`${yearMonth}-01`);
    await expect(page.locator('.payroll-totals')).toContainText('CNY 15.00');
    await expect(page.getByLabel('结束日期',{exact:true})).toHaveValue(end);
    await page.getByRole('tab', {name:'按生产单查看',exact:true}).click();
    await page.getByRole('searchbox', {name:'搜索生产单',exact:true}).fill(order.number);
    await expect(page.locator('.payroll-order-card')).toContainText(order.number);
    await page.getByRole('button', {name:'查看工资',exact:true}).click();
    await expect(page.getByRole('heading', {name:'各成员工资汇总',exact:true})).toBeVisible();
    const chart = page.getByRole('region', {name:'各成员工资汇总',exact:true});
    await expect(chart.getByRole('button', {name:'routeadmin · CNY 15.00',exact:true})).toBeVisible();
    await expect(chart.getByRole('button', {name:'routeadmin · USD 8.00',exact:true})).toBeVisible();
    await expect(page.getByRole('button', {name:'仅看此成员明细',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button', {name:'按成员查看',exact:true})).toHaveCount(0);
    await expect(page.locator('.payroll-reports')).not.toContainText(order.number);
    await expect(page.locator('.payroll-reports')).not.toContainText('· 凳架');
    const bar = chart.getByRole('button', {name:'routeadmin · CNY 15.00',exact:true});
    await bar.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('routeadmin');
    await expect(dialog).toContainText('4 件 × 1.5 × CNY 2.5');
    await expect(dialog).toContainText('CNY 15.00');
    await expect(dialog).toContainText('USD 8.00');
    await page.screenshot({path:`/tmp/77erp-payroll-worker-${mode}.png`,fullPage:true});
    await dialog.getByRole('button', {name:'关闭弹窗',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path:`/tmp/77erp-payroll-${mode}.png`,fullPage:true});
    await page.getByRole('link', {name:`查看生产单 ${order.number}`,exact:true}).first().click();
    await expect(page).toHaveURL(new RegExp(`#production\\?order=${order.id}$`));
    await expect(page.getByRole('tab', {name:'概览',exact:true})).toBeVisible();
    await expect(page.locator('.production-page')).toContainText(order.number);
    await page.reload();
    await expect(page.getByRole('tab', {name:'概览',exact:true})).toBeVisible();
    await expect(page.locator('.production-page')).toContainText(order.number);
    await page.getByRole('button', {name:'返回生产单',exact:true}).click();
    await expect(page).toHaveURL(/#production$/);
    await expect(page.getByRole('button', {name:`查看生产单 ${order.number}`,exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); await f.close(); }
});

test('member bars rank each currency and open zero, unpriced and historical member details', async ({ page }) => {
  const f = await fixture(page);
  try {
    const worker = (worker_id, worker_name, currencies, unpriced_count = 0) => ({worker_id, worker_name, currencies, unpriced_count, active_count:1, void_count:0, operations:[]});
    await page.route('**/api/payroll/production-order?*', async route => {
      const response = await route.fetch(), result = await response.json();
      result.workers = [
        worker(20, '较低工资', [{currency:'CNY',amount_cents:1000},{currency:'USD',amount_cents:5000}]),
        worker(21, '较高工资', [{currency:'CNY',amount_cents:3000},{currency:'USD',amount_cents:2000}]),
        worker(22, '零工资', [{currency:'CNY',amount_cents:0}]),
        worker(null, '历史成员的长名字'.repeat(4), [], 1),
      ];
      await route.fulfill({response,json:result});
    });
    await page.goto(`${f.base}/#payroll`);
    await page.getByRole('tab', {name:'按生产单查看',exact:true}).click();
    await page.getByRole('button', {name:'查看工资',exact:true}).click();
    const chart = page.getByRole('region', {name:'各成员工资汇总',exact:true});
    await expect(chart.getByRole('group', {name:'CNY',exact:true}).getByRole('button')).toHaveText(['较高工资CNY 30.00','较低工资CNY 10.00','零工资CNY 0.00']);
    await expect(chart.getByRole('group', {name:'USD',exact:true}).getByRole('button')).toHaveText(['较低工资USD 50.00','较高工资USD 20.00']);
    const widths = await chart.getByRole('group', {name:'CNY',exact:true}).locator('.payroll-worker-bar-fill').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    expect(widths[0] / widths[1]).toBeCloseTo(3, 1);
    expect(widths[2]).toBe(0);
    const zero = chart.getByRole('button', {name:'零工资 · CNY 0.00',exact:true});
    await zero.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('零工资');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(zero).toBeFocused();
    await page.setViewportSize({width:360,height:800});
    await chart.getByRole('button', {name:/历史成员/}).click();
    await expect(page.getByRole('dialog')).toContainText('未设单价');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await f.close(); }
});
