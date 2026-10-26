import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { productionRegistrationUrl } from '../../shared/production-link.js';

const graph = { nodes:[{id:'cut',name:'下料',note:'按图下料',x:24,y:24},{id:'out',name:'检验',note:'',x:244,y:24}],edges:[{from:'cut',to:'out'}] };
async function fixture(page,{worker=false,multi=false}={}) {
  const {app,db}=createApp(':memory:');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body)=>{const response=await page.request.post(`${base}/api${path}`,{data:{request_id:randomUUID(),schema_version:2,stage_schema_version:1,operation_schema_version:1,...body}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result;};
  await post('/auth/setup',{username:'routeadmin',password:'Route-test-123'});await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  const route=await post('/process-routes',{name:'凳架路线',note:'测试路线',enabled:1,graph});
  const product=(name,routed=false)=>post('/products',{name,barcode:randomUUID(),category:'生产',unit:'件',cost:1,price:2,threshold:0,default_route_id:routed?route.id:null});
  const raw=await product('钢管'),half=await product('凳架',true),output=multi?await product('凳子',true):half;
  db.prepare('UPDATE products SET stock=1000,inventory_value_cents=100000 WHERE id=?').run(raw.id);
  const bom=(product_id,name,items)=>post('/boms',{name,product_id,base_quantity:1,base_unit:'件',note:'',enabled:1,items});
  const child=await bom(half.id,'凳架配方',[{product_id:raw.id,quantity:2,unit:'件',note:''}]);
  const root=multi?await bom(output.id,'凳子配方',[{product_id:half.id,quantity:1,unit:'件',note:'',usage_mode:'explode',child_bom_id:child.id}]):child;
  let group=null;
  if(worker){group=await post('/production-groups',{name:'工艺生产组',description:''});const position=await post('/positions',{name:'工序登记员',access_mode:'production_only',permissions:['production_register']});await post('/users',{username:'routeworker',password:'Worker-test-123',name:'李四',role:'employee',position_id:position.id,production_group_id:group.id});}
  const plan=await post('/production-orders/prepare',{bom_id:root.id,bom_version:root.version,planned_quantity:10});
  const draft=await post('/production-orders',{bom_id:root.id,bom_version:root.version,planned_quantity:10,structure_token:plan.structure_token,note:'',production_group_id:group?.id});
  const started=await post(`/production-orders/${draft.id}/start`,{version:draft.version}),doc=started.material_documents[0];await post(`/production-material-documents/${doc.id}/confirm`,{version:doc.version});
  const sourceId=db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  const link=productionRegistrationUrl({origin:base,warehouseId:1,orderId:draft.id,number:draft.number,sourceId});
  const get=async()=> (await page.request.get(`${base}/api/production-orders/${draft.id}`)).json();
  return {base,db,post,route,draft,link,raw,half,output,child,root,get,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
}

for(const device of ['desktop','iPhone 13']) test(`${device} creates and edits a connected route using graph or predecessor list`,async({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',...(device==='desktop'?{}:devices[device]),serviceWorkers:'block'});const page=await context.newPage(),f=await fixture(page),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(`${f.base}/#process-routes`);await expect(page.getByRole('heading',{name:'工艺路线',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'新建路线',exact:true}).click();await page.getByLabel('路线名称',{exact:true}).fill('新凳架工艺');
    await page.getByLabel('工序名称',{exact:true}).fill('切割');
    await page.getByRole('button',{name:'添加工序',exact:true}).click();await page.getByLabel('工序名称',{exact:true}).fill('焊接');
    await page.getByRole('checkbox',{name:'切割',exact:true}).check();await page.getByRole('button',{name:'自动排列',exact:true}).click();
    if(device==='desktop'){
      const box=await page.locator('.process-node').filter({hasText:'焊接'}).boundingBox();await page.mouse.move(box.x+30,box.y+25);await page.mouse.down();await page.mouse.move(box.x+50,box.y+65,{steps:5});await page.mouse.up();
    }
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('route-editor.png'),fullPage:true});
    await page.getByRole('button',{name:'保存路线',exact:true}).click();await expect(page.getByText('工艺路线已保存',{exact:true})).toBeVisible();
    const route=f.db.prepare("SELECT * FROM process_routes WHERE name='新凳架工艺'").get(),saved=JSON.parse(route.graph);expect(saved.nodes.map(n=>n.name)).toEqual(['切割','焊接']);expect(saved.edges).toHaveLength(1);if(device==='desktop')expect(saved.nodes[1].y).toBeGreaterThan(24);
    expect(errors).toEqual([]);
  }finally{await f.close();await context.close();}
});

