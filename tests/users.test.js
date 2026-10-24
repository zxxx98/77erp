import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const password = 'Strong-password-123';
async function fixture(t, path = ':memory:') {
  const { app, db } = createApp(path);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); });
  const request = async (cookie, path, body, method = body === undefined ? 'GET' : 'POST', warehouse = 1) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Warehouse-ID': String(warehouse), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  let admin = (await request(null, '/auth/setup', { username: 'owner', password })).cookie;
  // Existing database fixtures have already initialized the owner.
  if (!admin) admin = (await request(null, '/auth/login', { username: 'owner', password })).cookie;
  const user = async (username, role = 'employee') => {
    const created = await request(admin, '/users', { username, password, role });
    assert.equal(created.status, 201);
    // Exercise upgraded employees with their original capabilities in the legacy regression cases.
    db.prepare('UPDATE users SET permissions=NULL WHERE id=?').run(created.data.id);
    const login = await request(null, '/auth/login', { username, password });
    assert.equal(login.status, 200);
    return { id: created.data.id, cookie: login.cookie, username };
  };
  const command = (cookie, path, body, warehouse) => request(cookie, path, { request_id: randomUUID(), ...body }, 'POST', warehouse);
  return { db, request, admin, user, command };
}
const product = { name: '协作物料', barcode: 'TEAM-001', category: '日用', unit: '件', cost: 10, price: 20, threshold: 0 };
const templateBody = { name: '常用补货', type: 'in', partner: '供应商', note: '', items: [{ product_id: 1, quantity: 2, price: 10 }] };

test('employees share warehouses and prices, can edit products and open orders, but cannot call management APIs', async t => {
  const f = await fixture(t), employee = await f.user('staff');
  await f.request(f.admin, '/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  const warehouse = (await f.request(f.admin, '/warehouses', { name: '分仓' })).data.id;
  assert.equal((await f.request(employee.cookie, '/warehouses')).data.length, 2);
  const created = await f.request(employee.cookie, '/products', { ...product, sync_warehouse_ids: [warehouse] });
  assert.equal(created.status, 201);
  assert.equal((await f.request(employee.cookie, `/products/${created.data.id}`, { ...product, version: created.data.version, name: '已编辑' }, 'PUT')).status, 200);
  const order = await f.command(employee.cookie, '/orders', { ...templateBody, items: [{ product_id: created.data.id, quantity: 2, price: 10 }] });
  assert.equal(order.status, 201);
  const data = (await f.request(employee.cookie, '/data')).data;
  assert.equal(data.products[0].cost, 10);
  assert.equal(data.orders[0].created_by, employee.id);
  assert.equal(data.orders[0].created_by_name, 'staff');
  for (const [path, method] of [
    ['/users', 'GET'], ['/users', 'POST'], ['/users/1', 'PUT'], ['/users/1/password', 'POST'],
    ['/settings', 'PUT'], ['/settings/reset', 'POST'], ['/warehouses', 'POST'], ['/warehouses/1', 'PUT'],
    ['/categories', 'POST'], ['/categories/1', 'PUT'], ['/categories/1/delete', 'POST'], ['/contacts', 'POST'],
    ['/finance', 'GET'], ['/reports/profit', 'GET'], ['/backup', 'GET'], ['/backup/preview', 'POST'], ['/backup/restore', 'POST'],
    ['/products/import/preview', 'POST'], ['/products/import', 'POST'], ['/stocktakes', 'POST'], ['/stock-adjustments', 'GET'],
    [`/orders/${order.data.id}/void`, 'POST'], [`/orders/${order.data.id}/returns`, 'POST'],
    [`/orders/${order.data.id}/payments`, 'GET'], [`/orders/${order.data.id}/payments`, 'POST'],
    [`/orders/${order.data.id}/settlement`, 'POST'], ['/payments/1/reverse', 'POST'],
    ['/BACKUP/', 'GET'], ['/SETTINGS/RESET/', 'POST'],
  ]) assert.equal((await f.request(employee.cookie, path, method === 'GET' ? undefined : {}, method)).status, 403, path);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(created.data.id).stock, 2);
});

