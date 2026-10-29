import { productionAction, adjustUsage, submitProductionBatch } from './production-ui-helpers.js';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';
import { randomUUID } from 'node:crypto';

async function fixture(page, accessMode = 'production_only') {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => { const response = await page.request.post(base + '/api' + path, { data: { request_id: randomUUID(), ...data } }); const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true); return result; };
  await post('/auth/setup', { username: 'owner', password: 'Strong-password-123' });
  await post('/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const group = await post('/production-groups', { name: '装配一组', description: '装配登记' });
  const second = await post('/production-groups', { name: '装配二组' });
  const position = await post('/positions', { name: '仅生产岗位', access_mode: accessMode, permissions: ['production_register'] });
  const worker = await post('/users', { username: 'worker', password: 'Worker-password-123', role: 'employee', position_id: position.id, production_group_id: group.id });
  const products = [];
  for (const [name, barcode] of [['组内成品', 'GROUP-FINISH'], ['登记材料', 'GROUP-MATERIAL']]) products.push(await post('/products', { name, barcode, unit: '件', category: '生产', cost: 1, price: 2, threshold: 0 }));
  const bom = await post('/boms', { name: '小组配方', product_id: products[0].id, base_quantity: 1, base_unit: '件', note: '', enabled: 1, items: [{ product_id: products[1].id, quantity: 1, unit: '件', note: '' }] });
  const prepare = await post('/production-orders/prepare', { bom_id: bom.id, bom_version: bom.version, schema_version: 2, planned_quantity: 3 });
  let order = await post('/production-orders', { bom_id: bom.id, bom_version: bom.version, schema_version: 2, planned_quantity: 3, structure_token: prepare.structure_token, note: '', production_group_id: group.id });
  db.prepare('UPDATE products SET stock=30,inventory_value_cents=3000 WHERE id=?').run(products[1].id);
  const started = await post(`/production-orders/${order.id}/start`, { version: order.version, schema_version: 2 });
  const doc = started.material_documents[0];
  await post(`/production-material-documents/${doc.id}/confirm`, { version: doc.version });
  order = await (await page.request.get(base + `/api/production-orders/${order.id}`)).json();
  await post('/auth/logout', {}); await post('/auth/login', { username: 'worker', password: 'Worker-password-123' });
  return { base, db, worker, group, second, order, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}
for (const accessMode of ['standard', 'production_only']) for (const {width, pwa} of [{width:1440}, {width:390}, {width:390,pwa:true}]) test.describe(`production groups ${accessMode} ${width}${pwa ? ' PWA' : ''}`, () => {
  test.use({ serviceWorkers: pwa ? 'allow' : 'block' });
  test(`production-only shell isolates navigation and clears dirty views at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  if (width < 640) await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }));
  const f = await fixture(page, accessMode), errors = [], businessRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (/\/api\/(dashboard|announcements|products|ai|orders)(?:[/?]|$)/.test(request.url())) businessRequests.push(request.url()); });
  try {
    await page.goto(f.base + '/?manage=data#products');
    if (pwa) await page.evaluate(() => navigator.serviceWorker.ready);
    await expect(page.getByText('77 ERP · 仅生产作业', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    for (const name of ['新建生产单', '系统设置', 'AI 助手', '打开扫码工作台', '公告中心']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
    await expect(page.getByText('生产小组：装配一组', { exact: true })).toBeVisible();
    for (const name of ['编辑草稿', '开始生产', '结束生产', '申请补料', '申请退料', '派工']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '登记', exact: true }).click();
    await page.getByLabel('本次数量', { exact: true }).fill('2');
    await adjustUsage(page);
    await expect(page.getByRole('button', { name: '提交登记', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '本批登记并结束生产', exact: true })).toHaveCount(0);
    await submitProductionBatch(page);
    await expect(page.getByText('生产中', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '完工与入库', exact: true }).click();
    await expect(page.locator('.production-batches')).toContainText('登记人：worker');
    await page.getByRole('button', { name: '登记', exact: true }).click();
    await page.getByLabel('本次数量', { exact: true }).fill('0.5');
    await adjustUsage(page);
    await page.screenshot({ path: test.info().outputPath(`production-only-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Simulate membership revocation while a form is dirty; focus refresh must remount it without asking to preserve stale edits.
    f.db.prepare('UPDATE users SET production_group_id=?,permissions_version=permissions_version+1 WHERE id=?').run(f.second.id, f.worker.id);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByLabel('本次数量', { exact: true })).toHaveCount(0);
    await expect(page.getByText('暂无派给本组或本人的生产单。', { exact: true })).toBeVisible();
    expect(businessRequests).toEqual([]); expect(errors).toEqual([]);
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    await expect(page.getByRole('heading', { name: '修改密码', exact: true })).toBeVisible();
  } finally { await f.close(); }
});




});

