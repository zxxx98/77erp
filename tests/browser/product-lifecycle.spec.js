import { test, expect } from '@playwright/test';

test('delist, filter, explicitly choose for clearance, relist, and delete an unused product', async ({ page }) => {
  await page.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
  const created = await page.request.post('/api/products', { data: { name: '生命周期测试物料', barcode: 'BROWSER-LIFE-001', category: '日用百货', unit: '件', cost: 10, price: 20, threshold: 0 } });
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  await page.goto('/#products');
  await page.getByRole('textbox', {name: '筛选物料'}).fill('生命周期测试物料');
  // Cancelling the confirmation leaves the product listed.
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', {name: '停用 生命周期测试物料', exact: true}).click();
  await expect(page.locator('.product-table').getByText('已停用', {exact: true})).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: '停用 生命周期测试物料', exact: true}).click();
  await expect(page.getByText('没有找到物料', {exact: true})).toBeVisible();
  const statusFilter = page.getByRole('group', {name: '物料使用状态'});
  await expect(statusFilter.getByRole('button', {name: '已启用', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await statusFilter.getByRole('button', {name: '已启用', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(statusFilter.getByRole('button', {name: '已启用', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('没有找到物料', {exact: true})).toBeVisible();
  await statusFilter.getByRole('button', {name: '已停用', exact: true}).click();
  await expect(statusFilter.getByRole('button', {name: '已停用', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: '启用 生命周期测试物料', exact: true})).toBeVisible();
  await page.goto('/#sales');
  await page.getByRole('button', {name: '新建出库', exact: true}).click();
  await page.getByRole('textbox', {name: '查找并添加物料'}).fill('生命周期测试物料');
  await expect(page.locator('.picker-results button')).toHaveCount(0);
  await page.getByRole('checkbox', {name: '包含停用物料（用于清库存等操作）'}).check();
  await expect(page.getByRole('button', {name: /生命周期测试物料（已停用）/})).toBeVisible();
  await page.getByRole('button', {name: /生命周期测试物料（已停用）/}).click();
  await expect(page.locator('.form-table').getByText('生命周期测试物料（已停用）', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await page.goto('/#products');
  await page.getByRole('textbox', {name: '筛选物料'}).fill('生命周期测试物料');
  await statusFilter.getByRole('button', {name: '已停用', exact: true}).click();
  await page.getByRole('button', {name: '网格视图'}).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: '启用 生命周期测试物料', exact: true}).click();
  await expect(page.getByText('没有找到物料', {exact: true})).toBeVisible();
  await statusFilter.getByRole('button', {name: '已启用', exact: true}).click();
  await expect(page.getByRole('button', {name: '停用 生命周期测试物料', exact: true})).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: '删除 生命周期测试物料', exact: true}).click();
  await expect(page.getByText('没有找到物料', {exact: true})).toBeVisible();
  expect((await page.request.get(`/api/products/barcode/BROWSER-LIFE-001`)).status()).toBe(404);
  expect((await page.request.post(`/api/products/${id}/status`, {data: {active: 1}})).status()).toBe(404);
});

test('desktop and mobile batch deactivate and delete with cross-page selection, indeterminate state, filter reset, preview, and permission/offline guards', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
  await page.request.post('/api/settings/reset', { data: { confirmation: 'RESET_BUSINESS_DATA' } });

  // Create 10 products to span 2 pages (8 per page on desktop)
  const ids = [];
  for (let i = 1; i <= 10; i++) {
    const res = await page.request.post('/api/products', {
      data: {
        name: `批测物料${String(i).padStart(2, '0')}`,
        barcode: `BATCH-UI-${String(i).padStart(2, '0')}`,
        category: i <= 5 ? '五金' : '电子',
        unit: '件',
        cost: 10,
        price: 20,
        threshold: 0,
      },
    });
    expect(res.status()).toBe(201);
    ids.push((await res.json()).id);
  }
  // Give product 1 stock so it cannot be deleted
  expect((await page.request.post('/api/orders', {
    data: { type: 'in', partner: '测试供应商', items: [{ product_id: ids[0], quantity: 3, price: 10 }] },
  })).status()).toBe(201);
  // Make product 2 already inactive
  expect((await page.request.post(`/api/products/${ids[1]}/status`, { data: { active: 0 } })).status()).toBe(200);

  await page.goto('/#products');
  const statusFilter = page.getByRole('group', { name: '物料使用状态' });
  await statusFilter.getByRole('button', { name: '全部状态', exact: true }).click();

  // Initially batch buttons are disabled
  const batchDeactivateBtn = page.getByRole('button', { name: '批量停用', exact: true });
  const batchDeleteBtn = page.getByRole('button', { name: '批量删除', exact: true });
  await expect(batchDeactivateBtn).toBeDisabled();
  await expect(batchDeleteBtn).toBeDisabled();

  // Select only inactive product 02 -> batch deactivate remains disabled, batch delete enabled
  const selectAllCheckbox = page.getByRole('checkbox', { name: '全选本页物料' });
  await page.getByRole('checkbox', { name: '选择 批测物料02' }).check();
  await expect(page.getByText('已选 1 项')).toBeVisible();
  await expect(batchDeactivateBtn).toBeDisabled();
  await expect(batchDeleteBtn).toBeEnabled();
  expect(await selectAllCheckbox.evaluate(el => el.indeterminate)).toBe(true);

  // Check select-all on page 1 (8 items), then go to page 2 and select product 09
  await selectAllCheckbox.check();
  await expect(page.getByText('已选 8 项')).toBeVisible();
  expect(await selectAllCheckbox.evaluate(el => el.indeterminate)).toBe(false);

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('已选 8 项')).toBeVisible();
  await page.getByRole('checkbox', { name: '选择 批测物料09' }).check();
  await expect(page.getByText('已选 9 项')).toBeVisible();

  // Changing search filter clears selection
  await page.getByRole('textbox', { name: '筛选物料' }).fill('批测物料01');
  await expect(page.getByText(/已选 \d+ 项/)).toHaveCount(0);
  await page.getByRole('button', { name: '清除搜索' }).click();

  // Select 6 items across list & grid view to test "等 N 项" and mixed status batch deactivate
  for (const num of ['01', '02', '03', '04', '05']) {
    await page.getByRole('checkbox', { name: `选择 批测物料${num}` }).check();
  }
  await page.getByRole('button', { name: '网格视图' }).click();
  await page.getByRole('checkbox', { name: '选择 批测物料06' }).check();
  await expect(page.getByText('已选 6 项')).toBeVisible();

  await batchDeactivateBtn.click();
  const deactivateDialog = page.getByRole('dialog', { name: '批量停用物料' });
  await expect(deactivateDialog).toBeVisible();
  await expect(deactivateDialog).toContainText('共 5 项');
  await expect(deactivateDialog).toContainText('另外 1 项已是停用状态，将自动跳过');
  await expect(deactivateDialog).toContainText('仅影响当前仓库');
  await deactivateDialog.getByRole('button', { name: '确认停用' }).click();
  await expect(deactivateDialog).toHaveCount(0);
  await expect(page.getByText(/已选 \d+ 项/)).toHaveCount(0);

  // Switch back to list view, select blocked 01 and deletable 02, 03 for batch delete
  await page.getByRole('button', { name: '列表视图' }).click();
  await page.getByRole('checkbox', { name: '选择 批测物料01' }).check();
  await page.getByRole('checkbox', { name: '选择 批测物料02' }).check();
  await page.getByRole('checkbox', { name: '选择 批测物料03' }).check();
  await batchDeleteBtn.click();

  const deleteDialog = page.getByRole('dialog', { name: '批量删除物料' });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText('可删除 2 项，无法删除 1 项');
  await expect(deleteDialog.getByRole('region', { name: '无法删除的物料' })).toContainText('批测物料01');
  await expect(deleteDialog.getByRole('region', { name: '无法删除的物料' })).toContainText('仍有库存');
  await deleteDialog.getByRole('button', { name: '确认删除 (2)' }).click();

  // Result dialog shows 2 deleted and 1 failed, and keeps failed item 01 selected
  const resultDialog = page.getByRole('dialog', { name: '批量删除结果' });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog).toContainText('成功删除 2 项，失败 1 项');
  await resultDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText('已选 1 项')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '选择 批测物料01' })).toBeChecked();

  // Create read-only employee to verify checkboxes and batch controls are hidden without manage('products')
  expect((await page.request.post('/api/users', {
    data: { username: 'viewer_emp', password: 'Test-staff-123', role: 'employee' },
  })).status()).toBe(201);
  await context.close();

  const empContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const empPage = await empContext.newPage();
  expect((await empPage.request.post('/api/auth/login', {
    data: { username: 'viewer_emp', password: 'Test-staff-123' },
  })).ok()).toBe(true);
  await empPage.goto('/#products');
  await expect(empPage.getByRole('button', { name: '批量停用' })).toHaveCount(0);
  await expect(empPage.getByRole('checkbox', { name: '全选本页物料' })).toHaveCount(0);
  await empContext.close();

  // Mobile Web batch mode, offline guard, and batch operations
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  expect((await mobilePage.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'Test-admin-123' },
  })).ok()).toBe(true);
  await mobilePage.goto('/#products');
  await mobilePage.getByRole('button', { name: '批量', exact: true }).click();
  const batchBar = mobilePage.getByRole('region', { name: '批量操作栏' });
  await expect(batchBar).toBeVisible();

  await mobilePage.getByRole('checkbox', { name: '选择 批测物料07' }).check();
  await mobilePage.getByRole('checkbox', { name: '选择 批测物料08' }).check();
  await expect(batchBar).toContainText('已选 2 项');

  // Offline disables batch actions on mobile
  await mobileContext.setOffline(true);
  await mobilePage.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(batchBar.getByRole('button', { name: '批量停用' })).toBeDisabled();
  await expect(batchBar.getByRole('button', { name: '批量删除' })).toBeDisabled();
  await mobileContext.setOffline(false);
  await mobilePage.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(batchBar.getByRole('button', { name: '批量停用' })).toBeEnabled();
  await expect(batchBar.getByRole('button', { name: '批量删除' })).toBeEnabled();

  await batchBar.getByRole('button', { name: '批量删除' }).click();
  const mobileDeleteDialog = mobilePage.getByRole('dialog', { name: '批量删除物料' });
  await expect(mobileDeleteDialog).toBeVisible();
  await mobileDeleteDialog.getByRole('button', { name: '确认删除 (2)' }).click();
  await expect(mobileDeleteDialog).toHaveCount(0);
  await expect(batchBar).toContainText('已选 0 项');
  await mobileContext.close();
});