test('template ownership is enforced for listing, editing and deleting; administrators can manage all templates', async t => {
  const f = await fixture(t), a = await f.user('alice'), b = await f.user('bobby');
  const created = await f.command(a.cookie, '/templates', { ...templateBody, created_by: b.id });
  const own = created.data;
  assert.equal(own.created_by, a.id);
  await f.command(b.cookie, '/templates', templateBody);
  await f.command(f.admin, '/templates', templateBody);
  assert.equal((await f.request(a.cookie, '/templates')).data.length, 1);
  assert.equal((await f.request(f.admin, '/templates')).data.length, 3);
  for (const path of ['/templates', `/templates/${own.id}/delete`]) {
    const body = path === '/templates' ? { ...templateBody, id: own.id, version: own.version } :
      { version: own.version };
    assert.equal((await f.command(b.cookie, path, body)).status, 404);
  }
  assert.equal(f.db.prepare('SELECT version FROM templates WHERE id=?').get(own.id).version, 1);
  const edited = await f.command(a.cookie, '/templates', { ...templateBody, id: own.id, version: own.version, note: '继续' });
  assert.equal(edited.status, 200);
  assert.equal((await f.command(a.cookie, '/templates', { ...templateBody, id: own.id, version: own.version })).status, 400);
  const body = { ...templateBody, request_id: randomUUID() };
  const order = await f.request(a.cookie, '/orders', body);
  assert.equal(order.status, 201);
  assert.equal((await f.request(a.cookie, '/orders', body)).data.id, order.data.id);
  assert.equal((await f.request(b.cookie, '/orders', body)).status, 201);
  assert.equal((await f.request(a.cookie, '/templates')).data.length, 1);
  assert.equal((await f.command(f.admin, '/templates', { ...templateBody, id: 2, version: 1 })).status, 200);
  assert.equal((await f.command(f.admin, '/templates/2/delete', { version: 2 })).status, 200);
});

test('account management hides secrets, revokes sessions, protects the last active admin, and preserves accounts on reset', async t => {
  const f = await fixture(t), employee = await f.user('staff');
  const list = await f.request(f.admin, '/users');
  assert.equal(list.data.length, 2);
  assert.equal(list.data[0].password_hash, undefined);
  assert.equal((await f.request(f.admin, '/users', { username: 'staff', password })).status, 409);
  assert.equal((await f.request(f.admin, '/users', { username: 'bad space', password })).status, 400);
  assert.equal((await f.request(f.admin, '/users', { username: 'another', password: 'short' })).status, 400);
  assert.equal((await f.request(f.admin, '/users/1', { role: 'employee', active: 1 }, 'PUT')).status, 409);
  assert.equal((await f.request(f.admin, '/users/1', { role: 'admin', active: 0 }, 'PUT')).status, 409);
  assert.equal((await f.request(f.admin, `/users/${employee.id}`, { role: 'employee', active: 0 }, 'PUT')).status, 200);
  assert.equal((await f.request(employee.cookie, '/data')).status, 401);
  assert.equal((await f.request(null, '/auth/login', { username: 'staff', password })).status, 401);
  await f.request(f.admin, `/users/${employee.id}`, { role: 'employee', active: 1 }, 'PUT');
  const login = await f.request(null, '/auth/login', { username: 'staff', password });
  await f.request(f.admin, `/users/${employee.id}`, { role: 'admin', active: 1 }, 'PUT');
  assert.equal((await f.request(login.cookie, '/data')).status, 401);
  const promoted = await f.request(null, '/auth/login', { username: 'staff', password });
  assert.equal(promoted.data.role, 'admin');
  assert.equal((await f.request(promoted.cookie, '/users')).status, 200);
  // Concurrent requests still cannot remove all active administrators.
  const changes = await Promise.all([
    f.request(f.admin, '/users/1', { role: 'employee', active: 1 }, 'PUT'),
    f.request(promoted.cookie, `/users/${employee.id}`, { role: 'employee', active: 1 }, 'PUT'),
  ]);
  assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  const adminCookie = changes[0].status === 200 ? promoted.cookie : f.admin;
  const newPassword = 'Reset-password-456';
  assert.equal((await f.request(adminCookie, `/users/${employee.id}/password`, { password: newPassword })).status, 200);
  assert.equal((await f.request(promoted.cookie, '/data')).status, 401);
  assert.equal((await f.request(null, '/auth/login', { username: 'staff', password })).status, 401);
  const resetLogin = await f.request(null, '/auth/login', { username: 'staff', password: newPassword });
  assert.equal(resetLogin.status, 200);
  const usersBefore = f.db.prepare('SELECT * FROM users ORDER BY id').all();
  const remainingAdmin = changes[0].status === 200 ? resetLogin.cookie : f.admin;
  await f.request(remainingAdmin, '/settings/reset', { confirmation: 'RESET_BUSINESS_DATA' });
  assert.deepEqual(f.db.prepare('SELECT * FROM users ORDER BY id').all(), usersBefore);
});

