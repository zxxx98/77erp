import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.js';

async function fixture(page) {
  const { app, db } = createApp(':memory:');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.request.post(base + '/api/auth/setup', { data: { username: 'owner', password: 'Strong-password-123' } });
  return { base, db, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}
async function capture(page, path) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path, fullPage: true });
}
async function choose(page, control, text) {
  await control.click();
  await page.getByRole('option', { name: text, exact: true }).click();
}
for (const width of [1440, 390, 320]) {
  test(`positions grant shared permissions and employee assignment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 640) await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }));
    const f = await fixture(page);
    try {
      await page.goto(f.base);
      if (width < 640) {
        await page.getByRole('button', { name: '更多', exact: true }).click();
        await page.getByRole('button', { name: '商户与仓库设置', exact: true }).click();
      } else await page.getByRole('button', { name: '系统设置', exact: true }).click();
      const nav = page.getByRole('navigation', { name: '设置分类' });
      await nav.getByRole('button', { name: /岗位配置/ }).click();
      await page.getByRole('button', { name: '新增岗位', exact: true }).click();
      let editor = page.getByRole('dialog', { name: '新增岗位', exact: true });
      await editor.getByLabel('岗位名称', { exact: true }).fill('仓管');
      await editor.getByRole('checkbox', { name: /^入库/ }).check();
      await editor.getByRole('checkbox', { name: /^出库/ }).check();
      await editor.getByRole('button', { name: '保存岗位', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.locator('.position-row').filter({ hasText: '仓管' })).toContainText('0 人');
      if (width < 640) {
        const targets = await page.locator('.position-actions button').evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
        expect(targets.every(target => target.width >= 44 && target.height >= 44)).toBe(true);
      }
      await capture(page, `test-results/positions-list-${width}.png`);
      await page.request.post(f.base + '/api/positions', { data: { name: '财务兼岗', permissions: ['finance'] } });
      await nav.getByRole('button', { name: /用户管理/ }).click();
      for (const username of ['staffone', 'stafftwo']) {
        await page.getByLabel('新账号', { exact: true }).fill(username);
        await page.getByLabel('初始密码', { exact: true }).fill('Employee-password-123');
        await page.getByRole('group', { name: '新账号岗位', exact: true }).getByRole('checkbox', { name: '仓管', exact: true }).check();
        await page.getByRole('group', { name: '新账号岗位', exact: true }).getByRole('checkbox', { name: '财务兼岗', exact: true }).check();
        await page.getByRole('button', { name: '新增账号', exact: true }).click();
        await expect(page.locator('.user-row').filter({ hasText: username })).toBeVisible();
      }
      const row = page.locator('.user-row').filter({ hasText: 'staffone' });
      await row.getByRole('button', { name: '查看权限', exact: true }).click();
      let details = page.getByRole('dialog', { name: 'staffone 的有效权限', exact: true });
      await expect(details.getByRole('checkbox')).toHaveCount(0);
      await expect(details).toContainText('入库');
      await expect(details).toContainText('出库');
      await expect(details).toContainText('财务管理');
      await expect(row.getByRole('button', { name: 'staffone的岗位', exact: true })).toContainText('仓管、财务兼岗');
      await details.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await nav.getByRole('button', { name: /岗位配置/ }).click();
      const position = page.locator('.position-row').filter({ hasText: '仓管' });
      await expect(position).toContainText('2 人');
      await expect(position.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
      await position.getByRole('button', { name: '编辑', exact: true }).click();
      editor = page.getByRole('dialog', { name: '编辑岗位：仓管', exact: true });
      await expect(editor).toContainText('2 名员工');
      await capture(page, `test-results/positions-editor-${width}.png`);
      await editor.getByRole('checkbox', { name: /^出库/ }).uncheck();
      await editor.getByRole('button', { name: '保存岗位', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await nav.getByRole('button', { name: /用户管理/ }).click();
      await page.locator('.user-row').filter({ hasText: 'stafftwo' }).getByRole('button', { name: '查看权限', exact: true }).click();
      details = page.getByRole('dialog', { name: 'stafftwo 的有效权限', exact: true });
      await expect(details.locator('.effective-permissions')).toContainText('入库');
      await expect(details.locator('.effective-permissions')).not.toContainText('出库');
      await details.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await row.getByRole('button', { name: 'staffone的岗位', exact: true }).click();
      const assignment = page.getByRole('dialog', { name: '调整 staffone 的岗位', exact: true });
      await expect(assignment.getByRole('checkbox', { name: '仓管', exact: true })).toBeChecked();
      await expect(assignment.getByRole('checkbox', { name: '财务兼岗', exact: true })).toBeChecked();
      await assignment.getByRole('checkbox', { name: '财务兼岗', exact: true }).uncheck();
      await expect(assignment.locator('.effective-permissions')).not.toContainText('财务管理');
      await assignment.getByRole('button', { name: '保存岗位', exact: true }).click();
      await expect(assignment).toHaveCount(0);
      await expect(row.getByRole('button', { name: 'staffone的岗位', exact: true })).toHaveText('仓管');
      const saved = (await (await page.request.get(f.base + '/api/users')).json()).find(user => user.username === 'staffone');
      expect(saved.position_names).toEqual(['仓管']);
      expect(saved.permissions).toEqual(['purchase']);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await capture(page, `test-results/positions-${width}.png`);
    } finally { await f.close(); }
  });
}


test('position conflicts preserve edits and legacy mode only converts after explicit confirmation', async ({ page }) => {
  const f = await fixture(page);
  try {
    const created = await (await page.request.post(f.base + '/api/positions', { data: { name: '迁移岗位', description: '', permissions: ['purchase'] } })).json();
    // Model a migrated compatibility position; API creation intentionally cannot enable this mode.
    f.db.prepare('UPDATE positions SET legacy_permissions=1 WHERE id=?').run(created.id);
    await page.goto(f.base);
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /岗位配置/ }).click();
    await page.locator('.position-row').filter({ hasText: '迁移岗位' }).getByRole('button', { name: '编辑', exact: true }).click();
    let editor = page.getByRole('dialog', { name: '编辑岗位：迁移岗位', exact: true });
    await expect(editor.getByRole('checkbox', { name: /^入库/ })).toBeDisabled();
    await editor.getByLabel('岗位名称', { exact: true }).fill('保留旧限制');
    await page.request.put(f.base + `/api/positions/${created.id}`, { data: { name: '迁移岗位', description: '其他管理员修改', permissions: ['purchase'], version: created.version } });
    await editor.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(editor.getByRole('alert')).toBeVisible();
    await expect(editor.getByLabel('岗位名称', { exact: true })).toHaveValue('保留旧限制');
    await editor.getByRole('button', { name: '刷新版本并保留输入', exact: true }).click();
    await expect(editor.getByRole('status')).toContainText('编辑内容已保留');
    await editor.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(editor).toHaveCount(0);
    let saved = (await (await page.request.get(f.base + '/api/positions')).json()).find(row => row.id === created.id);
    expect(saved.legacy_permissions).toBe(true);
    await page.locator('.position-row').filter({ hasText: '保留旧限制' }).getByRole('button', { name: '编辑', exact: true }).click();
    editor = page.getByRole('dialog', { name: '编辑岗位：保留旧限制', exact: true });
    page.once('dialog', dialog => dialog.dismiss());
    await editor.getByRole('checkbox', { name: '我确认切换为标准模块权限', exact: true }).click();
    await expect(editor.getByRole('checkbox', { name: /^入库/ })).toBeDisabled();
    page.once('dialog', dialog => dialog.accept());
    await editor.getByRole('checkbox', { name: '我确认切换为标准模块权限', exact: true }).click();
    await editor.getByRole('checkbox', { name: /^出库/ }).check();
    await editor.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(editor).toHaveCount(0);
    saved = (await (await page.request.get(f.base + '/api/positions')).json()).find(row => row.id === created.id);
    expect(saved.legacy_permissions).toBe(false);
    expect(saved.permissions).toEqual(['purchase', 'sale']);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.position-row').filter({ hasText: '保留旧限制' }).getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.locator('.position-row').filter({ hasText: '保留旧限制' })).toHaveCount(0);
    expect((await (await page.request.get(f.base + '/api/positions')).json()).some(row => row.id === created.id)).toBe(false);
  } finally { await f.close(); }
});


test('administrator downgrade requires a selected position and employee reassignment retains choices on conflict', async ({ page }) => {
  const f = await fixture(page);
  try {
    const positions = await (await page.request.get(f.base + '/api/positions')).json();
    const readonly = positions.find(position => position.name === '只读员工');
    const second = await (await page.request.post(f.base + '/api/positions', { data: { name: '财务', description: '', permissions: ['finance'] } })).json();
    await (await page.request.post(f.base + '/api/users', { data: { username: 'secondadmin', password: 'Strong-password-123', role: 'admin' } })).json();
    await page.goto(f.base);
    await page.getByRole('button', { name: '系统设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /用户管理/ }).click();
    const row = page.locator('.user-row').filter({ hasText: 'secondadmin' });
    await choose(page, row.getByRole('combobox', { name: 'secondadmin的角色', exact: true }), '员工');
    let dialog = page.getByRole('dialog', { name: '将 secondadmin 改为员工', exact: true });
    expect(f.db.prepare('SELECT role FROM users WHERE username=?').get('secondadmin').role).toBe('admin');
    await dialog.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('请选择员工岗位');
    await dialog.getByRole('checkbox', { name: readonly.name, exact: true }).check();
    await dialog.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await row.getByRole('button', { name: 'secondadmin的岗位', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '调整 secondadmin 的岗位', exact: true });
    await dialog.getByRole('checkbox', { name: '财务', exact: true }).check();
    const employee = (await (await page.request.get(f.base + '/api/users')).json()).find(user => user.username === 'secondadmin');
    await page.request.put(f.base + `/api/users/${employee.id}/position`, { data: { position_id: second.id, version: employee.permissions_version } });
    await dialog.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: '刷新版本并保留选择', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('岗位选择已保留');
    await expect(dialog.getByRole('checkbox', { name: readonly.name, exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: '财务', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: '保存岗位', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(f.db.prepare('SELECT position_id FROM user_positions WHERE user_id=? ORDER BY position_id').all(employee.id).map(row => row.position_id)).toEqual([readonly.id,second.id]);
  } finally { await f.close(); }
});
