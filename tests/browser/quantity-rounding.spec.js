import { test, expect, devices } from '@playwright/test';
import { chooseOption } from './dropdown-helpers.js';
import { ensureContact, chooseContact } from './contact-helpers.js';

for (const device of ['desktop', 'mobile']) test(`${device} edits whole-unit material and posts rounded order quantities`, async ({ browser }) => {
  const context = await browser.newContext({ ...(device === 'mobile' ? devices['Pixel 7'] : {}), baseURL: 'http://127.0.0.1:3199', serviceWorkers: 'block' });
  try {
    await context.request.post('/api/auth/setup', { data: { username: 'admin', password: 'Test-admin-123' } });
    expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'Test-admin-123' } })).ok()).toBe(true);
    const workspace = await (await context.request.get('/api/data')).json();
    const name = `整箱-${device}-${Date.now()}`;
    const page = await context.newPage();
    await page.goto('/#products');
    await page.getByRole('button', { name: '新增物料', exact: true }).first().click();
    const form = page.getByRole('dialog', { name: '新增物料', exact: true });
    await form.getByRole('textbox', { name: /物料名称/ }).fill(name);
    await chooseOption(form.getByRole('combobox', { name: '物料分类' }), String(workspace.categories[0].id));
    await form.getByRole('checkbox', { name: /单位是否取整/ }).check();
    await form.getByRole('spinbutton', { name: /参考采购价/ }).fill('2');
    await form.getByRole('spinbutton', { name: /参考销售价/ }).fill('3');
    await form.getByRole('button', { name: '保存物料', exact: true }).click();
    await expect(form).toHaveCount(0);
    const result = await (await context.request.get(`/api/products?q=${encodeURIComponent(name)}`)).json();
    const product = result.products.find(p => p.name === name);
    expect(product.unit_round_up).toBe(1);
    await ensureContact(context.request, name + '供应商');
    await page.goto('/#overview');
    await page.getByRole('button', { name: '采购入库', exact: true }).first().click();
    await chooseContact(page, name + '供应商');
    const order = page.getByRole('dialog').first();
    const search = device === 'mobile' ? page.getByRole('searchbox', { name: '搜索要添加的物料或条码' }) : order.getByPlaceholder('或搜索物料名称，点击添加');
    await search.fill(name);
    await order.getByRole('button', { name: new RegExp(name) }).first().click();
    const quantity = page.getByRole('spinbutton', { name: `${name} 数量` });
    await quantity.fill('4.1');
    await quantity.blur();
    await expect(quantity).toHaveValue('5');
    await page.getByRole('button', { name: '确认入库', exact: true }).click();
    if (device === 'mobile') await page.getByRole('button', { name: '确认提交', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await (await context.request.get(`/api/products/${product.id}`)).json();
    expect(saved.product.stock).toBe(5);
  } finally { await context.close(); }
});
