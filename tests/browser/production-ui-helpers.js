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
export async function submitProductionBatch(page, finish = false) {
  const drawer = page.getByRole('dialog', { name: '生产登记', exact: true });
  const inDrawer = await drawer.isVisible();
  await page.getByRole('button', { name: '提交登记', exact: true }).click();
  await expect.poll(async () => await page.getByRole('alert').count() > 0 || await page.getByRole('status').filter({ hasText: '已登记' }).count() > 0).toBe(true);
  if (await page.getByRole('alert').count()) return;
  if (inDrawer) await expect(drawer).toHaveCount(0);
  else await page.getByRole('button', { name: '返回单据详情', exact: true }).click();
  if (finish) {
    page.once('dialog', dialog => dialog.accept());
    await productionAction(page, '结束生产');
  }
}
