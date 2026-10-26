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

for (const mode of ['desktop', 'iPhone 13', 'Pixel 7', 'pwa']) test(`${mode} confirms route deletion, rejects references and stale versions, and returns from an empty last page`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const unused = await f.post('/process-routes', { name: '待删除路线', note: '', enabled: 1, graph });
    await page.goto(`${f.base}/#process-routes`);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    const card = name => page.locator('.process-route-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card(unused.name)).toBeVisible();
    page.once('dialog', async dialog => { expect(dialog.message()).toContain(`「${unused.name}」(#${unused.id})`); await dialog.dismiss(); });
    await card(unused.name).getByRole('button', { name: '删除路线', exact: true }).click();
    expect(f.db.prepare('SELECT id FROM process_routes WHERE id=?').get(unused.id)).toBeTruthy();
    page.once('dialog', dialog => dialog.accept());
    await card(f.route.name).getByRole('button', { name: '删除路线', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('已被物料引用');
    // Change the version after the list loads, without refreshing the browser.
    f.db.prepare("UPDATE process_routes SET note='其他用户修改' WHERE id=?").run(unused.id);
    page.once('dialog', dialog => dialog.accept());
    await card(unused.name).getByRole('button', { name: '删除路线', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('工艺路线已变化');
    await page.reload();
    page.once('dialog', dialog => dialog.accept());
    await card(unused.name).getByRole('button', { name: '删除路线', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '工艺路线已删除' })).toBeVisible();
    await expect(card(unused.name)).toHaveCount(0);
    expect(f.db.prepare('SELECT id FROM process_routes WHERE id=?').get(unused.id)).toBeUndefined();
    // Leave exactly one item on the second page, then delete it.
    for (let index = 0; index < 30; index++) await f.post('/process-routes', { name: `分页路线 ${index}`, note: '', enabled: 1, graph });
    const finalRoute = f.db.prepare("SELECT * FROM process_routes WHERE name='分页路线 0'").get();
    f.db.prepare("UPDATE process_routes SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(finalRoute.id);
    await page.reload();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.process-route-card')).toHaveCount(1);
    await expect(card(finalRoute.name)).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await card(finalRoute.name).getByRole('button', { name: '删除路线', exact: true }).click();
    await expect(page.locator('.process-route-card')).toHaveCount(30);
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await f.close(); await context.close(); }
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
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
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

for (const mode of ['desktop', 'iPhone 13', 'Pixel 7', 'pwa']) test(`${mode} combined overview connects BOM layers and returns from production operations`, async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage(), f = await fixture(page, { multi: true }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${f.base}/#bom`);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    const bom = page.locator('.bom-list-item').filter({ hasText: '凳子配方' });
    await expect(bom.getByRole('button', { name: '工艺流程图', exact: true })).toBeVisible();
    await bom.getByRole('button', { name: '工艺流程图', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工艺流程图', exact: true })).toBeVisible();
    const overview = page.getByTestId('process-overview');
    await expect(overview).toBeVisible();
    await overview.getByRole('button', { name: '流程图', exact: true }).click();
    await expect(overview.getByTestId('overview-canvas')).toBeVisible();
    await expect(overview.locator('[data-layer-path=""]')).toContainText('凳子');
    await expect(overview.locator('[data-layer-path="1"]')).toContainText('凳架');
    await expect(overview.locator('path[data-supply-from="1"][data-supply-to=""]')).toHaveCount(1);
    await expect(overview.locator('path[data-supply-from="1"][data-supply-to=""]')).toHaveAttribute('stroke-dasharray', /.+/);
    const rootLayer = overview.locator('[data-layer-path=""]');
    await rootLayer.getByRole('button', { name: '凳子 · 下料', exact: true }).click();
    await expect(overview.getByRole('complementary', { name: '工序详情', exact: true })).toContainText('按图下料');
    await overview.getByRole('button', { name: '关闭', exact: true }).click();
    const beforeZoom = await overview.locator('.overview-scale').textContent();
    await overview.getByRole('button', { name: '放大流程图', exact: true }).click();
    await expect(overview.locator('.overview-scale')).not.toHaveText(beforeZoom);
    await overview.getByRole('button', { name: '适应画布', exact: true }).click();
    await rootLayer.getByRole('button', { name: '收起工序', exact: true }).click();
    await expect(rootLayer.getByRole('button', { name: '凳子 · 下料', exact: true })).toHaveCount(0);
    await rootLayer.getByRole('button', { name: '展开工序', exact: true }).click();
    await expect(rootLayer.getByRole('button', { name: '凳子 · 下料', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('bom-combined-graph.png'), fullPage: true });
    await overview.getByRole('button', { name: '分层列表', exact: true }).click();
    await expect(overview.locator('[data-layer-path="1"]')).toContainText('凳架路线');
    await overview.getByRole('textbox', { name: '搜索物料、BOM 或路径', exact: true }).fill('凳架');
    await expect(overview.locator('[data-layer-path="1"]')).toBeVisible();
    await overview.getByRole('textbox', { name: '搜索物料、BOM 或路径', exact: true }).fill('');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('bom-combined-overview.png'), fullPage: true });
    await page.getByRole('button', { name: '返回BOM', exact: true }).click();
    await bom.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存BOM', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '工艺流程图', exact: true }).click();
    await expect(overview).toBeVisible();
    await page.getByRole('button', { name: '返回BOM', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存BOM', exact: true })).toBeVisible();
    await page.getByLabel('BOM 名称', { exact: true }).fill('凳子配方已修改');
    await expect(page.getByRole('button', { name: '工艺流程图', exact: true })).toBeDisabled();
    await expect(page.getByText('请先保存 BOM，再查看已保存的工艺流程。', { exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.goto(`${f.base}/#production`);
    await f.post(`/process-routes/${f.route.id}`, { ...f.route, name: '凳架新路线', graph });
    await f.post(`/production-orders/${f.draft.id}/operations/report`, { version: (await f.get()).version, path: '1', operation_node_id: 'cut', quantity: 4, note: '' });
    await page.getByRole('button', { name: `查看生产单 ${f.draft.number}`, exact: true }).click();
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工艺总览', exact: true })).toBeVisible();
    await expect(overview).toBeVisible();
    await overview.getByRole('button', { name: '分层列表', exact: true }).click();
    const childLayer = overview.locator('[data-layer-path="1"]');
    await expect(childLayer).toContainText('凳架路线');
    await expect(overview).not.toContainText('凳架新路线');
    await expect(childLayer.getByRole('button', { name: '凳架 · 下料', exact: true })).toContainText('4 件');
    await expect(childLayer.getByRole('button', { name: '凳架 · 检验', exact: true })).toContainText('0 件');
    await expect(childLayer.locator('.overview-layer-quantity')).toContainText('0 / 10 件');
    await childLayer.getByRole('button', { name: '查看工序进度', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工序进度与登记', exact: true })).toBeVisible();
    await expect(page.getByText(`${f.draft.number} · 凳架 · 凳架路线`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回生产单', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生产单详情', exact: true })).toBeVisible();
    await expect(overview).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('production-combined-overview.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await f.close(); await context.close(); }
});

for (const mode of ['desktop', 'iPhone 13']) test(`${mode} nested overview expands levels and navigates a branch without configured route`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode]), serviceWorkers: 'block' });
  const page = await context.newPage(), f = await fixture(page, { multi: true });
  try {
    const source = await f.post('/products', { name: '原钢料', barcode: randomUUID(), category: '生产', unit: '件', cost: 1, price: 2, threshold: 0 });
    const leaf = await f.post('/boms', { name: '钢管配方', product_id: f.raw.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items: [{ product_id: source.id, quantity: 1, unit: '件', note: '' }] });
    await f.post(`/boms/${f.child.id}`, { name: f.child.name, version: f.child.version, product_id: f.half.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items: [{ product_id: f.raw.id, quantity: 2, unit: '件', note: '', usage_mode: 'explode', child_bom_id: leaf.id }] });
    await page.goto(`${f.base}/#bom`);
    await page.locator('.bom-list-item').filter({ hasText: '凳子配方' }).getByRole('button', { name: '工艺流程图', exact: true }).click();
    const overview = page.getByTestId('process-overview');
    await expect(overview).toBeVisible();
    await overview.getByRole('button', { name: '流程图', exact: true }).click();
    await expect(overview.locator('[data-layer-path=""]')).toBeVisible();
    await expect(overview.locator('[data-layer-path="1"]')).toBeVisible();
    await expect(overview.locator('[data-layer-path="1.1"]')).toHaveCount(0);
    await overview.getByRole('button', { name: '展开下一级', exact: true }).click();
    await expect(overview.locator('[data-layer-path="1.1"]')).toContainText('未配置工艺路线');
    await expect(overview.locator('path[data-supply-from="1.1"][data-supply-to="1"]')).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath('nested-combined-graph.png'), fullPage: true });
    await overview.getByRole('button', { name: '收起深层分支', exact: true }).click();
    await expect(overview.locator('[data-layer-path="1.1"]')).toHaveCount(0);
    await overview.locator('[data-layer-path="1"]').getByRole('button', { name: '进入分支（1 层）', exact: true }).click();
    await expect(overview.locator('[data-layer-path=""]')).toHaveCount(0);
    await expect(overview.locator('[data-layer-path="1"]')).toBeVisible();
    await expect(overview.locator('[data-layer-path="1.1"]')).toBeVisible();
    await overview.getByRole('button', { name: '返回上层', exact: true }).click();
    await expect(overview.locator('[data-layer-path=""]')).toBeVisible();
    await overview.getByRole('textbox', { name: '搜索物料、BOM 或路径', exact: true }).fill('钢管');
    await expect(overview.locator('[data-layer-path="1.1"]')).toBeVisible();
    await expect(overview.locator('[data-layer-path="1"]')).toBeVisible();
    await expect(overview.locator('[data-layer-path=""]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.close(); await context.close(); }
});
