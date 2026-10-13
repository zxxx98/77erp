import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';

test('two users keep conflicting edits, compare the latest product and explicitly reload before saving', async ({ page, browser }) => {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    expect((await page.request.post(base + '/api/auth/setup', { data: { username: 'owner', password: 'Test-password-123' } })).status()).toBe(201);
    expect((await page.request.post(base + '/api/users', { data: { username: 'staff', password: 'Test-password-123', role: 'employee' } })).status()).toBe(201);
    db.prepare("UPDATE users SET permissions='[\"products\"]' WHERE username='staff'").run();
    const created = await page.request.post(base + '/api/products', { data: {
      name: '并发编辑商品', barcode: 'BROWSER-VERSION-001', category: '日用', unit: '件', cost: 10, price: 20, threshold: 5,
    } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    expect((await context.request.post(base + '/api/auth/login', { data: { username: 'staff', password: 'Test-password-123' } })).ok()).toBe(true);
    const other = await context.newPage();
    for (const editor of [page, other]) {
      await editor.goto(base + '/#products');
      await editor.getByRole('textbox', { name: '筛选商品' }).fill('并发编辑商品');
      await editor.getByRole('button', { name: '编辑', exact: true }).click();
    }
    await page.getByRole('spinbutton', { name: /销售价/ }).fill('42');
    await other.getByRole('textbox', { name: '商品备注' }).fill('员工填写内容\n需要保留');
    await other.getByRole('spinbutton', { name: /销售价/ }).fill('35');
    await page.getByRole('button', { name: '保存商品', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await other.getByRole('button', { name: '保存商品', exact: true }).click();
    await expect(other.getByRole('alert')).toContainText('商品信息已被修改');
    await expect(other.getByRole('textbox', { name: '商品备注' })).toHaveValue('员工填写内容\n需要保留');
    await expect(other.getByRole('spinbutton', { name: /销售价/ })).toHaveValue('35');
    await expect(other.getByRole('button', { name: '保存商品', exact: true })).toBeDisabled();
    await other.getByRole('button', { name: '查看最新信息', exact: true }).click();
    const price = other.locator('.product-conflict dl > div').filter({ hasText: '销售价' });
    await expect(price).toContainText('35');
    await expect(price).toContainText('42');
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    other.once('dialog', dialog => dialog.dismiss());
    await other.getByRole('button', { name: '使用最新信息重新编辑', exact: true }).click();
    await expect(other.getByRole('textbox', { name: '商品备注' })).toHaveValue('员工填写内容\n需要保留');
    await expect(other.getByRole('button', { name: '保存商品', exact: true })).toBeDisabled();
    other.once('dialog', dialog => dialog.accept());
    await other.getByRole('button', { name: '使用最新信息重新编辑', exact: true }).click();
    await expect(other.getByRole('spinbutton', { name: /销售价/ })).toHaveValue('42');
    await expect(other.getByRole('button', { name: '保存商品', exact: true })).toBeEnabled();
    await other.getByRole('textbox', { name: '商品备注' }).fill('核对后补充备注');
    await other.getByRole('button', { name: '保存商品', exact: true }).click();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    const saved = await (await page.request.get(base + '/api/products/barcode/BROWSER-VERSION-001')).json();
    expect(saved.id).toBe(id);
    expect(saved.price).toBe(42);
    expect(saved.note).toBe('核对后补充备注');
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
