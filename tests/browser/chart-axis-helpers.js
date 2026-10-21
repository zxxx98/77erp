import { expect } from '@playwright/test';

export async function expectCompleteChartAxis(svg, values) {
  await expect(svg.locator('.quality-chart-x-label')).toHaveCount(values.length);
  const inspect=()=>svg.evaluate(element=>{
    const bounds=element.viewBox.baseVal;
    const labels=[...element.querySelectorAll('.quality-chart-x-label')].map(label=>{
      const b=label.getBBox();
      return {text:[...label.querySelectorAll('tspan')].map(line=>line.textContent).join(''),lines:label.querySelectorAll('tspan').length,box:{x:b.x,y:b.y,width:b.width,height:b.height}};
    });
    const clipped=[...element.querySelectorAll('text')].some(label=>{const b=label.getBBox();return b.x<0||b.y<0||b.x+b.width>bounds.width||b.y+b.height>bounds.height;});
    const overlaps=labels.some((a,i)=>labels.slice(i+1).some(b=>Math.min(a.box.x+a.box.width,b.box.x+b.box.width)>Math.max(a.box.x,b.box.x)+1&&Math.min(a.box.y+a.box.height,b.box.y+b.box.height)>Math.max(a.box.y,b.box.y)+1));
    return {labels,clipped,overlaps};
  });
  await expect.poll(async()=>{const layout=await inspect();return layout.clipped||layout.overlaps;}).toBe(false);
  const layout=await inspect();
  expect(layout.labels.map(label=>label.text)).toEqual(values.map(String));
  return layout;
}
