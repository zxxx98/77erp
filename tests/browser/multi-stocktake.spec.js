import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../server/app.js';
import { parseCSV } from '../../src/data-files.js';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data, warehouseId = 1) => {
    const response = await page.request.post(base + '/api' + path, { headers: { 'X-Warehouse-ID': String(warehouseId) }, data });
    expect(response.ok(), JSON.stringify(await response.json())).toBe(true);
    return response.json();
  };
  await post('/auth/setup', { username: 'multistocktake', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const current = await post('/warehouses', { name: '当前分仓' });
  const empty = await post('/warehouses', { name: '未建档仓' });
  const product = await post('/products', { name: '盘点螺丝', barcode: 'MULTI-A001', category: '日用', unit: '个', cost: 1, price: 2, threshold: 0, sync_warehouse_ids: [current.id] });
  const remote = db.prepare('SELECT id FROM products WHERE warehouse_id=?').get(current.id);
  await post('/orders', { type: 'in', partner: '测试', items: [{ product_id: product.id, quantity: 8.025, price: 1 }] });
  await post('/orders', { type: 'in', partner: '测试', items: [{ product_id: remote.id, quantity: 10.125, price: 1 }] }, current.id);
  return { base, current, empty, db, post, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

test('multi-warehouse flow searches only on demand, shows the current warehouse first and exports its snapshot', async ({ page }) => {
  const f = await fixture(page), errors = [], searches = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/stocktakes/multi/products')) searches.push(request.url()); });
  try {
    await page.goto(`${f.base}/?warehouse_id=${f.current.id}&manage=multi-stocktake`);
    const panel = page.locator('.multi-stocktake');
    await expect(panel.getByRole('heading', { name: '多仓库盘点', exact: true })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /^当前分仓/ })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: /^当前分仓/ })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /^主仓库/ }).check();
    await panel.getByRole('checkbox', { name: /^未建档仓/ }).check();
    await panel.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(panel.locator('.multi-stocktake-results')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '开始盘点', exact: true })).toBeDisabled();
    expect(searches).toEqual([]);
    const search = panel.getByRole('searchbox');
    await search.fill('   ');
    await expect(panel.locator('.multi-stocktake-results')).toHaveCount(0);
    await search.fill('MULTI-A001');
    await expect(panel.getByRole('button', { name: '添加', exact: true })).toBeVisible();
    await search.fill(' MULTI-A001 ');
    await expect(panel.getByRole('button', { name: '添加', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '添加', exact: true }).click();
    await expect(panel.getByRole('button', { name: '已添加', exact: true })).toBeDisabled();
    await search.fill('');
    await expect(panel.locator('.multi-stocktake-results')).toHaveCount(0);
    await expect(panel.getByText('已添加 1 种', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '开始盘点', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '盘点结果', exact: true })).toBeVisible();
    await expect(panel.locator('thead th').nth(1)).toContainText('当前分仓');
    await expect(panel.locator('tbody td').nth(0)).toHaveText('10.125');
    await expect(panel.locator('tbody td').nth(1)).toContainText('差值 -2.1');
    await expect(panel.locator('tbody td').nth(2)).toHaveText('未建档');
    // Later inventory changes must not silently change the table or exported snapshot.
    f.db.prepare('UPDATE products SET stock=123 WHERE warehouse_id=1').run();
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出 CSV', exact: true }).click();
    const downloaded = await downloadEvent;
    const bytes = await readFile(await downloaded.path());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const rows = parseCSV(bytes.toString('utf8'));
    expect(rows[0]).toEqual(['商品名称', '编号', '单位', '当前分仓数量', '主仓库数量', '主仓库差值', '未建档仓数量', '未建档仓差值']);
    expect(rows[1]).toEqual(['盘点螺丝', 'MULTI-A001', '个', '10.125', '8.025', '-2.1', '未建档', '']);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM stock_adjustments').get().n).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await panel.locator('.multi-stocktake-table-scroll').evaluate(el => ({ right: el.getBoundingClientRect().right, screen: innerWidth }));
    expect(bounds.right).toBeLessThanOrEqual(bounds.screen);
    await panel.getByRole('button', { name: '返回添加商品', exact: true }).click();
    await panel.getByRole('button', { name: '移除盘点螺丝', exact: true }).click();
    await expect(panel.getByRole('button', { name: '开始盘点', exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('search pagination, failed requests and out-of-order replies keep the pending list accurate', async ({ page }) => {
  const f = await fixture(page);
  try {
    for (let n = 0; n < 31; n++) await f.post('/products', { name: `匹配商品-${n}`, barcode: `MATCH-${String(n).padStart(3, '0')}`, category: '日用', unit: '个', cost: 1, price: 2, threshold: 0 }, f.current.id);
    await page.goto(`${f.base}/?warehouse_id=${f.current.id}&manage=multi-stocktake`);
    const panel = page.locator('.multi-stocktake');
    await panel.getByRole('button', { name: '下一步', exact: true }).click();
    await panel.getByRole('searchbox').fill('MATCH-');
    await expect(panel.locator('.multi-stocktake-results .multi-stocktake-product-row')).toHaveCount(30);
    await panel.getByRole('button', { name: '加载更多匹配商品', exact: true }).click();
    await expect(panel.locator('.multi-stocktake-results .multi-stocktake-product-row')).toHaveCount(31);
    await expect(panel.getByRole('button', { name: '加载更多匹配商品', exact: true })).toHaveCount(0);
    await page.route('**/stocktakes/multi/products?q=fail*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '搜索暂时失败' }) }));
    await panel.getByRole('searchbox').fill('fail');
    await expect(panel.getByRole('alert')).toHaveText('搜索暂时失败');
    await page.unroute('**/stocktakes/multi/products?q=fail*');
    await panel.getByRole('button', { name: '重试搜索', exact: true }).click();
    await expect(panel.getByText('没有找到匹配的商品', { exact: true })).toBeVisible();
    let release;
    const pause = new Promise(resolve => { release = resolve; });
    let requested;
    const received = new Promise(resolve => { requested = resolve; });
    await page.route('**/stocktakes/multi/products?q=slow*', async route => {
      requested(); await pause;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ products: [{ id: 999, name: '过期结果', barcode: 'STALE', unit: '个' }], has_more: false }) }).catch(() => {});
    });
    await panel.getByRole('searchbox').fill('slow');
    await received;
    await panel.getByRole('searchbox').fill('MULTI-A001');
    release();
    await expect(panel.locator('.multi-stocktake-results .multi-stocktake-product-row')).toHaveCount(1);
    await expect(panel.locator('.multi-stocktake-results')).toContainText('盘点螺丝');
    await expect(panel.getByText('过期结果', { exact: true })).toHaveCount(0);
  } finally { await f.close(); }
});
