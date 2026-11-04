import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../server/app.js';
import {browserPosition} from './position-helpers.js';

for(const device of ['desktop','mobile','pwa']) test(`${device} stock approval uses existing tabs and drawer, posts only after review`,async({page},testInfo)=>{
  if(device!=='desktop') {
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(pwa=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'});if(pwa){const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{...original(q),matches:true,addEventListener(){},removeEventListener(){}}:original(q);}},device==='pwa');
  }
  const {app,db}=createApp(':memory:');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{const r=await page.request.post(base+'/api'+path,{data:{request_id:randomUUID(),...data}});const value=await r.json();expect(r.ok(),JSON.stringify(value)).toBe(true);return value;};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await post('/auth/setup',{username:'stockadmin',password:'Test-admin-123'});await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
    const product=await post('/products',{name:'审核测试铝型材',barcode:'APPROVE-E2E',category:'原材料',unit:'kg',cost:20,price:25,threshold:0});
    db.prepare('UPDATE products SET stock=120,inventory_value_cents=240000 WHERE id=?').run(product.id);
    const created=await post('/orders',{type:'out',partner:'华兴制造有限公司',items:[{product_id:product.id,quantity:10,price:25}]});expect(created.status).toBe('pending');
    await page.goto(base+'/#sales');
    await page.getByRole('tab',{name:/普通出库待审核.*1/}).click();
    const queue=page.getByRole('region',{name:'普通出入库审核'});await expect(queue).toContainText(created.number);
    await queue.getByRole('button',{name:'查看并审批',exact:true}).click();
    const detail=page.getByRole('dialog');await expect(detail).toContainText('当前库存');await expect(detail).toContainText('120');await expect(detail).toContainText('110');
    await expect(detail).toHaveClass(/production-approval-detail/);
    await page.screenshot({path:testInfo.outputPath('approval-detail.png'),animations:'disabled'});
    expect(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock).toBe(120);
    if(device!=='desktop'){await page.goBack();await expect(detail).toHaveCount(0);await queue.getByRole('button',{name:'查看并审批',exact:true}).click();await expect(detail).toBeVisible();}
    page.once('dialog',dialog=>dialog.accept());await detail.getByRole('button',{name:'审核通过',exact:true}).click();
    await expect(detail).toHaveCount(0);await expect(page.getByRole('tab',{name:/普通出库待审核.*0/})).toBeVisible();
    expect(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock).toBe(110);
    // Direction-only user can submit but never approve; approval-only user has a usable page without basic_view.
    const position=await browserPosition(page.request,['stock_approve'],base);await post('/users',{position_id:position,username:'reviewer',employee_no:'reviewer',password:'Test-staff-123'});
    const incoming=await post('/orders',{type:'in',partner:'供应商',items:[{product_id:product.id,quantity:5,price:20}]});
    await post('/auth/login',{username:'reviewer',password:'Test-staff-123'});await page.goto(base+'/#purchases');await page.reload();
    await expect(page.getByRole('tab',{name:/普通入库待审核.*1/})).toHaveAttribute('aria-selected','true');
    await page.getByRole('region',{name:'普通出入库审核'}).getByRole('button',{name:'查看并审批',exact:true}).click();
    await expect(detail).toContainText(incoming.number);await expect(detail).not.toContainText('成本');
    await detail.getByRole('button',{name:'驳回',exact:true}).click();await detail.getByLabel('操作原因',{exact:true}).fill('数量需要核对');await detail.getByRole('button',{name:'确认操作',exact:true}).click();await expect(detail).toHaveCount(0);
    expect(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock).toBe(110);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