test('changing own password checks the current password and revokes every device session', async t => {
  const f = await fixture(t), employee = await f.user('staff');
  const second = await f.request(null, '/auth/login', { username: 'staff', password });
  const body = { current_password: password, password: 'Changed-password-456' };
  assert.equal((await f.request(employee.cookie, '/auth/password', { ...body, current_password: 'wrong' })).status, 400);
  assert.equal((await f.request(employee.cookie, '/auth/password', { ...body, password: 'short' })).status, 400);
  assert.equal((await f.request(employee.cookie, '/auth/password', body)).status, 200);
  for (const cookie of [employee.cookie, second.cookie]) assert.equal((await f.request(cookie, '/data')).status, 401);
  assert.equal((await f.request(null, '/auth/login', { username: 'staff', password })).status, 401);
  assert.equal((await f.request(null, '/auth/login', { username: 'staff', password: body.password })).status, 200);
});

test('regular orders deduplicate retries by user, reject changed payloads, and keep inventory transactional', async t => {
  const f = await fixture(t), a = await f.user('alice'), b = await f.user('bobby');
  const stock = f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock;
  const body = { ...templateBody, request_id: randomUUID() };
  const results = await Promise.all([f.request(a.cookie, '/orders', body), f.request(a.cookie, '/orders', body)]);
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, stock + 2);
  assert.equal((await f.request(a.cookie, '/orders', { ...body, note: '不同内容' })).status, 400);
  const other = await f.request(b.cookie, '/orders', body);
  assert.equal(other.status, 201);
  assert.notEqual(other.data.id, results[0].data.id);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, stock + 4);
  // Both users attempting to sell the final unit cannot oversell.
  const id = (await f.request(a.cookie, '/products', product)).data.id;
  await f.command(a.cookie, '/orders', { ...templateBody, items: [{ product_id: id, quantity: 1, price: 10 }] });
  const sale = { type: 'out', partner: '客户', items: [{ product_id: id, quantity: 1, price: 20 }] };
  const sales = await Promise.all([f.command(a.cookie, '/orders', sale), f.command(b.cookie, '/orders', sale)]);
  assert.deepEqual(sales.map(r => r.status).sort(), [201, 400]);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock, 0);
});

