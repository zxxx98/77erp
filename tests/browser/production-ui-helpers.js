import { expect } from '@playwright/test';

export async function productionAction(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await button.click();
}

export async function adjustUsage(page) {
  const details = page.locator('.registration-details');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
}

// Registration and closing are now separate user actions. Keep the accounting
// regressions exercising both through the visible UI, including rejected batches.
export async function confirmFinishPipeline(page, { returnMaterials = false, confirmReturn = false } = {}) {
  const dialog = page.getByRole('dialog', { name: '完结生产流水线', exact: true });
  await expect(dialog).toBeVisible();
  const nextDocuments = dialog.getByRole('button', { name: '下一步：单据与在制', exact: true });
  if (await nextDocuments.isVisible()) {
    await nextDocuments.click();
  }
  const nextBalances = dialog.getByRole('button', { name: '下一步：处理结余', exact: true });
  if (await nextBalances.isVisible()) {
    await nextBalances.click();
  }
  const nextConfirm = dialog.getByRole('button', { name: '下一步：完结预览', exact: true });
  if (await nextConfirm.isVisible()) {
    const returnToggle = dialog.getByRole('checkbox', { name: '完结时同时生成剩余材料退料申请单', exact: true });
    if (await returnToggle.count()) {
      if (!returnMaterials && await returnToggle.isChecked()) await returnToggle.uncheck();
      if (returnMaterials && !(await returnToggle.isChecked())) await returnToggle.check();
      if (returnMaterials && confirmReturn) {
        const confirmToggle = dialog.getByRole('checkbox', { name: '同时确认退料入库（直接恢复仓库库存）', exact: true });
        if (await confirmToggle.count() && !(await confirmToggle.isChecked())) await confirmToggle.check();
      }
    }
    await nextConfirm.click();
  }
  await dialog.getByRole('button', { name: '确认完结生产单', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function submitProductionBatch(page, finish = false) {
  const drawer = page.getByRole('dialog', { name: '生产登记', exact: true });
  const inDrawer = await drawer.isVisible();
  await page.getByRole('button', { name: '提交登记', exact: true }).click();
  await expect.poll(async () => await page.getByRole('alert').count() > 0 || await page.getByRole('status').filter({ hasText: '已登记' }).count() > 0).toBe(true);
  if (await page.getByRole('alert').count()) return;
  if (inDrawer) await expect(drawer).toHaveCount(0);
  else await page.getByRole('button', { name: '返回单据详情', exact: true }).click();
  if (finish) {
    await productionAction(page, '结束生产');
    await confirmFinishPipeline(page);
  }
}
