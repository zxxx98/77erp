import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';

async function fixture(page, wide = false) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(base + '/api' + path, { data: { request_id: randomUUID(), ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'navadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const products = [];
  for (let i = 0; i < 11; i++) products.push(await post('/products', {
    name: i === 0 ? '十层成品' : i === 10 ? '共用原料' : `第${i}层半成品`, barcode: `NAV-${i}`, unit: '件', category: '生产', cost: 1, price: 2, threshold: 0,
    production_type: i === 0 ? '成品' : i === 10 ? '原料' : '半成品',
  }));
  const extras = [];
  if (wide) for (let i = 0; i < 24; i++) extras.push(await post('/products', {
    name: `辅料${i}`, barcode: `EXTRA-${i}`, unit: '件', category: '生产', cost: 1, price: 2, threshold: 0,
  }));
  let child;
  const recipes = [];
  for (let i = 9; i >= 0; i--) {
    child = await post('/boms', {
    name: `层级配方${i}`, product_id: products[i].id, base_quantity: 1, base_unit: '件', enabled: 1, note: '',
    items: [...(i === 0 ? extras.map(product => ({ product_id: product.id, quantity: 1, unit: '件', note: '' })) : []),
      { product_id: products[i + 1].id, quantity: 1, unit: '件', note: '', ...(child ? { usage_mode: 'explode', child_bom_id: child.id } : {}) },
      ...(i === 0 ? [{ product_id: products[10].id, quantity: 2, unit: '件', note: '' }] : [])],
    });
    recipes.push(child);
  }
  return { base, post, db, root: child, products, recipes, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

for (const profile of ['desktop', 'iphone', 'android-pwa']) test(`${profile} navigates ten BOM levels, searches repeated paths and preserves views`, async ({ page: defaultPage, browser }) => {
  test.setTimeout(90000);
  const context = profile === 'android-pwa' ? await browser.newContext({ locale: 'zh-CN', viewport: { width: 412, height: 915 }, userAgent: android, serviceWorkers: 'allow' }) : null;
  const page = context ? await context.newPage() : defaultPage;
  if (profile === 'iphone') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(f.base + '/#bom');
    if (context) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('searchbox', { name: '搜索BOM', exact: true }).fill('层级配方0');
    await page.getByRole('button', { name: '测算备料', exact: true }).click();
    await page.getByRole('button', { name: '开始测算', exact: true }).click();
    await expect(page.getByRole('tab', { name: '领料汇总', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.bom-result-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.bom-result-table tbody tr td').nth(2)).toHaveText('3 件');
    await page.getByRole('tab', { name: '配方结构', exact: true }).click();
    const rows = page.locator('.bom-structure-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.bom-node-tags')).toHaveText('半成品第 1 级');
    await expect(rows.last().locator('.bom-node-tags')).toHaveText('原料第 1 级');
    if (profile === 'desktop') {
      await page.getByRole('button', { name: '展开到第 3 层', exact: true }).click();
      await expect(rows).toHaveCount(4);
      await page.getByRole('tab', { name: '领料汇总', exact: true }).click();
      await page.getByRole('tab', { name: '配方结构', exact: true }).click();
      await expect(rows).toHaveCount(4);
      await page.getByRole('button', { name: '全部收起', exact: true }).click();
    }
    for (let i = 1; i <= 9; i++) await page.getByRole('button', { name: `进入分支 第${i}层半成品`, exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('共用原料');
    await expect(rows.locator('.bom-node-tags')).toHaveText('原料第 10 级');
    await page.getByRole('button', { name: '查看详情 共用原料', exact: true }).click();
    const details = page.getByRole('region', { name: '节点详情', exact: true });
    await expect(details).toContainText('层级配方9');
    await expect(details).toContainText('十层成品');
    await expect(details).toContainText('第9层半成品');
    await expect(details).toContainText('当前生产类型原料');
    await expect(details).toContainText('结构层级第 10 级');
    await page.screenshot({ path: test.info().outputPath(`${profile}-deep-detail.png`), fullPage: profile === 'desktop', animations: 'disabled' });
    await page.getByRole('button', { name: '关闭节点详情', exact: true }).click();
    await page.getByRole('navigation', { name: 'BOM路径' }).getByRole('button', { name: '十层成品', exact: true }).click();
    await expect(rows).toHaveCount(2);
    const search = page.getByRole('searchbox', { name: '搜索结构物料', exact: true });
    await search.fill('NAV-10');
    await expect(page.getByRole('status').filter({ hasText: '找到 2 处匹配' })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看详情 共用原料', exact: true })).toHaveCount(2);
    const repeated = rows.filter({ has: page.getByRole('button', { name: '查看详情 共用原料', exact: true }) });
    await expect(repeated.locator('.bom-node-tags')).toHaveText(['原料第 10 级', '原料第 1 级']);
    await page.screenshot({ path: test.info().outputPath(`${profile}-search.png`), fullPage: profile === 'desktop', animations: 'disabled' });
    await search.fill('不存在的物料');
    await expect(page.getByText('没有匹配的物料，请更换名称或编码。')).toBeVisible();
    await page.getByRole('button', { name: '清除搜索', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(search).toHaveValue('');
    await page.screenshot({ path: test.info().outputPath(`${profile}-structure.png`), fullPage: profile === 'desktop', animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (profile !== 'desktop') {
      await page.setViewportSize({ width: 320, height: 740 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('tab', { name: '领料汇总', exact: true }).click();
    await page.getByRole('button', { name: '查看 2 条来源', exact: true }).click();
    await expect(page.getByRole('tab', { name: '配方结构', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: '查看详情 共用原料', exact: true })).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally { await f.close(); await context?.close(); }
});

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} restores branch scroll and inspects a frozen production snapshot`, async ({ page }) => {
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page, true);
  try {
    const plan = await f.post(`/boms/${f.root.id}/calculate`, { schema_version: 2, production_quantity: 2 });
    await f.post('/production-orders', { schema_version: 2, stage_schema_version: 1, bom_id: f.root.id, bom_version: f.root.version, planned_quantity: 2, structure_token: plan.structure_token, note: '' });
    // The saved production snapshot must survive later root/child recipe edits.
    await f.post(`/boms/${f.root.id}`, { ...f.root, items: f.root.items.map(item => item.product_id === f.products[10].id ? { ...item, quantity: 9 } : item) });
    f.db.prepare('UPDATE products SET production_type=? WHERE id=?').run('成品', f.products[10].id);
    await page.goto(f.base + '/#production');
    await page.getByRole('button', { name: /^查看生产单 / }).click();
    await expect(page.getByText('结构及用量为保存时快照，生产类型显示物料档案当前值；根配方产物为第 0 级。')).toBeVisible();
    await expect(page.locator('.bom-structure-row').first().locator('.bom-node-tags')).toHaveText('类型未设置第 1 级');
    await expect(page.locator('.bom-structure-row').last().locator('.bom-node-tags')).toHaveText('成品第 1 级');
    const list = page.locator('.bom-structure-scroll');
    const enter = page.getByRole('button', { name: '进入分支 第1层半成品', exact: true });
    await enter.scrollIntoViewIfNeeded();
    const before = await list.evaluate(element => element.scrollTop);
    expect(before).toBeGreaterThan(100);
    await enter.click();
    await expect(page.locator('.bom-structure-row')).toHaveCount(1);
    await page.getByRole('button', { name: '返回上一级', exact: true }).click();
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(before);
    await page.getByRole('button', { name: '查看详情 共用原料', exact: true }).click();
    await expect(page.getByRole('region', { name: '节点详情' })).toContainText('4 件');
    await expect(page.getByRole('region', { name: '节点详情' })).toContainText('当前生产类型成品');
    await page.getByRole('button', { name: '关闭节点详情', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看详情 共用原料', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.close(); }
});

test('changing a selected production recipe resets paths but quantity changes preserve them', async ({ page }) => {
  const f = await fixture(page);
  try {
    const alternate = await f.post('/boms', { name: '浅层配方', product_id: f.products[0].id, base_quantity: 1, base_unit: '件', enabled: 1, note: '',
      items: [{ product_id: f.products[9].id, quantity: 2, unit: '件', note: '', usage_mode: 'explode', child_bom_id: f.recipes[0].id }] });
    await page.goto(f.base + '/#production');
    await page.getByRole('button', { name: '新建生产单', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索生产配方', exact: true }).fill('十层成品');
    await page.getByRole('button', { name: `选择配方 十层成品 · 层级配方0 #${f.root.id}`, exact: true }).click();
    await page.getByRole('button', { name: '进入分支 第1层半成品', exact: true }).click();
    await page.getByRole('button', { name: '进入分支 第2层半成品', exact: true }).click();
    await page.getByLabel('计划产量', { exact: true }).fill('3');
    await expect(page.locator('.bom-structure-row')).toContainText('第3层半成品');
    await expect(page.locator('.bom-tree-quantity')).toHaveText('3 件');
    await page.getByRole('button', { name: `选择配方 十层成品 · 浅层配方 #${alternate.id}`, exact: true }).click();
    await expect(page.locator('.bom-structure-row')).toHaveCount(1);
    await expect(page.locator('.bom-structure-row')).toContainText('第9层半成品');
    await expect(page.getByRole('navigation', { name: 'BOM路径' })).toHaveText('十层成品');
  } finally { await f.close(); }
});
