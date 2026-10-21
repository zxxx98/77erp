import { test, expect, devices } from '@playwright/test';
import { expectCompleteChartAxis } from './chart-axis-helpers.js';

test.beforeAll(async({request})=>{
  expect([201,409]).toContain((await request.post('/api/auth/setup',{data:{username:'admin',password:'Test-admin-123'}})).status());
});

for(const device of ['Pixel 7','iPhone 13'])test(`${device} full chart labels wrap and remain readable in both orientations`,async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3199',...devices[device],serviceWorkers:device==='iPhone 13'?'allow':'block'});
  try{
    await context.request.post('/api/auth/login',{data:{username:'admin',password:'Test-admin-123'}});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const labels=Array.from({length:20},(_,i)=>`供应商${i+1}的来料抽样检验合格率完整统计结果`);
    await page.route('**/api/ai/chat',route=>{
      const type=route.request().postDataJSON().message==='查看柱状图'?'bar':'line';
      return route.fulfill({json:{conversation_id:'axis-preview',messages:[{role:'user',content:'查看完整图表'},{role:'assistant',content:'请查看图表预览。'}],actions:[{
        id:'axis-preview',turn_index:0,kind:'quality_chart',expires_at:Date.now()+900000,
        preview:{name:'完整坐标预览',warehouse_name:'当前仓库',template_name:'检验数据',revision:1,config:{kind:'ordinary',chartType:type,metric:{aggregation:'avg'},bucket:'day'},object_label:'每个工作表一条记录',x_label:'供应商',metric_label:'合格率',group_label:'不分组',date_label:'不启用',x_type:'string',unit:'%',rows:labels.map((x,i)=>({x,series:'rate',seriesLabel:'合格率',value:i-5,count:1}))},
      }]}});
    });
    await page.goto('/');
    if(device==='iPhone 13')await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'AI 助手',exact:true}).click();
    for(const type of ['line','bar']){
      if(type==='bar')await page.getByRole('button',{name:'开始新对话',exact:true}).click();
      await page.getByLabel('你的需求').fill(type==='bar'?'查看柱状图':'查看折线图');await page.getByRole('button',{name:'发送',exact:true}).click();
      await page.locator('.ai-action').getByRole('button',{name:'全屏查看',exact:true}).click();
      const fullscreen=page.locator('.chart-fullscreen-modal'),svg=fullscreen.getByRole('img',{name:'完整坐标预览',exact:true});
      for(const viewport of [devices[device].viewport,{width:844,height:390}]){
        await page.setViewportSize(viewport);
        const layout=await expectCompleteChartAxis(svg,labels);expect(layout.labels.every(label=>label.lines>1)).toBe(true);
        const scroll=fullscreen.locator('.quality-chart-scroll');
        await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.scrollTop=el.scrollHeight;});
        await expect(svg.locator('.quality-chart-x-label').last()).toBeInViewport();
        expect(await fullscreen.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      }
      await page.screenshot({path:`output/ui-preview/chart-wrapped-labels-${device}-${type}.png`});
      await fullscreen.getByRole('button',{name:'退出全屏',exact:true}).click();await page.setViewportSize(devices[device].viewport);
    }
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
