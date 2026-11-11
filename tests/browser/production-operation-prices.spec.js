import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

for (const mode of ['desktop', 'Pixel 7', 'iPhone 13', 'pwa']) test(`${mode} production prices show snapshots and refresh the originally bound tables with edit permission`, async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage();
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body } });
    const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true); return result;
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await post('/auth/setup', { username: 'pricesadmin', password: 'Prices-test-123' });
    await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
    const node = (id, price) => ({ id, name: { cut: '裁切', weld: '焊接', out: '产出' }[id], note: '', x: 24, y: 24, ...price });
    const graph = { nodes: [node('cut', { unit_price: 99, currency: 'VND' }), node('weld'), node('out')], edges: [{ from: 'cut', to: 'weld' }, { from: 'weld', to: 'out' }],
      price_tables: [{ id: 'model-a', name: 'A型号工价', prices: { cut: { unit_price: 1.2345, currency: 'USD' }, weld: { unit_price: 0, currency: 'CNY' } } }] };
    let route = await post('/process-routes', { name: '工价测试路线', note: '', enabled: 1, graph });
    const postRoute = await post('/process-routes', { name: '包装工艺', note: '', enabled: 1, route_kind: 'post_processing', graph: { nodes: [{ id: 'pack', name: '包装', note: '', x: 24, y: 24, unit_price: 0.5, currency: 'CNY' }], edges: [] } });
    const product = (name, routeId = null) => post('/products', { name, barcode: randomUUID(), category: '生产', unit: '件', cost: 1, price: 2, threshold: 0, default_route_id: routeId });
    const output = await product('工价成品', route.id), half = await product('工价半成品', route.id), raw = await product('工价原料');
    const makeBom = (product_id, name, items) => post('/boms', { product_id, name, base_quantity: 1, base_unit: '件', enabled: 1, note: '', route_price_table_id: 'model-a', items });
    const child = await makeBom(half.id, '半成品配方', [{ product_id: raw.id, quantity: 1, unit: '件', note: '' }]);
    let bom = await makeBom(output.id, '成品配方', [{ product_id: half.id, quantity: 1, unit: '件', note: '', usage_mode: 'explode', child_bom_id: child.id }]);
    const plan = await post('/production-orders/prepare', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10 });
    const order = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: 10, structure_token: plan.structure_token, note: '', post_processing_operations: [{ route_id: postRoute.id, route_version: postRoute.version, node_id: 'pack', product_coefficient: 2 }] });
    graph.price_tables[0].name = 'A型号新工价';
    graph.price_tables[0].prices.cut = { unit_price: 3.4567, currency: 'CNY' };
    graph.nodes[0].multiplier = 1.5;
    route = await post(`/process-routes/${route.id}`, { ...route, graph });
    bom = await post(`/boms/${bom.id}`, { ...bom, route_price_table_id: null });
    const editor = await post('/positions', { name: '工价编辑员', access_mode: 'standard', permissions: ['production', 'bom'] });
    const reader = await post('/positions', { name: '生产财务查看', access_mode: 'standard', permissions: ['production', 'finance'] });
    for (const [username, position_id] of [['priceseditor', editor.id], ['pricesreader', reader.id]]) {
      await post('/users', { username, employee_no: username, password: 'Prices-test-123', role: 'employee', position_id });
    }
    await post('/auth/logout', {});
    await post('/auth/login', { username: 'priceseditor', password: 'Prices-test-123' });
    await page.goto(`${base}/#production?order=${order.id}`);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    const tab = page.getByRole('tab', { name: '工价列表', exact: true });
    await tab.click();
    const panel = page.getByRole('tabpanel', { name: '工价列表', exact: true });
    await expect(panel).toContainText('不会实时跟随单价表变动');
    await expect(panel.getByRole('table')).toHaveCount(3);
    await expect(panel.getByRole('row').filter({ hasText: '裁切' }).first()).toContainText('USD 1.2345 / 件');
    await expect(panel.getByRole('row').filter({ hasText: '焊接' }).first()).toContainText('CNY 0 / 件');
    await expect(panel.getByRole('row').filter({ hasText: '产出' }).first()).toContainText('未设置单价');
    await expect(panel.getByRole('row').filter({ hasText: '包装' })).toContainText('CNY 0.5 / 次');
    await expect(panel).toContainText('A型号工价');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.getByRole('button', { name: '刷新工价', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '同步最新单价', exact: true });
    await expect(confirmation).toContainText('历史报工也将按新单价重新核算计件工资');
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await expect(panel).toContainText('USD 1.2345');
    await panel.getByRole('button', { name: '刷新工价', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认同步单价', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(panel).toContainText('A型号新工价');
    await expect(panel.getByRole('row').filter({ hasText: '裁切' }).first()).toContainText('CNY 3.4567 / 件');
    await expect(panel.getByRole('row').filter({ hasText: '裁切' }).first()).toContainText('× 1.5');
    await expect(panel).not.toContainText('VND 99');
    await page.screenshot({ path: test.info().outputPath(`${mode}-operation-prices.png`), fullPage: true });
    await page.getByRole('tab', { name: '生产进度', exact: true }).click();
    await tab.click();
    await expect(panel).toContainText('CNY 3.4567');
    await post('/auth/logout', {});
    await post('/auth/login', { username: 'pricesreader', password: 'Prices-test-123' });
    await page.reload();
    await expect(page.getByRole('tab', { name: '生产进度', exact: true })).toBeVisible();
    await expect(tab).toHaveCount(0);
    await page.getByRole('button', { name: '更多操作', exact: true }).click();
    await expect(page.getByRole('button', { name: '同步最新单价', exact: true })).toHaveCount(0);
    expect((await page.request.get(`${base}/api/production-orders/${order.id}/operation-prices`)).status()).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
  }
});