test('legacy administrator migrates with the same password and data, invalidates old sessions, and migration is restart-safe', async t => {
  const dir = mkdtempSync(join(tmpdir(), '77erp-users-'));
  const path = join(dir, 'erp.sqlite');
  const original = { db: new DatabaseSync(path) };
  const stock = 7;
  original.db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY,name TEXT NOT NULL,barcode TEXT NOT NULL UNIQUE,category TEXT NOT NULL,unit TEXT NOT NULL DEFAULT '件',cost REAL NOT NULL,price REAL NOT NULL,stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),threshold INTEGER NOT NULL DEFAULT 20,color TEXT NOT NULL DEFAULT 'blue',created_at TEXT NOT NULL);
    INSERT INTO products VALUES (1,'旧物料','LEGACY-001','日用','件',10,20,7,2,'blue','2026-01-01T00:00:00Z');
    CREATE TABLE administrator (id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,admin_id INTEGER NOT NULL REFERENCES administrator(id),expires_at INTEGER NOT NULL);`);
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  original.db.prepare('INSERT INTO administrator VALUES (1,?,?,?,?)').run('owner', salt, hash, new Date().toISOString());
  original.db.prepare('INSERT INTO auth_sessions VALUES (?,1,?)').run('legacy-token', Date.now() + 100000);
  original.db.close();
  const f = await fixture(t, path);
  // Close the fixture's SQLite handle before removing its files on Windows.
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash, hash);
  assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=1').get().stock, stock);
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='administrator'").get(), undefined);
  assert.equal(f.db.prepare("SELECT 1 FROM auth_sessions WHERE token_hash='legacy-token'").get(), undefined);
  assert.equal((await f.request(f.admin, '/data')).status, 200);
  const restart = createApp(path);
  assert.equal(restart.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(restart.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 1);
  restart.db.close();
});

test('business backups preserve actor names and same-server template owners, but never assign foreign or legacy owners to local users', async t => {
  const source = await fixture(t), employee = await source.user('alice');
  await source.command(employee.cookie, '/templates', templateBody);
  await source.command(employee.cookie, '/orders', templateBody);
  const backup = (await source.request(source.admin, '/backup')).data;
  assert.equal(backup.version, 34);
  assert.equal(backup.data.users, undefined);
  const restore = async (f, value) => {
    const preview = await f.request(f.admin, '/backup/preview', { backup: value });
    assert.equal(preview.status, 200);
    const result = await f.command(f.admin, '/backup/restore', { backup: value, token: preview.data.token,
      current_token: preview.data.current_token, confirmation: 'RESTORE_BUSINESS_DATA' });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  };
  await restore(source, backup);
  assert.equal((await source.request(employee.cookie, '/templates')).data[0].created_by, employee.id);
  const destination = await fixture(t), other = await destination.user('bobby');
  assert.equal(other.id, employee.id);
  await restore(destination, backup);
  assert.equal((await destination.request(other.cookie, '/templates')).data.length, 0);
  const restored = (await destination.request(destination.admin, '/templates')).data[0];
  assert.equal(restored.created_by, null);
  assert.equal(restored.created_by_name, 'alice');
  assert.equal((await destination.request(destination.admin, '/data')).data.orders[0].created_by_name, 'alice');
  const legacy = structuredClone(backup);
  legacy.version = 4; delete legacy.source_instance_id;
  for (const c of legacy.data.categories) delete c.warehouse_id;
  for (const table of ['orders','templates']) for (const row of legacy.data[table]) { delete row.created_by; delete row.created_by_name; }
  await restore(destination, legacy);
  assert.deepEqual((await destination.request(destination.admin, '/templates')).data, []);
});

// Every /api route must declare who may call it, so a new endpoint cannot quietly gain or lose
// employee access. The probes send empty bodies and only assert the 403 boundary.
const routeRoles = new Map(Object.entries({
  'get /api/auth/status': 'public', 'post /api/auth/setup': 'public', 'post /api/auth/login': 'public', 'post /api/auth/logout': 'public',
  'post /api/auth/password': 'employee',
  'get /api/announcements': 'employee', 'get /api/announcements/unread-count': 'employee',
  'get /api/announcements/:announcementId': 'employee', 'post /api/announcements/:announcementId/read': 'employee',
  'post /api/announcements': 'admin', 'put /api/announcements/:announcementId': 'admin', 'delete /api/announcements/:announcementId': 'admin',
  'get /api/users': 'admin', 'post /api/users': 'admin', 'put /api/users/:id': 'admin', 'post /api/users/:id/password': 'admin', 'put /api/users/:id/permissions': 'admin',
  'get /api/warehouses': 'employee', 'post /api/warehouses': 'admin', 'put /api/warehouses/:id': 'admin', 'delete /api/warehouses/:id': 'admin',
  'get /api/categories': 'employee', 'post /api/categories': 'admin', 'put /api/categories/:id': 'admin', 'post /api/categories/:id/delete': 'admin',
  'get /api/data': 'employee', 'get /api/style': 'employee', 'get /api/products/barcode/:barcode': 'employee', 'get /api/products/:id/other-warehouses': 'employee', 'get /api/products/:id/history': 'employee',
  'get /api/orders/export': 'employee', 'post /api/products': 'employee', 'put /api/products/:id': 'employee', 'post /api/orders': 'employee',
  'post /api/products/:id/status': 'admin', 'delete /api/products/:id': 'admin',
  'post /api/products/batch/status': 'admin', 'post /api/products/batch/delete/preview': 'admin', 'post /api/products/batch/delete': 'admin',
  'post /api/products/:id/inspect': 'employee',
  'get /api/settings/ai': 'admin', 'put /api/settings/ai': 'admin', 'post /api/settings/ai/test': 'admin', 'get /api/settings/ai/audit': 'admin',
  // Legacy employees do not inherit the new AI permission; dedicated AI tests cover opt-in access.
  'get /api/ai/conversations': 'ai', 'get /api/ai/conversations/:id': 'ai', 'post /api/ai/chat': 'ai', 'post /api/ai/confirm': 'ai',
  'put /api/settings': 'admin', 'put /api/settings/currency': 'admin', 'post /api/settings/currency/sync-rate': 'admin', 'post /api/settings/reset': 'admin',
  'get /api/settings/imagebed': 'admin', 'put /api/settings/imagebed': 'admin', 'post /api/uploads/product-image': 'employee',
  'get /api/settings/r2-backup': 'admin', 'put /api/settings/r2-backup': 'admin',
  'post /api/settings/r2-backup/run': 'admin',
  'get /api/settings/notifications': 'admin', 'put /api/settings/notifications': 'admin',
  'get /api/settings/notifications/deliveries': 'admin', 'post /api/settings/notifications/test': 'admin',
  'post /api/settings/notifications/deliveries/:id/retry': 'admin',
  'get /api/contacts': 'employee', 'post /api/contacts': 'admin', 'post /api/contacts/:id/delete': 'admin',
  'get /api/templates': 'employee', 'post /api/templates': 'employee', 'post /api/templates/:id/delete': 'employee',
  'get /api/orders/:id/payments': 'admin', 'post /api/orders/:id/payments': 'admin', 'post /api/orders/:id/settlement': 'admin',
  'post /api/payments/:id/reverse': 'admin', 'get /api/finance': 'admin', 'get /api/reports/profit': 'admin',
  'post /api/orders/:id/void': 'admin', 'post /api/orders/:id/returns': 'admin',
  'get /api/stocktakes': 'admin', 'post /api/stocktakes': 'admin',
  'post /api/stock/reduce': 'admin', 'post /api/stock/increase': 'admin',
  'get /api/stocktakes/multi/products': 'admin', 'post /api/stocktakes/multi/compare': 'admin',
  'post /api/products/import/preview': 'admin', 'post /api/products/import': 'admin', 'get /api/products/export': 'admin',
  'get /api/stock-qrs': 'admin', 'post /api/stock-qrs': 'admin', 'get /api/stock-qrs/:qr_id': 'admin', 'put /api/stock-qrs/:qr_id': 'admin',
  'get /api/stock-qrs/:qr_id/usages': 'admin', 'get /api/stock-qrs/:qr_id/revisions': 'admin',
  'post /api/stock-qrs/preview': 'employee', 'post /api/stock-qrs/:qr_id/execute': 'employee',
  'get /api/backup': 'admin', 'post /api/backup/preview': 'admin', 'post /api/backup/restore': 'admin',
  'get /api/workspace': 'employee', 'get /api/updates': 'employee', 'get /api/products/:id': 'employee',
  'get /api/products': 'employee', 'get /api/orders': 'employee', 'get /api/orders/:id': 'employee', 'get /api/dashboard': 'employee',
  'get /api/transfers': 'admin', 'post /api/transfers': 'admin', 'post /api/transfers/:id/void': 'admin',
  // BOM access is opt-in; legacy employees do not inherit its permission.
  'get /api/boms': 'bom', 'get /api/boms/:id': 'bom', 'post /api/boms': 'bom',
  'post /api/boms/:id': 'bom', 'post /api/boms/:id/status': 'bom', 'post /api/boms/:id/calculate': 'bom',
  'post /api/boms/:id/delete': 'bom',
  'get /api/production-orders': 'production', 'get /api/production-orders/boms': 'production',
  'post /api/production-orders/prepare': 'production', 'get /api/production-orders/:id': 'production',
  'post /api/production-orders': 'production', 'post /api/production-orders/:id': 'production',
  'post /api/production-orders/:id/complete': 'production', 'post /api/production-orders/:id/void': 'production',
  'post /api/production-orders/:id/delete': 'production',
  'post /api/production-orders/:id/finish': 'production', 'post /api/production-orders/:id/batches/:batchId/void': 'production',
  'post /api/production-orders/:id/start': 'production', 'post /api/production-orders/:id/material-requests': 'production',
  'get /api/production-material-documents': 'purchase', 'post /api/production-material-documents/:id/confirm': 'sale',
  'post /api/production-material-documents/:id/cancel': 'sale',
}));

test('every API route declares its role, and employee access matches that declaration', async t => {
  const probe = createApp(':memory:');
  const routes = (probe.app.router ?? probe.app._router).stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`)
    .filter(key => key.includes(' /api/'));
  probe.db.close();
  assert.deepEqual(routes.filter(key => !routeRoles.has(key)), [], '路由未在测试中声明角色');
  assert.deepEqual([...routeRoles.keys()].filter(key => !routes.includes(key)), [], '测试声明了不存在的路由');
  const f = await fixture(t), employee = await f.user('staff');
  const counts = () => f.db.prepare('SELECT (SELECT COUNT(*) FROM products) AS p,(SELECT COUNT(*) FROM orders) AS o,(SELECT COUNT(*) FROM templates) AS d').get();
  const before = counts();
  for (const [key, role] of routeRoles) {
    // Logout ends the session under test, so it is asserted separately below.
    if (key === 'post /api/auth/logout') continue;
    const [method, path] = key.split(' ');
    const probePath = path.replace(/^\/api/, '').replace(':id', '1').replace(':announcementId', '1').replace(':barcode', 'TEAM-001').replace(':qr_id', 'a08f04e0-6420-4c84-9c07-189e70c95539');
    const response = await f.request(employee.cookie, probePath, method === 'get' ? undefined : {}, method.toUpperCase());
    assert.equal(response.status === 403, ['admin', 'ai', 'bom', 'production'].includes(role), `${key} 返回 ${response.status}`);
  }
  assert.deepEqual(counts(), before, '权限探测不应改动业务数据');
  assert.equal((await f.request(employee.cookie, '/auth/logout', {}, 'POST')).status, 200);
});

