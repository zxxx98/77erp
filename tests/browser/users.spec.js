import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const setup = await page.request.post(base + '/api/auth/setup', { data: { username: 'owner', password: 'Strong-password-123' } });
  const cookie = setup.headers()['set-cookie'].split(';')[0];
  const adminRequest = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetch(base + '/api' + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return r.json();
  };
  return { base, db, adminRequest, close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); } };
}

async function login(page, username, password) {
  await expect(page.getByRole('heading', { name: '账号登录', exact: true })).toBeVisible();
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
}

test('administrator creates accounts, protects the last administrator, resets passwords and disables employees in the UI', async ({ page }) => {
  const f = await fixture(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(f.base);
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('button', { name: /用户管理/ }).click();
    const owner = page.locator('.user-row').filter({ hasText: 'owner' });
    page.once('dialog', d => d.accept());
    await owner.getByRole('button', { name: '停用', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('最后一个管理员');
    await page.getByLabel('新账号', { exact: true }).fill('staff');
    await page.getByLabel('初始密码', { exact: true }).fill('Employee-password-123');
    await page.getByRole('button', { name: '新增账号', exact: true }).click();
    const employee = page.locator('.user-row').filter({ hasText: 'staff' });
    await expect(employee).toBeVisible();
    await employee.getByRole('button', { name: '重置密码', exact: true }).click();
    await page.getByLabel('重置后的密码', { exact: true }).fill('Reset-password-456');
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '确认重置密码', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('密码已重置');
    page.once('dialog', d => d.accept());
    await employee.getByRole('button', { name: '停用', exact: true }).click();
    await expect(employee).toContainText('已停用');
    page.once('dialog', d => d.accept());
    await employee.getByRole('button', { name: '启用', exact: true }).click();
    await expect(employee).toContainText('正常');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page, 'staff', 'Reset-password-456');
    await expect(page.getByRole('button', { name: '系统设置', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('employee sees shared business data and own templates, opens orders with an actor, and changes password', async ({ page }) => {
  const f = await fixture(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await f.adminRequest('/users', { username: 'staff', password: 'Employee-password-123' });
    // Existing employees keep their former product, order and own-template access.
    f.db.prepare("UPDATE users SET permissions=NULL WHERE username='staff'").run();
    await f.adminRequest('/templates', { name: '管理员模板', request_id: 'admin-template', type: 'in', partner: '管理员模板', note: '', items: [{product_id: 1, quantity: 1, price: 10}] });
    await page.goto(f.base);
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page, 'staff', 'Employee-password-123');
    await expect(page.locator('.user-profile')).toContainText('员工');
    await page.getByRole('link', { name: '物料管理', exact: true }).click();
    await expect(page.getByRole('button', { name: '新增物料', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '管理分类', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '业务管理', exact: true }).click();
    await page.getByRole('button', { name: '单据模板', exact: true }).click();
    await expect(page.getByText('管理员模板')).toHaveCount(0);
    await expect(page.getByText('暂无模板')).toBeVisible();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('link', { name: '采购入库', exact: true }).click();
    await page.getByRole('button', { name: '新建入库', exact: true }).click();
    await page.getByPlaceholder('选择或输入供应商').fill('员工供应商');
    await page.getByRole('textbox', { name: '查找并添加物料' }).fill('马克杯');
    await page.locator('.picker-results button').first().click();
    await page.getByLabel('模板名称', {exact: true}).fill('员工补货模板');
    await page.getByRole('button', { name: '保存为模板', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('员工补货模板');
    await page.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const template = f.db.prepare("SELECT * FROM templates WHERE created_by_name='staff'").get();
    await page.getByRole('button', { name: '业务管理', exact: true }).click();
    await page.getByRole('button', { name: '单据模板', exact: true }).click();
    await page.getByRole('button', { name: `使用模板 #${template.id}`, exact: true }).click();
    await page.getByRole('button', { name: '确认入库', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const order = f.db.prepare("SELECT * FROM orders WHERE created_by_name='staff'").get();
    await page.getByText(order.number, { exact: true }).click();
    await expect(page.getByText('开单人：staff', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '登记收付款', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '作废单据', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.getByRole('button', { name: '账户设置', exact: true }).click();
    await page.getByLabel('当前密码', { exact: true }).fill('Employee-password-123');
    await page.getByLabel('新密码', { exact: true }).fill('Changed-password-789');
    await page.getByLabel('确认新密码', { exact: true }).fill('different');
    await page.getByRole('button', { name: '确认修改密码', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('两次输入的密码不一致');
    await page.getByLabel('确认新密码', { exact: true }).fill('Changed-password-789');
    await page.getByRole('button', { name: '确认修改密码', exact: true }).click();
    await login(page, 'staff', 'Changed-password-789');
    expect(errors).toEqual([]);
  } finally { await f.close(); }
});

test('administrator configures nine employee modules and changes take effect in an existing employee session', async ({ page, browser }) => {
  const f = await fixture(page);
  const context = await browser.newContext();
  const employeePage = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  employeePage.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(f.base);
    await expect(page.getByRole('button', { name: '业务管理', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '业务管理', exact: true }).click();
    for (const name of ['供应商与客户', '单据模板', '收付款与欠款', '成本与毛利', '库存盘点', '批量导入'])
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '备份与恢复', exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    const settingsNav = page.getByRole('navigation', { name: '设置分类' });
    await expect(settingsNav.getByRole('button', { name: /备份与恢复/ })).toBeVisible();
    await expect(settingsNav.getByRole('button', { name: /往来与财务|库存与数据|批量导入|库存盘点/ })).toHaveCount(0);
    await page.getByRole('button', { name: /用户管理/ }).click();
    await page.getByLabel('新账号', { exact: true }).fill('staff');
    await page.getByLabel('初始密码', { exact: true }).fill('Employee-password-123');
    await page.getByRole('button', { name: '新增账号', exact: true }).click();
    const row = page.locator('.user-row').filter({ hasText: 'staff' });
    await expect(row).toBeVisible();
    await expect(page.locator('.user-row').filter({ hasText: 'owner' }).getByRole('button', { name: '权限配置' })).toHaveCount(0);
    await employeePage.goto(f.base);
    await login(employeePage, 'staff', 'Employee-password-123');
    await employeePage.getByRole('link', { name: '物料管理', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '新增物料', exact: true })).toHaveCount(0);
    await expect(employeePage.getByRole('button', { name: '业务管理', exact: true })).toBeVisible();
    await employeePage.getByRole('button', { name: '业务管理', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '单据模板', exact: true })).toBeVisible();
    for (const name of ['供应商与客户', '收付款与欠款', '成本与毛利', '库存盘点', '批量导入'])
      await expect(employeePage.getByRole('button', { name, exact: true })).toHaveCount(0);
    await employeePage.getByRole('button', { name: '关闭弹窗', exact: true }).click();

    await row.getByRole('button', { name: '权限配置' }).click();
    let dialog = page.getByRole('dialog', { name: 'staff 的权限配置', exact: true });
    await expect(dialog.getByRole('checkbox')).toHaveCount(9);
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await dialog.getByRole('checkbox', { name: /^物料管理/ }).check();
    await dialog.getByRole('button', { name: '保存权限' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('立即生效');
    await employeePage.reload();
    await expect(employeePage.getByRole('button', { name: '新增物料', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '管理分类', exact: true })).toBeVisible();
    await employeePage.getByRole('link', { name: '采购入库', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '新建入库', exact: true })).toHaveCount(0);
    await expect(employeePage.getByRole('button', { name: '导出单据', exact: true })).toHaveCount(0);

    await row.getByRole('button', { name: '权限配置' }).click();
    dialog = page.getByRole('dialog', { name: 'staff 的权限配置', exact: true });
    await dialog.getByRole('checkbox', { name: /^物料管理/ }).uncheck();
    for (const name of ['采购入库', '业务资料管理', '库存盘点', '财务管理', '数据导入导出'])
      await dialog.getByRole('checkbox', { name: new RegExp('^' + name) }).check();
    await dialog.getByRole('button', { name: '保存权限' }).click();
    await expect(dialog).toHaveCount(0);
    await employeePage.reload();
    await expect(employeePage.getByRole('button', { name: '新建入库', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '导出单据', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '系统设置', exact: true })).toHaveCount(0);
    await employeePage.getByRole('link', { name: '物料管理', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '新增物料', exact: true })).toHaveCount(0);
    await employeePage.getByRole('button', { name: '业务管理', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '供应商与客户', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '收付款与欠款', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '库存盘点', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '批量导入', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '备份与恢复', exact: true })).toHaveCount(0);
    await employeePage.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await employeePage.getByRole('link', { name: '扫码工作台', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '扫码入库', exact: true })).toBeVisible();
    await expect(employeePage.getByRole('button', { name: '扫码出库', exact: true })).toBeHidden();
    await expect(employeePage.getByRole('button', { name: '管理出入库二维码', exact: true })).toBeVisible();
    await employeePage.getByRole('button', { name: '账户设置', exact: true }).click();
    await expect(employeePage.getByRole('button', { name: '确认修改密码', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); await f.close(); }
});
