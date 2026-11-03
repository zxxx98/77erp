import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

const graph = { nodes:[{id:'cut',name:'下料',note:'按图下料',x:24,y:24,unit_price:2.5,currency:'CNY'},{id:'out',name:'检验',note:'',x:244,y:24}],edges:[{from:'cut',to:'out'}] };
async function fixture(page,{worker=false,multi=false,repeated=false}={}) {
  const {app,db}=createApp(':memory:');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body)=>{const response=await page.request.post(`${base}/api${path}`,{data:{request_id:randomUUID(),schema_version:2,stage_schema_version:1,operation_schema_version:1,...body}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;};
  await post('/auth/setup',{username:'routeadmin',password:'Route-test-123'});await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const route=await post('/process-routes',{name:'凳架路线',note:'测试路线',enabled:1,graph});
  const product=(name,routed=false)=>post('/products',{name,barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,default_route_id:routed?route.id:null});
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
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'android' ? 'Pixel 7' : 'iPhone 13']), serviceWorkers: mode === 'ios-pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const order = await f.get();
    await f.post(`/production-orders/${order.id}/operations/report`, {version:order.version,path:'',operation_node_id:'cut',quantity:4,multiplier:1.5,note:'工资测试'});
    await page.goto(`${f.base}/#process-routes`);
    if (mode === 'ios-pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', {name:'编辑路线',exact:true}).click();
    await expect(page.getByRole('spinbutton', {name:'计件单价',exact:true})).toHaveValue('2.5');
    await page.getByRole('spinbutton', {name:'计件单价',exact:true}).fill('3.25');
    await page.getByRole('combobox', {name:'工资币种',exact:true}).click();
    await page.getByRole('option', {name:'VND',exact:true}).click();
    await page.getByRole('button', {name:'保存路线',exact:true}).click();
    await expect(page.getByRole('button', {name:'编辑路线',exact:true})).toBeVisible();
    const saved = await (await page.request.get(`${f.base}/api/process-routes/${f.route.id}`)).json();
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
    await expect(page.locator('.payroll-table')).toContainText('6 件');
    await page.getByRole('button', {name:'上月',exact:true}).click();
    await expect(page.getByText('该成员在所选日期内暂无报工记录。',{exact:true})).toBeVisible();
    await page.getByRole('button', {name:'本月',exact:true}).click();
    await expect(page.locator('.payroll-totals')).toContainText('CNY 15.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path:`/tmp/77erp-payroll-${mode}.png`,fullPage:true});
    expect(errors).toEqual([]);
  } finally { await context.close(); await f.close(); }
});