async function choose(page, control, name) { await control.click(); await page.getByRole('option', { name, exact: true }).click(); }
test('admin configures groups, strict positions, optional employee membership and dispatch', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.request.post(f.base + '/api/auth/logout');
    await page.request.post(f.base + '/api/auth/login', { data: { username: 'owner', password: 'Strong-password-123' } });
    await page.goto(f.base);
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    const nav = page.getByRole('navigation', { name: '设置分类' });
    await nav.getByRole('button', { name: /生产小组/ }).click();
    await page.getByRole('button', { name: '新增生产小组', exact: true }).click();
    await page.getByLabel('小组名称', { exact: true }).fill('新装配组');
    await page.getByRole('button', { name: '保存小组', exact: true }).click();
    await expect(page.getByRole('cell', { name: '新装配组', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: /岗位配置/ }).click();
    await page.getByRole('button', { name: '新增岗位', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '新增岗位', exact: true });
    await editor.getByLabel('岗位名称', { exact: true }).fill('新增登记岗位');
    await choose(page, editor.getByRole('combobox', { name: '访问模式', exact: true }), '仅生产作业');
    const checks = editor.getByRole('checkbox');
    for (const check of await checks.all()) await expect(check).toBeDisabled();
    await expect(editor.getByRole('checkbox', { name: /^本组生产登记/ })).toBeChecked();
    await editor.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await nav.getByRole('button', { name: /用户管理/ }).click();
    await page.getByLabel('新账号', { exact: true }).fill('newworker');
    await page.getByLabel('初始密码', { exact: true }).fill('Worker-password-123');
    await page.getByRole('group', { name: '新账号岗位', exact: true }).getByRole('checkbox', { name: '新增登记岗位', exact: true }).check();
    await page.getByRole('button', { name: '新增账号', exact: true }).click();
    const row = page.locator('.user-row').filter({ hasText: 'newworker' });
    await expect(row).toBeVisible();
    await choose(page, row.getByRole('combobox', { name: 'newworker的生产小组', exact: true }), '新装配组');
    await expect(row).toContainText('新装配组');
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).first().click();
    // Drafts support multiple assignment targets.
    const prep = await (await page.request.post(f.base + '/api/production-orders/prepare', { data: { bom_id: f.order.bom_id, bom_version: f.order.bom_version, schema_version: 2, planned_quantity: 2 } })).json();
    const draftResponse = await page.request.post(f.base + '/api/production-orders', { data: { request_id: randomUUID(), bom_id: f.order.bom_id, bom_version: prep.version, schema_version: 2, planned_quantity: 2, structure_token: prep.structure_token, note: '' } });
    expect(draftResponse.ok()).toBe(true); const draft = await draftResponse.json();
    await page.goto(f.base + '/#production');
    await page.getByRole('button', { name: `查看生产单 ${draft.number}`, exact: true }).click();
    await page.getByText('生产指派', { exact: true }).click();
    await page.getByRole('checkbox', { name: '新装配组', exact: true }).check();
    await page.getByRole('button', { name: '派工', exact: true }).click();
    await expect(page.getByText('生产小组：新装配组', { exact: true })).toBeVisible();
  } finally { await f.close(); }
});

