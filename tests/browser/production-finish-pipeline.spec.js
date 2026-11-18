import { test, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/app.js';
import { browserPosition } from './position-helpers.js';

async function setupBrowserApp(browser, mode) {
  const context = await browser.newContext({
    locale: 'zh-CN',
    ...(mode === 'desktop' ? { viewport: { width: 1440, height: 1000 } } : devices[mode === 'pwa' ? 'iPhone 13' : mode]),
    serviceWorkers: mode === 'pwa' ? 'allow' : 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await page.request.post(`${base}/api${path}`, {
      data: { request_id: randomUUID(), schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body },
    });
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result;
  };
  const get = async path => {
    const response = await page.request.get(`${base}/api${path}`);
    const result = await response.json();
    expect(response.ok(), JSON.stringify(result)).toBe(true);
    return result;
  };
  const cleanup = async () => {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  };
  return { page, db, base, post, get, cleanup };
}

for (const mode of ['desktop', 'Pixel 7', 'pwa']) {
  test(`${mode} runs full 3-step finish pipeline: close pending material request, confirm semi-finished receipt, and submit pending raw return`, async ({ browser }) => {
    test.setTimeout(90000);
    const { page, db, base, post, get, cleanup } = await setupBrowserApp(browser, mode);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await post('/auth/setup', { username: 'pipeadmin', password: 'Test-admin-123' });
      await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });

      const product = name => post('/products', { name, barcode: randomUUID(), category: '生产', unit: 'kg', cost: 10, price: 20, threshold: 0 });
      const finished = await product('管道成品');
      const semi = await product('管道半成品');
      const raw = await product('管道原料');
      const extraRaw = await product('管道辅料');
      db.prepare('UPDATE products SET stock=100, inventory_value_cents=100000 WHERE id IN (?,?)').run(raw.id, extraRaw.id);

      const childBom = await post('/boms', {
        name: '半成品配方',
        product_id: semi.id,
        base_quantity: 1,
        base_unit: 'kg',
        enabled: 1,
        note: '',
        items: [{ product_id: raw.id, quantity: 2, unit: 'kg', note: '' }],
      });
      const rootBom = await post('/boms', {
        name: '主配方',
        product_id: finished.id,
        base_quantity: 1,
        base_unit: 'kg',
        enabled: 1,
        note: '',
        items: [
          { product_id: semi.id, quantity: 1, unit: 'kg', note: '', usage_mode: 'explode', child_bom_id: childBom.id },
          { product_id: extraRaw.id, quantity: 1, unit: 'kg', note: '' },
        ],
      });

      const plan = await post('/production-orders/prepare', { bom_id: rootBom.id, bom_version: rootBom.version, planned_quantity: 4 });
      let order = await post('/production-orders', { bom_id: rootBom.id, bom_version: rootBom.version, planned_quantity: 4, note: '', structure_token: plan.structure_token });
      order = await post(`/production-orders/${order.id}/start`, { version: order.version });

      // Partially issue: raw = 6 (pending 2), extraRaw = 4 (complete). Leaves initial material doc in 'partial' pending status.
      const initDoc = order.material_documents[0];
      await post(`/production-material-documents/${initDoc.id}/confirm`, {
        version: initDoc.version,
        items: [{ product_id: raw.id, quantity: 6 }, { product_id: extraRaw.id, quantity: 4 }],
      });

      // Produce 2 semi-finished (consumes 4 raw -> 2 raw left), then produce 1/3 finished (consumes 1/3 semi & 1/3 extraRaw).
      order = await get(`/production-orders/${order.id}`);
      order = await post(`/production-orders/${order.id}/stages/complete`, {
        version: order.version,
        path: '1',
        completed_quantity: 2,
        items: [{ path: '1.1', quantity: 4 }],
        finish_order: false,
      });
      order = await post(`/production-orders/${order.id}/stages/complete`, {
        version: order.version,
        path: '',
        completed_quantity: '1/3',
        items: [{ path: '1', quantity: '1/3' }, { path: '2', quantity: '1/3' }],
        scraps: [],
        finish_order: false,
      });

      await page.goto(`${base}/#production?order=${order.id}`);
      if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);

      await page.getByRole('button', { name: '结束生产', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: '完结生产流水线', exact: true });
      await expect(dialog).toBeVisible();

      // Step 1: Pending partial material document blocks advancing until closed.
      await expect(dialog.getByText('待处理的领退料单', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '下一步：处理结余', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: '关闭剩余待发', exact: true }).click();
      await dialog.getByLabel('取消申请原因', { exact: true }).fill('剩余无需继续发料');
      await dialog.getByRole('button', { name: '确认关闭剩余待发', exact: true }).click();
      await expect(dialog.getByRole('status').first()).toContainText('剩余待发已关闭');
      await expect(dialog.getByRole('button', { name: '下一步：处理结余', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: '下一步：处理结余', exact: true }).click();

      // Step 2: Semi-finished balance (5/3 kg) must be cleared before advancing to Step 3.
      await expect(dialog.getByText('半成品结余处理', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '下一步：完结预览', exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: '申请并确认入库', exact: true }).click();
      await expect(dialog.getByRole('status').first()).toContainText('已提交并确认入库');
      await expect(dialog.getByRole('button', { name: '下一步：完结预览', exact: true })).toBeEnabled();

      // Step 2 also shows raw material balances with rounding deduction:
      // extraRaw: balance 11/3, rounding 1/15000 (0.0001), returnable = 3.6666.
      // raw: balance 2, returnable = 2.
      await expect(dialog.getByLabel('管道辅料 完结退料数量', { exact: true })).toHaveValue('3.6666');
      await expect(dialog.getByLabel('管道原料 完结退料数量', { exact: true })).toHaveValue('2');
      await dialog.getByLabel('管道原料 完结退料数量', { exact: true }).fill('1.5');
      await dialog.getByLabel('退料申请备注', { exact: true }).fill('管道退回余料');
      await dialog.getByRole('button', { name: '下一步：完结预览', exact: true }).click();

      // Step 3: Rounding preview & pending return summary.
      await expect(dialog.getByText('完结结算汇总', { exact: true })).toBeVisible();
      await expect(dialog).toContainText('0.3334');
      await expect(dialog).toContainText('管道原料');
      await expect(dialog).toContainText('1.5 kg');
      await expect(dialog).toContainText('管道辅料');
      await expect(dialog).toContainText('3.6666 kg');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${mode}-finish-pipeline-preview.png`) });

      await dialog.getByRole('button', { name: '确认完结生产单', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('已完工', { exact: true })).toBeVisible();
      await expect(page.getByRole('status').first()).toContainText('剩余材料退料申请已提交仓库');

      const completed = await get(`/production-orders/${order.id}`);
      expect(completed.status).toBe('completed');
      expect(completed.settled_completed_quantity).toBe(0.3334);
      const returnDoc = completed.material_documents.at(-1);
      expect(returnDoc.kind).toBe('return');
      expect(returnDoc.status).toBe('pending');
      expect(returnDoc.note).toBe('管道退回余料');
      expect(db.prepare('SELECT stock FROM products WHERE id=?').get(raw.id).stock).toBe(94);

      // Warehouse confirms the generated return document afterwards.
      await post(`/production-material-documents/${returnDoc.id}/confirm`, { version: returnDoc.version });
      expect(db.prepare('SELECT stock FROM products WHERE id=?').get(raw.id).stock).toBe(95.5);
      expect(db.prepare('SELECT stock FROM products WHERE id=?').get(extraRaw.id).stock).toBe(99.6666);
      expect(errors).toEqual([]);
    } finally {
      await cleanup();
    }
  });
}

for (const mode of ['desktop', 'Pixel 7', 'pwa']) {
  test(`${mode} opens pipeline even with no documents or balances, and supports immediate return confirmation when permitted`, async ({ browser }) => {
    test.setTimeout(90000);
    const { page, db, base, post, get, cleanup } = await setupBrowserApp(browser, mode);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await post('/auth/setup', { username: 'fastadmin', password: 'Test-admin-123' });
      await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });

      const product = name => post('/products', { name, barcode: randomUUID(), category: '生产', unit: '件', cost: 10, price: 20, threshold: 0 });
      const outA = await product('无结余成品');
      const outB = await product('有结余成品');
      const raw = await product('通用原料');
      db.prepare('UPDATE products SET stock=100, inventory_value_cents=100000 WHERE id=?').run(raw.id);

      const bomA = await post('/boms', { name: '无结余配方', product_id: outA.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items: [{ product_id: raw.id, quantity: 2, unit: '件', note: '' }] });
      const bomB = await post('/boms', { name: '有结余配方', product_id: outB.id, base_quantity: 1, base_unit: '件', enabled: 1, note: '', items: [{ product_id: raw.id, quantity: 3, unit: '件', note: '' }] });

      const startAndIssue = async (bom, qty) => {
        const plan = await post('/production-orders/prepare', { bom_id: bom.id, bom_version: bom.version, planned_quantity: qty });
        let o = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, planned_quantity: qty, note: '', structure_token: plan.structure_token });
        o = await post(`/production-orders/${o.id}/start`, { version: o.version });
        await post(`/production-material-documents/${o.material_documents[0].id}/confirm`, { version: o.material_documents[0].version });
        return get(`/production-orders/${o.id}`);
      };

      // Case 1: Zero pending documents, zero balances -> still opens pipeline modal on Step 3.
      let orderA = await startAndIssue(bomA, 2);
      orderA = await post(`/production-orders/${orderA.id}/complete`, {
        version: orderA.version,
        completed_quantity: 2,
        items: [{ product_id: raw.id, quantity: 4, variance_reason: '' }],
        scraps: [],
        finish_order: false,
      });
      await page.goto(`${base}/#production?order=${orderA.id}`);
      if (mode === 'pwa') await page.evaluate(() => navigator.serviceWorker.ready);

      await page.getByRole('button', { name: '结束生产', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: '完结生产流水线', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('完结结算汇总', { exact: true })).toBeVisible();
      await expect(dialog.getByText('本次无待退回原材料，确认后将直接结算并完结生产单。')).toBeVisible();
      await dialog.getByRole('button', { name: '确认完结生产单', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('已完工', { exact: true })).toBeVisible();

      // Case 2: Production-only user sees Step 2 without immediate confirmation option, then admin confirms immediately.
      let orderB = await startAndIssue(bomB, 3);
      orderB = await post(`/production-orders/${orderB.id}/complete`, {
        version: orderB.version,
        completed_quantity: 1,
        items: [{ product_id: raw.id, quantity: 3, variance_reason: '' }],
        scraps: [],
        finish_order: false,
      });

      const prodPos = await browserPosition(page.request, ['basic_view', 'production'], base);
      await post('/users', { username: 'prodonly', employee_no: 'prodonly', password: 'Prod-only-123', position_id: prodPos });
      await post('/auth/login', { username: 'prodonly', password: 'Prod-only-123' });
      await page.goto(`${base}/#production?order=${orderB.id}`);
      await page.reload();
      await page.getByRole('button', { name: '结束生产', exact: true }).first().click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('checkbox', { name: '完结时同时生成剩余材料退料申请单', exact: true })).toBeChecked();
      await expect(dialog.getByRole('checkbox', { name: '同时确认退料入库（直接恢复仓库库存）', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();

      // Switch back to admin with stock_approve and confirm return immediately on finish.
      await post('/auth/login', { username: 'fastadmin', password: 'Test-admin-123' });
      await page.reload();
      const notice = page.locator('.todo-notice');
      await expect(notice).toBeVisible();
      await notice.getByRole('button', { name: '我知道了', exact: true }).click();
      await expect(notice).toHaveCount(0);
      await page.getByRole('button', { name: '结束生产', exact: true }).first().click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('checkbox', { name: '同时确认退料入库（直接恢复仓库库存）', exact: true }).check();
      await dialog.getByRole('button', { name: '下一步：完结预览', exact: true }).click();
      await expect(dialog.getByText(/立即确认入库/)).toBeVisible();
      await dialog.getByRole('button', { name: '确认完结生产单', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('status').first()).toContainText('退料单已同步生成并确认入库');
      expect(db.prepare('SELECT stock FROM products WHERE id=?').get(raw.id).stock).toBe(93);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await cleanup();
    }
  });
}
