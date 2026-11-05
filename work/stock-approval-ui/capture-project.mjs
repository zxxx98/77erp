import { chromium } from 'playwright';
import { createApp } from '../../server/app.js';
import { randomUUID } from 'node:crypto';
const {app,db}=createApp(':memory:');
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',deviceScaleFactor:1,serviceWorkers:'block'});
const post=async(path,data)=>{const response=await context.request.post(base+'/api'+path,{data:{request_id:randomUUID(),...data}});const body=await response.json();if(!response.ok())throw Error(JSON.stringify(body));return body;};
await post('/auth/setup',{username:'designadmin',password:'Design-admin-123'});
await post('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
const product=await post('/products',{name:'铝合金支架',barcode:'CP-001',unit:'件',category:'成品',cost:0,price:28,threshold:10});
const mat=await post('/products',{name:'铝型材 6063-T5',barcode:'YL-001',unit:'kg',category:'原材料',cost:20,price:25,threshold:20});
db.prepare('UPDATE products SET stock=120,inventory_value_cents=240000 WHERE id=?').run(mat.id);
const bom=await post('/boms',{name:'铝合金支架标准配方',product_id:product.id,base_quantity:1,base_unit:'件',note:'',enabled:1,items:[{product_id:mat.id,quantity:2,unit:'kg',note:''}]});
for(let i=0;i<3;i++){const order=await post('/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:5,note:'订单备料'});await post(`/production-orders/${order.id}/start`,{version:order.version,schema_version:2});}
const page=await context.newPage();
async function setup(page,mobile=false){await page.goto(base+'/#sales');await page.getByRole('tab',{name:/领料.*补料待出库/}).waitFor();await page.getByRole('tab',{name:/领料.*补料待出库/}).click();await page.getByRole('button',{name:/查看并审批/}).first().waitFor();await page.evaluate(()=>{
const tabs=document.querySelector('.order-category-tabs');const original=tabs.querySelector('[role=tab]');const newtab=original.cloneNode(true);newtab.removeAttribute('id');newtab.removeAttribute('aria-controls');newtab.setAttribute('aria-selected','true');newtab.innerHTML='普通出库待审核 <span class="order-category-count">3</span>';tabs.querySelectorAll('[role=tab]').forEach(t=>t.setAttribute('aria-selected','false'));tabs.insertBefore(newtab,tabs.children[1]);
const queue=document.querySelector('.material-queue');queue.querySelector('h2').textContent='普通出库审核'; const desc=queue.querySelector('p'); if(desc)desc.textContent='核对出库单据，审核通过后扣减库存并记账。'; const refresh=queue.querySelector('button'); if(refresh)refresh.textContent='刷新单据'; queue.querySelectorAll('.badge').forEach(b=>b.textContent='待审核');const inp=queue.querySelector('input');if(inp)inp.placeholder='搜索单号、往来单位或物料';
queue.querySelectorAll('.production-approval-row').forEach((row,i)=>{row.querySelector('strong').textContent='CK20261104'+String(18-i).padStart(6,'0');row.querySelector('p').textContent=['华兴制造有限公司 · 铝型材 6063-T5','盛达机电有限公司 · 铝型材 6063-T5','新恒五金有限公司 · 铝型材 6063-T5'][i];row.querySelector('small').textContent=`普通出库 · 1 种物料 · ${['张明','李芳','王磊'][i]} · 2026/11/04 14:${32-i*7}`;});
});}
async function detail(page){await page.getByRole('button',{name:/查看并审批/}).first().click();await page.getByRole('dialog').waitFor();await page.waitForTimeout(600);await page.evaluate(()=>{
const dialog=document.querySelector('[role=dialog]');dialog.querySelector('h2').textContent='出库审核';dialog.querySelector('.modal-header-title p').textContent='CK20261104000018';
const article=dialog.querySelector('.material-document');article.querySelector('.material-document-heading strong').textContent='CK20261104000018';article.querySelector('.material-document-heading p').textContent='普通出库 · 主仓库'; article.querySelectorAll('.badge').forEach(b=>b.textContent='待审核');const direct=[...article.children].filter(x=>x.tagName==='P');direct[0].textContent='往来单位：华兴制造有限公司';direct[1].textContent='提交人：张明 · 2026/11/04 14:32';if(direct[2])direct[2].textContent='备注：11 月订单发货';
const actions=article.querySelector('.material-actions');const buttons=actions.querySelectorAll('button');buttons[0]?.remove();buttons[1].textContent='审核通过';buttons[2].textContent='驳回';
const line=article.querySelector('.material-document-lines li');line.querySelectorAll(':scope > div')[1].innerHTML='<small>出库数量</small><span>10 kg</span>';const progress=line.querySelector('.material-issue-progress');progress.innerHTML='<span>单价 ¥25.00 / kg</span><span>金额 ¥250.00</span>';line.querySelector('.material-issue-input')?.remove();
const msg=document.createElement('p');msg.className='material-muted';msg.textContent='当前库存 120 kg → 审核后 110 kg';article.append(msg);const tip=document.createElement('p');tip.className='material-note';tip.textContent='待审核：库存尚未变动，审核通过后正式出库记账。';article.insertBefore(tip,actions);article.append(actions);
});}
await setup(page);await page.screenshot({path:'/mnt/data/project-stock-approval-desktop-list.png',fullPage:true});await detail(page);await page.screenshot({path:'/mnt/data/project-stock-approval-desktop-detail.png',fullPage:true});
const mobile=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',deviceScaleFactor:2,serviceWorkers:'block',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'});
await mobile.addCookies(await context.cookies());const mp=await mobile.newPage();await setup(mp,true);await mp.waitForTimeout(600);await mp.screenshot({path:'/mnt/data/project-stock-approval-mobile-list.png',fullPage:false,animations:'disabled'});await detail(mp);await mp.waitForTimeout(600);await mp.screenshot({path:'/mnt/data/project-stock-approval-mobile-detail.png',fullPage:false,animations:'disabled'});
console.log('Project UI screenshots saved.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
