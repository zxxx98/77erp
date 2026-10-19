import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.beforeAll(async ({ request }) => {
  await request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
});
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
});

async function product(request, index = 0) {
  const tag = randomUUID().slice(0, 8);
  const body = { name: `抽屉测试物料-${index}-${tag}`, barcode: `DRAWER-${tag}`, category: '抽屉测试', unit: '件', cost: 10, price: 20, threshold: 5 };
  const response = await request.post('/api/products', { data: body });
  expect(response.status()).toBe(201);
  return { ...body, ...(await response.json()) };
}

async function bounds(page, dialog, width) {
  await expect.poll(async () => {
    const box = await dialog.boundingBox(), viewport = page.viewportSize();
    return box && Math.abs(box.x + box.width - viewport.width) < 1 && box.y === 0 && box.width === width && box.height === viewport.height;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('product drawer keeps actions visible, protects edits and restores page interaction', async ({ page }) => {
  await page.goto('/#products');
  const trigger = page.getByRole('button', { name: '新增物料', exact: true }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '新增物料', exact: true });
  await bounds(page, dialog, 680);
  await expect(dialog.getByRole('textbox', { name: /物料名称/ })).toBeFocused();
  await expect(page.locator('.main-shell')).toHaveJSProperty('inert', true);
  const save = dialog.getByRole('button', { name: '保存物料', exact: true });
  const header = dialog.getByRole('heading', { name: '新增物料', exact: true });
  const headerY = (await header.boundingBox()).y;
  const saveY = (await save.boundingBox()).y;
  await dialog.getByRole('spinbutton', { name: /安全库存/ }).scrollIntoViewIfNeeded();
  expect((await header.boundingBox()).y).toBe(headerY);
  expect((await save.boundingBox()).y).toBe(saveY);
  await save.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭弹窗', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  // The portalled select stays usable and consumes its own Escape key.
  const unit = dialog.getByRole('combobox').last();
  await unit.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.mouse.click(12, 12);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /物料名称/ }).fill('待保存内容');
  page.once('dialog', async confirmation => {
    expect(confirmation.message()).toBe('物料信息尚未保存，确定放弃修改并关闭？');
    await confirmation.dismiss();
  });
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('textbox', { name: /物料名称/ })).toHaveValue('待保存内容');
  for (const viewport of [{ width: 1280, height: 800 }, { width: 900, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await bounds(page, dialog, viewport.width < 768 ? viewport.width : 680);
    const box = await save.boundingBox();
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.screenshot({ path: 'output/ui-preview/desktop-drawer-narrow.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'output/ui-preview/desktop-drawer-product.png' });
  page.once('dialog', confirmation => confirmation.accept());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.main-shell')).toHaveJSProperty('inert', false);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  // Opening and closing an untouched form must not ask to discard anything.
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '管理分类', exact: true }).click();
  const categories = page.getByRole('dialog');
  expect((await categories.boundingBox()).height).toBeLessThan(1000);
  expect((await categories.boundingBox()).x).toBeGreaterThan(0);
});

test('product history switches to one wide order drawer with independent table scrolling', async ({ page }) => {
  const products = [];
  for (let index = 0; index < 12; index++) products.push(await product(page.request, index));
  const response = await page.request.post('/api/orders', { data: {
    type: 'in', partner: '抽屉测试供应商', items: products.map(item => ({ product_id: item.id, quantity: 2, price: 10 })),
  } });
  expect(response.ok()).toBe(true);
  const order = await response.json();
  await page.goto('/#products');
  await page.getByRole('textbox', { name: '筛选物料', exact: true }).fill(products[0].name);
  await page.getByRole('button', { name: `查看 ${products[0].name} 物料详情`, exact: true }).click();
  await bounds(page, page.getByRole('dialog'), 680);
  await expect(page.getByRole('dialog')).toBeFocused();
  await page.getByRole('button', { name: '查看操作记录', exact: true }).click();
  await page.getByRole('button', { name: order.number, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await bounds(page, dialog, 1000);
  await expect(dialog).toBeFocused();
  await expect(dialog.locator('.detail-table tbody tr')).toHaveCount(12);
  await page.screenshot({ path: 'output/ui-preview/desktop-drawer-order.png' });
  for (const viewport of [{ width: 900, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await bounds(page, dialog, viewport.width < 768 ? viewport.width : viewport.width - 48);
    const footer = dialog.getByRole('button', { name: '关闭详情', exact: true });
    await expect(footer).toBeInViewport();
    await dialog.locator('.detail-table tbody tr').last().scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
  }
  expect(await dialog.locator('.table-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.main-shell')).toHaveJSProperty('inert', false);
});

test('QR drawer keeps its form submit outside scrolling content and guards returning to the filtered list', async ({ page }) => {
  await page.goto('/#scanner');
  await page.getByRole('button', { name: '管理出入库二维码', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await bounds(page, dialog, 1000);
  const filter = dialog.getByRole('combobox', { name: '按操作类型筛选', exact: true });
  await filter.click();
  await page.getByRole('option', { name: '入库', exact: true }).click();
  await dialog.getByRole('button', { name: '新建二维码', exact: true }).click();
  const input = dialog.getByRole('textbox', { name: '二维码名称', exact: true });
  await expect(input).toBeFocused();
  await input.fill('二维码未保存修改');
  page.once('dialog', confirmation => confirmation.dismiss());
  await dialog.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(input).toHaveValue('二维码未保存修改');
  const save = dialog.getByRole('button', { name: '保存二维码', exact: true });
  expect(await save.evaluate(button => button.form?.contains(button))).toBe(false);
  expect(await save.evaluate(button => !!button.form)).toBe(true);
  await page.setViewportSize({ width: 900, height: 600 });
  await dialog.getByRole('checkbox', { name: '启用', exact: true }).scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await page.screenshot({ path: 'output/ui-preview/desktop-drawer-qr.png' });
  page.once('dialog', confirmation => confirmation.accept());
  await dialog.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(filter).toHaveValue('入库');
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('phone and iPad keep sheets, field order and original QR actions without desktop discard prompts', async ({ browser }) => {
  for (const device of [devices['Pixel 7'], devices['iPad Pro 11']]) {
    const context = await browser.newContext({ ...device, baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } });
      const page = await context.newPage();
      await page.goto('/#products');
      await page.getByRole('button', { name: '新增物料', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCSS('border-top-left-radius', '22px');
      expect((await dialog.boundingBox()).y).toBeGreaterThan(0);
      const labels = await dialog.locator('.form-body label').allTextContents();
      expect(labels.findIndex(text => text.includes('参考采购价'))).toBeLessThan(labels.findIndex(text => text.includes('规格型号')));
      await dialog.getByRole('textbox', { name: /物料名称/ }).fill('移动端修改仍按原规则关闭');
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.locator('.mw-tabs').getByRole('button', { name: '更多', exact: true }).click();
      await page.getByRole('button', { name: '出入库二维码', exact: true }).click();
      await dialog.getByRole('button', { name: '新建二维码', exact: true }).click();
      expect(await dialog.getByRole('button', { name: '保存二维码', exact: true }).evaluate(button => button.form.contains(button))).toBe(true);
      await expect(dialog.getByRole('button', { name: '取消编辑', exact: true })).toHaveCount(0);
      await dialog.getByRole('textbox', { name: '二维码名称', exact: true }).fill('移动二维码');
      await dialog.getByRole('button', { name: '返回列表', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: '管理出入库二维码', exact: true })).toBeVisible();
    } finally { await context.close(); }
  }
});

test('saving blocks closing, keeps failed edits and allows numeric values restored to their original value', async ({ page }) => {
  const item = await product(page.request);
  await page.goto('/#products');
  await page.getByRole('textbox', { name: '筛选物料', exact: true }).fill(item.name);
  const edit = page.getByRole('button', { name: '编辑', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: /参考销售价/ }).fill('20.00');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await edit.click();
  const note = dialog.getByRole('textbox', { name: '物料备注', exact: true });
  await note.fill('保存失败也要保留的内容');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/products/${item.id}`, async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '暂时无法保存，请重试' }) });
  });
  const request = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith(`/api/products/${item.id}`));
  await dialog.getByRole('button', { name: '保存物料', exact: true }).click();
  await request;
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  release();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存');
  await expect(dialog.getByRole('alert')).toBeInViewport();
  await expect(note).toHaveValue('保存失败也要保留的内容');
  page.once('dialog', confirmation => confirmation.accept());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