for(const mode of ['desktop','mobile','pwa']) test(`${mode} scans to operations and registers intermediate work then final output`,async({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',...(mode==='desktop'?{}:devices['iPhone 13']),serviceWorkers:mode==='pwa'?'allow':'block'});const page=await context.newPage(),f=await fixture(page),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(f.link);if(mode==='pwa')await page.evaluate(()=>navigator.serviceWorker.ready);
    await expect(page.getByRole('heading',{name:'工序进度与登记',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'登记产出与耗料 检验',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'登记工序 下料',exact:true}).click();await page.getByLabel('本批完成数量',{exact:true}).fill('4');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'登记工序',exact:true}).click();await expect(page.getByRole('heading',{name:'生产单详情',exact:true})).toBeVisible();
    let order=await f.get();expect(order.completed_quantity).toBeNull();expect(order.receipt_documents).toHaveLength(0);expect(order.items[0].available_quantity).toBe(20);
    await page.getByRole('button',{name:'登记',exact:true}).click();await page.getByRole('button',{name:'登记产出与耗料 检验',exact:true}).click();await page.getByLabel('合格成品数量',{exact:true}).fill('4');
    await expect(page.getByRole('combobox',{name:'作业员工',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'按本批产量带出耗料',exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'本批登记并继续生产',exact:true}).click();await expect(page.getByRole('heading',{name:'生产单详情',exact:true})).toBeVisible();
    order=await f.get();expect(order.completed_quantity).toBe(4);expect(order.items[0].available_quantity).toBe(12);expect(order.receipt_documents).toHaveLength(1);expect(order.operation_routes[0].reports).toHaveLength(2);
    await page.getByRole('button',{name:'查看工序进度',exact:true}).click();await expect(page.getByText('工序登记记录',{exact:true})).toBeVisible();await expect(page.getByText('登记人: routeadmin',{exact:false}).first()).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('operation-progress.png'),fullPage:true});expect(errors).toEqual([]);
  }finally{await f.close();await context.close();}
});

test('mobile production-only worker scans to a half-finished route and outputs into the stage ledger',async({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',...devices['iPhone 13'],serviceWorkers:'block'});const page=await context.newPage(),f=await fixture(page,{worker:true,multi:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await f.post('/auth/login',{username:'routeworker',password:'Worker-test-123'});await page.goto(f.link);await page.getByRole('button',{name:'登记 凳架',exact:true}).click();await expect(page.getByRole('heading',{name:'工序进度与登记',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'登记工序 下料',exact:true}).click();await page.getByLabel('本批完成数量',{exact:true}).fill('3');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'登记工序',exact:true}).click();
    await expect(page.getByRole('heading',{name:'生产单详情',exact:true})).toBeVisible();await page.getByRole('button',{name:'登记',exact:true}).click();await page.getByRole('button',{name:'登记 凳架',exact:true}).click();await page.getByRole('button',{name:'登记产出与耗料 检验',exact:true}).click();
    await page.getByLabel('本批合格数量',{exact:true}).fill('3');await page.getByRole('button',{name:'按本批产量带出耗料',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'登记本批半成品',exact:true}).click();await expect(page.getByRole('heading',{name:'生产单详情',exact:true})).toBeVisible();
    const order=await f.get();expect(order.completed_quantity).toBeNull();expect(order.stages.find(s=>s.path==='1').available_quantity).toBe(3);expect(order.receipt_documents).toHaveLength(0);expect(order.operation_routes.find(r=>r.path==='1').reports[0].worker_name).toBe('李四');expect(JSON.stringify(order)).not.toMatch(/"(?:[^"\s]*cost_cents|stock)"\s*:/);expect(errors).toEqual([]);
  }finally{await f.close();await context.close();}
});

for(const device of ['desktop','iPhone 13']) test(`${device} binds a material default and selects a BOM override`,async({browser})=>{
  const context=await browser.newContext({locale:'zh-CN',...(device==='desktop'?{}:devices[device]),serviceWorkers:'block'});const page=await context.newPage(),f=await fixture(page),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    const special=await f.post('/process-routes',{name:'特殊检验路线',note:'',enabled:1,graph:{nodes:[{id:'special',name:'特殊检验',note:'',x:24,y:24}],edges:[]}});
    await page.goto(`${f.base}/#products`);
    const row=page.locator(device==='desktop'?'.product-table tbody tr':'.mw-product-list .mw-product-row').filter({hasText:'凳架'});
    if(device==='desktop')await row.getByRole('button',{name:'编辑',exact:true}).click();else{await row.getByRole('button',{name:'凳架，库存 0 件',exact:true}).click();await page.getByRole('button',{name:'编辑物料',exact:true}).click();}
    await page.getByRole('combobox',{name:'默认工艺路线',exact:true}).click();await page.getByText('特殊检验路线',{exact:true}).filter({visible:true}).last().click();await page.getByRole('button',{name:'保存物料',exact:true}).click();
    await expect.poll(()=>f.db.prepare('SELECT default_route_id FROM products WHERE id=?').get(f.half.id).default_route_id).toBe(special.id);
    await page.goto(`${f.base}/#bom`);const bom=page.locator('.bom-list-item').filter({hasText:'凳架配方'});
    await bom.getByRole('button',{name:'编辑',exact:true}).click();
    await page.getByRole('combobox',{name:'工艺路线选择',exact:true}).click();await page.getByText('凳架路线',{exact:true}).filter({visible:true}).last().click();await page.getByRole('button',{name:'保存BOM',exact:true}).click();
    await expect.poll(()=>f.db.prepare('SELECT route_override_id FROM boms WHERE id=?').get(f.root.id).route_override_id).toBe(f.route.id);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  }finally{await f.close();await context.close();}
});