for (const width of [1440, 390]) test(`basic page grants and revocations switch the standard workspace at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  if (width < 640) await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }));
  const f = await fixture(page, 'standard');
  const setPermissions = permissions => {
    f.db.prepare('UPDATE positions SET permissions=?,version=version+1 WHERE id=(SELECT position_id FROM users WHERE id=?)').run(JSON.stringify(permissions), f.worker.id);
    f.db.prepare('UPDATE users SET permissions_version=permissions_version+1 WHERE id=?').run(f.worker.id);
  };
  try {
    setPermissions(['basic_view', 'production_register']);
    await page.goto(f.base + '/#products');
    await expect(page.getByRole('heading', { name: '物料管理', exact: true })).toBeVisible();
    await expect(page.locator('.production-only-shell')).toHaveCount(0);
    setPermissions(['production_register']);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.production-only-shell')).toBeVisible();
    await expect(page.getByRole('heading', { name: '生产单', exact: true })).toBeVisible();
    expect((await page.request.get(f.base + '/api/products')).status()).toBe(403);
    setPermissions(['basic_view', 'production_register']);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.production-only-shell')).toHaveCount(0);
    await page.goto(f.base + '/#products');
    await expect(page.getByRole('heading', { name: '物料管理', exact: true })).toBeVisible();
    expect((await page.request.get(f.base + '/api/products')).status()).toBe(200);
  } finally { await f.close(); }
});


for (const {width, pwa} of [{width:1440}, {width:390}, {width:390,pwa:true}]) test.describe(`multiple production assignments ${width}${pwa ? ' PWA' : ''}`, () => {
  test.use({ serviceWorkers: pwa ? 'allow' : 'block' });
  test('management appends groups and an ungrouped person after production has started', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 640) await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }));
    const f = await fixture(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.request.post(f.base + '/api/auth/logout');
      await page.request.post(f.base + '/api/auth/login', { data: { username: 'owner', password: 'Strong-password-123' } });
      const post = async (path, data) => {
        const response = await page.request.post(f.base + '/api' + path, { data: { request_id: randomUUID(), ...data } });
        expect(response.ok(), await response.text()).toBe(true); return response.json();
      };
      const position = await post('/positions', { name: '个人生产登记', access_mode: 'production_only', permissions: ['production_register'] });
      const individual = await post('/users', { username: 'individual', name: '个人工人', password: 'Worker-password-123', role: 'employee', position_id: position.id });
      await page.goto(f.base + '/#production');
      if (pwa) await page.evaluate(() => navigator.serviceWorker.ready);
      await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
      await page.getByText('生产指派', { exact: true }).click();
      await expect(page.getByText('生产已开始，可追加多个生产组或个人，已有指派将保留。', { exact: true })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: '装配一组', exact: true })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: '装配一组', exact: true })).toBeDisabled();
      await page.getByRole('checkbox', { name: '装配二组', exact: true }).check();
      await page.getByRole('checkbox', { name: '个人工人', exact: true }).check();
      await page.getByRole('button', { name: '派工', exact: true }).click();
      await expect(page.getByText('生产小组：装配一组、装配二组', { exact: true })).toBeVisible();
      await expect(page.getByText('指派人员：个人工人', { exact: true })).toBeVisible();
      const order = await (await page.request.get(f.base + `/api/production-orders/${f.order.id}`)).json();
      expect(order.assigned_users.map(user => user.id)).toEqual([individual.id]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.request.post(f.base + '/api/auth/logout');
      await page.request.post(f.base + '/api/auth/login', { data: { username: 'individual', password: 'Worker-password-123' } });
      await page.goto(f.base + '/#production');
      await page.getByRole('button', { name: `查看生产单 ${f.order.number}`, exact: true }).click();
      await expect(page.getByText('指派人员：个人工人', { exact: true })).toBeVisible();
      await expect(page.getByText('生产指派', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '登记', exact: true }).click();
      await expect(page.getByLabel('本次数量', { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await f.close(); }
  });
});
