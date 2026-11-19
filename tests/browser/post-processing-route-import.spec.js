import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

for (const mode of ['desktop', 'Pixel 7', 'iPhone 13', 'pwa']) test(`${mode} imports a whole post-processing route without replacing existing rows`, async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN', ...(mode === 'desktop' ? {} : devices[mode === 'pwa' ? 'iPhone 13' : mode]), serviceWorkers: mode === 'pwa' ? 'allow' : 'block' });
  const page = await context.newPage();
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), ...body } });
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result;
  };
  const button = (name, container = page) => container.getByRole('button', { name, exact: true });
  const coefficient = name => page.getByLabel(`每次处理成品数量 ${name}`, { exact: true });
  const picker = page.getByRole('dialog', { name: '添加后处理工序', exact: true });
  const importRoute = button('导入整条工艺路线', picker);
  const openRoute = async name => {
    await button('添加后处理工序').click();
    await button(name, picker).click();
  };
  const node = (id, name) => ({ id, name, note: '', x: 24, y: 24 });
  const addRoute = (name, graph) => post('/process-routes', { name, route_kind: 'post_processing', enabled: 1, note: '', graph });

  try {
    await post('/auth/setup', { username: 'importadmin', password: 'Test-admin-123' });
    await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
    const carton = await post('/products', { name: '纸箱', barcode: randomUUID(), category: '生产', unit: '个', cost: 1, price: 2, threshold: 0 });
    const route = await addRoute('包装路线', {
      nodes: [{ ...node('pack', '装箱'), materials: [{ product_id: carton.id, quantity: 1 }] }, node('check', '复检'), node('label', '贴标')],
      edges: [{ from: 'label', to: 'check' }, { from: 'check', to: 'pack' }],
      price_tables: [{ id: 'model-b', name: 'B型号包装', prices: { pack: { unit_price: 3, currency: 'CNY' } } }],
    });
    if (mode === 'desktop') {
      const nodes = Array.from({ length: 50 }, (_, index) => node(`step-${index}`, `测试工序 ${index + 1}`));
      await addRoute('满额路线', { nodes, edges: nodes.slice(1).map((item, index) => ({ from: nodes[index].id, to: item.id })) });
    }

    await page.goto(`${base}/#process-routes`);
    if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);
    await button('后处理工序表').click();
    await button('新建后处理工序表').click();
    await page.getByLabel('工序表名称', { exact: true }).fill('包装工序表');
    await openRoute('包装路线');
    await button('贴标', picker).click();
    await coefficient('贴标').fill('20');

    await openRoute('包装路线');
    await expect(button('贴标', picker)).toBeDisabled();
    await picker.getByRole('combobox', { name: '单价表', exact: true }).click();
    await page.getByRole('option', { name: 'B型号包装', exact: true }).click();
    await importRoute.click();
    const plan = page.locator('.post-processing-plan');
    await expect(plan.locator('.post-processing-name strong')).toHaveText(['贴标', '复检', '装箱']);
    await expect(plan).toContainText('纸箱');
    await expect(coefficient('贴标')).toHaveValue('20');
    await expect(coefficient('复检')).toHaveValue('');
    await expect(coefficient('装箱')).toHaveValue('');
    await coefficient('复检').fill('50');
    await coefficient('装箱').fill('100');

    await openRoute('包装路线');
    await expect(importRoute).toBeDisabled();
    await expect(picker).toContainText('工序已全部添加');
    await button('关闭弹窗', picker).click();
    if (mode === 'desktop') {
      await openRoute('满额路线');
      await expect(importRoute).toBeDisabled();
      await expect(picker).toContainText('整条导入会超过工序表上限');
      await expect(button('测试工序 1', picker)).toBeEnabled();
      await button('关闭弹窗', picker).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/post-processing-tables');
    await button('保存工序表').click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const { operations } = await response.json();
    expect(operations).toMatchObject([
      { route_id: route.id, route_version: route.version, node_id: 'label', price_table_id: null, product_coefficient: 20 },
      { route_id: route.id, route_version: route.version, node_id: 'check', price_table_id: 'model-b', product_coefficient: 50 },
      { route_id: route.id, route_version: route.version, node_id: 'pack', price_table_id: 'model-b', product_coefficient: 100, materials: [{ product_id: carton.id, quantity: 1 }] },
    ]);
    await expect(page.getByText('包装工序表', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
