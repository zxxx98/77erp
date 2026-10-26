import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await page.request.post(`${base}/api${path}`, { data: { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...data } });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
  };
  await post('/auth/setup', { username: 'tabsadmin', password: 'Test-admin-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const product = name => post('/products', { name, barcode: randomUUID(), category: '生产', unit: '件', cost: 1, price: 2, threshold: 0 });
  const output = await product('树图成品'), half = await product('树图半成品'), raw = await product('树图原料');
  db.prepare('UPDATE products SET stock=100,inventory_value_cents=10000 WHERE id=?').run(raw.id);
  const bom = (product_id, name, items) => post('/boms', { product_id, name, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items });
  const child = await bom(half.id, '半成品配方', [{ product_id: raw.id, quantity: 3, unit: '件', note: '' }]);
  const parent = await bom(output.id, '成品配方', [{ product_id: half.id, quantity: 2, unit: '件', note: '', usage_mode: 'explode', child_bom_id: child.id }]);
  const plan = await post('/production-orders/prepare', { bom_id: parent.id, bom_version: parent.version, planned_quantity: 10 });
  const draft = await post('/production-orders', { bom_id: parent.id, bom_version: parent.version, planned_quantity: 10, structure_token: plan.structure_token, note: '页签回归' });
  return { base, draft, post, db, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

for (const mode of ['desktop', 'mobile', 'pwa']) test(`${mode} production tabs preserve navigation and show a horizontal recipe tree`, async ({ page, browser }) => {
  test.setTimeout(60000);
  const context = mode === 'pwa' ? await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, userAgent: iphone }) : null;
  if (context) page = await context.newPage();
  if (mode !== 'desktop') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(ua => Object.defineProperty(navigator, 'userAgent', { value: ua }), iphone);
  }
  const f = await fixture(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const tab = name => page.getByRole('tab', { name, exact: true });
  try {
    await page.goto(`${f.base}/#production`);
    if (context) await page.evaluate(() => navigator.serviceWorker.ready);
    await page.getByRole('button', { name: `查看生产单 ${f.draft.number}`, exact: true }).click();
    await expect(tab('概览')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: '配方结构快照', exact: true })).not.toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${mode}-overview.png`), fullPage: true });
    await tab('生产进度').click();
    await expect(page.getByRole('heading', { name: '分层生产', exact: true })).toBeVisible();
    await tab('物料').click();
    await expect(page.getByRole('region', { name: '生产领退料', exact: true })).toBeVisible();
    await tab('完工与入库').click();
    await expect(page.getByText('暂无完工或入库记录。', { exact: true })).toBeVisible();
    await tab('配方结构').click();
    const canvas = page.getByRole('region', { name: '配方横向树状图', exact: true });
    await expect(canvas).toBeVisible();
    await expect(canvas.getByRole('button', { name: '查看详情 树图原料', exact: true })).toBeVisible();
    const bounds = await canvas.locator('[data-node-path]').evaluateAll(nodes => nodes.map(node => ({ path: node.dataset.nodePath, x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })));
    expect(bounds.find(node => node.path === '1').x).toBeGreaterThan(bounds.find(node => node.path === '').x + bounds.find(node => node.path === '').width);
    expect(bounds.find(node => node.path === '1.1').x).toBeGreaterThan(bounds.find(node => node.path === '1').x + bounds.find(node => node.path === '1').width);
    await expect(canvas.locator('[data-node-path="1.1"]')).toContainText('60 件');
    await page.screenshot({ path: test.info().outputPath(`${mode}-tree.png`), fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('searchbox', { name: '搜索结构物料', exact: true }).fill('树图原料');
    await expect(canvas.locator('[data-node-path="1"]')).toBeVisible();
    await expect.poll(() => canvas.evaluate(el => {
      const match = el.querySelector('[data-match="true"]'), a = match.getBoundingClientRect(), b = el.getBoundingClientRect();
      return a.left >= b.left && a.right <= b.right;
    })).toBe(true);
    await canvas.getByRole('button', { name: '查看详情 树图原料', exact: true }).click();
    await expect(page.getByRole('region', { name: '节点详情', exact: true })).toContainText('60 件');
    await page.getByRole('button', { name: '关闭节点详情', exact: true }).click();
    await tab('概览').click();
    await tab('配方结构').click();
    await expect(page.getByRole('searchbox', { name: '搜索结构物料', exact: true })).toHaveValue('树图原料');
    await page.getByRole('button', { name: '清除搜索', exact: true }).click();
    await expect.poll(() => canvas.evaluate(el => el.scrollLeft)).toBe(0);
    await canvas.getByRole('button', { name: '收起 树图半成品', exact: true }).click();
    await expect(canvas.locator('[data-node-path="1.1"]')).toHaveCount(0);
    await canvas.getByRole('button', { name: '展开 树图半成品', exact: true }).click();
    await expect(canvas.locator('[data-node-path="1.1"]')).toBeVisible();
    await canvas.getByRole('button', { name: '进入分支 树图半成品', exact: true }).click();
    await expect(canvas.locator('[data-node-path=""]')).toHaveCount(0);
    await expect(canvas.locator('[data-node-path="1"]')).toContainText('20 件');
    await expect(canvas.locator('[data-node-path="1.1"]')).toContainText('60 件');
    await page.getByRole('button', { name: '返回上一级', exact: true }).click();
    await page.getByRole('button', { name: '刷新单据与库存', exact: true }).click();
    await expect(tab('配方结构')).toHaveAttribute('aria-selected', 'true');
    await tab('概览').click();
    await tab('概览').press('ArrowRight');
    await expect(tab('生产进度')).toBeFocused();
    await expect(tab('生产进度')).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '返回生产单', exact: true }).click();
    await page.getByRole('button', { name: `查看生产单 ${f.draft.number}`, exact: true }).click();
    await expect(tab('概览')).toHaveAttribute('aria-selected', 'true');
    await tab('配方结构').click();
    await page.getByRole('button', { name: '返回生产单', exact: true }).click();
    await page.getByRole('button', { name: '新建生产单', exact: true }).click();
    await page.getByRole('button', { name: /^选择配方 树图成品 ·/ }).click();
    await page.getByRole('button', { name: '保存生产草稿', exact: true }).click();
    await expect(tab('概览')).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  } finally { await f.close(); await context?.close(); }
});

