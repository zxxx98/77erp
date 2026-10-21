import { expect } from '@playwright/test';
export async function selectDataSheets(page,names,{skipBindings=true}={}) {
  await expect(page.getByRole('checkbox',{name:`解析工作表 ${names[0]}`,exact:true})).toBeVisible();
  const boxes=page.locator('.quality-data-sheets input[type=checkbox]');
  for(let i=0;i<await boxes.count();i++){
    const box=boxes.nth(i),name=(await box.getAttribute('aria-label')).replace('解析工作表 ','');
    if((await box.isChecked())!==names.includes(name))await box.setChecked(names.includes(name));
  }
  await expect(page.getByRole('region',{name:`物料绑定 ${names[0]}`,exact:true})).toBeVisible();
  if(skipBindings)for(const name of names)await page.getByRole('checkbox',{name:`绑定物料 ${name}`,exact:true}).uncheck();
}

export async function openSheetResults(page,name) {
  await page.getByRole('region',{name:`物料绑定 ${name}`,exact:true}).getByRole('button',{name:'查看解析结果',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'工作表解析结果',exact:true})).toBeVisible();
}
export async function closeSheetResults(page) {
  await page.getByRole('dialog',{name:'工作表解析结果',exact:true}).getByRole('button',{name:'关闭弹窗',exact:true}).click();
}