test('order settlement state is administrator-only in the workspace payload', async t => {
  const f = await fixture(t), employee = await f.user('staff');
  const created = await f.command(f.admin, '/orders', templateBody);
  const mine = (data) => data.orders.find(o => o.id === created.data.id);
  const admin = mine((await f.request(f.admin, '/data')).data);
  const staff = mine((await f.request(employee.cookie, '/data')).data);
  assert.equal(admin.payment_status, 'unpaid');
  assert.equal(admin.due_cents, admin.total * 100);
  assert.equal(staff.total, admin.total);
  for (const field of ['payment_status', 'paid_cents', 'due_cents', 'direction'])
    assert.equal(field in staff, false, field);
});

test('a conflicting account upgrade fails loudly and leaves the legacy administrator intact', async t => {
  const dir = mkdtempSync(join(tmpdir(), '77erp-users-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'erp.sqlite');
  const original = { db: new DatabaseSync(path) };
  original.db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY,name TEXT NOT NULL,barcode TEXT NOT NULL UNIQUE,category TEXT NOT NULL,unit TEXT NOT NULL DEFAULT '件',cost REAL NOT NULL,price REAL NOT NULL,stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),threshold INTEGER NOT NULL DEFAULT 20,color TEXT NOT NULL DEFAULT 'blue',created_at TEXT NOT NULL);
    INSERT INTO products VALUES (1,'旧物料','LEGACY-001','日用','件',10,20,7,2,'blue','2026-01-01T00:00:00Z');
    CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','employee')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_at TEXT NOT NULL);
    INSERT INTO users VALUES (1,'other','salt','hash','admin',1,'2026-01-01T00:00:00Z');
    CREATE TABLE administrator (id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO administrator VALUES (1,'owner','legacy-salt','legacy-hash','2026-01-01T00:00:00Z');`);
  original.db.close();
  // The id collision must abort the upgrade instead of half-applying it.
  assert.throws(() => createApp(path), /迁移失败/);
  const check = new DatabaseSync(path);
  assert.equal(check.prepare('SELECT password_hash FROM administrator WHERE id=1').get().password_hash, 'legacy-hash');
  assert.deepEqual(check.prepare('SELECT id,username FROM users').all().map(row => ({ ...row })), [{ id: 1, username: 'other' }]);
  assert.equal(check.prepare('SELECT stock FROM products WHERE id=1').get().stock, 7);
  check.close();
  // The database still upgrades once the conflict is resolved.
  const resolved = new DatabaseSync(path);
  resolved.prepare('DELETE FROM users').run();
  resolved.close();
  const restarted = createApp(path);
  assert.equal(restarted.db.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash, 'legacy-hash');
  assert.equal(restarted.db.prepare("SELECT 1 FROM sqlite_master WHERE name='administrator'").get(), undefined);
  restarted.db.close();
});


test('account names are optional, validated, reflected in active sessions and snapshotted in business records', async t => {
  const f = await fixture(t);
  const name = '张'.repeat(60);
  const created = await f.request(f.admin, '/users', { username: 'named', password, name });
  assert.equal(created.status, 201);
  const login = await f.request(null, '/auth/login', { username: 'named', password });
  assert.equal(login.data.name, name);
  assert.equal(login.data.username, 'named');
  const user = (await f.request(f.admin, '/users')).data.find(u => u.id === created.data.id);
  await f.request(f.admin, `/users/${user.id}/permissions`, { permissions: ['purchase', 'business'], version: user.permissions_version }, 'PUT');
  const order = await f.command(login.cookie, '/orders', { type: 'in', partner: '名称测试供应商', items: [{ product_id: 1, quantity: 1, price: 10 }] });
  assert.equal(order.status, 201);
  assert.equal(f.db.prepare('SELECT created_by_name FROM orders WHERE id=?').get(order.data.id).created_by_name, name);
  const update = next => f.request(f.admin, `/users/${user.id}`, { role: 'employee', active: 1, ...next }, 'PUT');
  assert.equal((await update({ name: '李四' })).status, 200);
  assert.equal((await f.request(login.cookie, '/auth/status')).data.name, '李四');
  assert.equal((await update({})).status, 200);
  assert.equal((await f.request(login.cookie, '/auth/status')).data.name, '李四');
  for (const invalid of [null, 7, '名'.repeat(61)]) assert.equal((await update({ name: invalid })).status, 400);
  assert.equal((await update({ name: '  ' })).status, 200);
  assert.equal((await f.request(login.cookie, '/auth/status')).data.name, 'named');
  assert.equal(f.db.prepare('SELECT created_by_name FROM orders WHERE id=?').get(order.data.id).created_by_name, name);
  const backup = (await f.request(f.admin, '/backup')).data;
  const preview = (await f.request(f.admin, '/backup/preview', { backup })).data;
  assert.equal((await f.command(f.admin, '/backup/restore', { backup, ...preview, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
});
