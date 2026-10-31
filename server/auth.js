import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isSupportedLanguage } from './i18n.js';

import { permissionKeys, hasPermission, canManage, usesProductionWorkspace } from '../shared/permissions.js';
import { queueNotification } from './notifications.js';
import { migratePositions, migrateBasicView, positionAuthorization, requirePositions, assignPositions, migrateUserPositions, installPositions, recordPositionChange } from './positions.js';
import { migrateProductionGroups, installProductionGroups, requireProductionGroup } from './production-groups.js';

const deriveKey = promisify(scrypt);
const cookieName = "77erp_session";
const sessionLifetime = 12 * 60 * 60 * 1000;
const digest = (token) => createHash("sha256").update(token).digest("hex");

export function installAuth(app, db, { publicOrigins = [] } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','employee')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
  );`);
  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some(c => c.name === 'language')) db.exec("ALTER TABLE users ADD COLUMN language TEXT CHECK(language IS NULL OR language IN ('zh-CN','en','vi'))");
  if (!userColumns.some(c => c.name === 'permissions')) db.exec('ALTER TABLE users ADD COLUMN permissions TEXT');
  if (!userColumns.some(c => c.name === 'permissions_version')) db.exec('ALTER TABLE users ADD COLUMN permissions_version INTEGER NOT NULL DEFAULT 1');
  if (!userColumns.some(c => c.name === 'name')) db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  if (!userColumns.some(c => c.name === 'employee_no')) db.exec("ALTER TABLE users ADD COLUMN employee_no TEXT NOT NULL DEFAULT ''");
  // Empty numbers belong to accounts created before the field existed, so only filled values must be unique.
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_employee_no_unique ON users(employee_no) WHERE employee_no <> ''");
  } catch (error) {
    throw new Error(`工号唯一性约束创建失败，请先修改或删除重复的工号：${error.message}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS user_permission_changes (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    changed_by INTEGER NOT NULL REFERENCES users(id), before_permissions TEXT, after_permissions TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
  // Run once, preserving the original password and invalidating legacy sessions.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='administrator'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO users(id,username,password_salt,password_hash,role,active,created_at)
        SELECT id,username,password_salt,password_hash,'admin',1,created_at FROM administrator`).run();
      db.exec("DROP TABLE IF EXISTS auth_sessions; DROP TABLE administrator;");
      db.exec("COMMIT");
    } catch (error) {
      // A failed upgrade must leave the legacy administrator table and its password untouched.
      db.exec("ROLLBACK");
      throw new Error(`管理员账号迁移失败，数据库未改动：${error.message}`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  );`);
  migratePositions(db);
  migrateProductionGroups(db);
  migrateBasicView(db);
  migrateUserPositions(db);
  // installAuth runs after the business migrations, so orders and templates already exist here.
  for (const table of ['orders', 'templates']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    for (const [name, definition] of Object.entries({ created_by: 'INTEGER REFERENCES users(id)', created_by_name: "TEXT NOT NULL DEFAULT ''" })) {
      if (!columns.some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
  const initialized = () => !!db.prepare("SELECT 1 FROM users LIMIT 1").get();
  const publicUser = (user) => ({ id: user.id, username: user.username, name: user.name || user.username, employee_no: user.employee_no ?? '', role: user.role, language: user.language ?? null,
    ...(user.role === 'admin' ? { permissions: permissionKeys, legacy_permissions: false, position_id: null, position_name: null, position_ids: [], position_names: [], positions: [], access_mode: 'standard' } : positionAuthorization(db, user)),
    production_group_id: user.production_group_id ?? null,
    production_group_name: user.production_group_id ? db.prepare('SELECT name FROM production_groups WHERE id=?').get(user.production_group_id)?.name ?? null : null,
    permissions_version: user.permissions_version ?? 1 });
  const validUsername = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(value.trim());
  const validName = (value) => typeof value === 'string' && value.length <= 60;
  const validEmployeeNo = (value) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 60;
  const validPassword = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 128;
  const passwordFields = async (password) => {
    const salt = randomBytes(16).toString('hex');
    return [salt, (await deriveKey(password, salt, 64)).toString('hex')];
  };
  // A TLS-terminating proxy hides the real scheme, so compare origins by host.
  const cookieOptions = (req) => ({
    httpOnly: true, sameSite: "strict", secure: req.secure, path: "/",
  });
  const sameOrigin = (req) => {
    const origin = req.get("origin");
    if (!origin) return true;
    if (req.get("sec-fetch-site") === "cross-site") return false;
    const host = req.get("host");
    return !!host && [...publicOrigins, `http://${host}`, `https://${host}`].includes(origin);
  };
  const sessionToken = (req) => {
    const token = (req.headers.cookie || "").split(";")
      .map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  };
  const sessionUser = (req) => {
    const token = sessionToken(req);
    const user = token ? db.prepare(`SELECT u.id,u.username,u.name,u.employee_no,u.role,u.language,u.position_id,u.production_group_id,u.permissions_version FROM auth_sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`)
      .get(digest(token), Date.now()) : undefined;
    return user ? publicUser(user) : undefined;
  };
  const issueSession = (req, res, user) => {
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").run(Date.now());
    const previous = sessionToken(req);
    if (previous) db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(previous));
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO auth_sessions VALUES (?,?,?)").run(digest(token), user.id, Date.now() + sessionLifetime);
    res.cookie(cookieName, token, { ...cookieOptions(req), maxAge: sessionLifetime });
    return { initialized: true, authenticated: true, ...publicUser(user) };
  };

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!sameOrigin(req)) {
        return res.status(403).json({ error: "请从当前站点提交请求。" });
      }
      const writePath = req.path.toLowerCase().replace(/\/+$/, '');
      const upload = req.method === 'POST' && (writePath === '/uploads/product-image' ||
        ['/quality/workbook-preview', '/quality/templates', '/quality/acceptances/preview', '/quality/acceptances'].includes(writePath) || /^\/quality\/templates\/\d+\/file$/.test(writePath));
      if (upload ? !req.is('multipart/form-data') : !req.is("application/json")) {
        return res.status(415).json({ error: upload ? '文件上传必须使用 multipart/form-data 格式。' : '请求必须使用 JSON 格式。' });
      }
    }
    next();
  });

  // Bound attempts by trusted client IP and account, including distributed attempts.
  const attempts = new Map();
  const clearAttempts = req => {
    for (const key of req.authLimitKeys || []) attempts.delete(key);
  };
  const authLimit = (req, res, next) => {
    const now = Date.now();
    for (const [key, attempt] of attempts) {
      if (attempt.until <= now) attempts.delete(key);
    }
    const username = req.user?.username ?? req.body?.username;
    const keys = [`ip:${req.ip}`];
    if (typeof username === 'string' && username.trim().length <= 32)
      keys.push(`account:${username.trim()}`);
    const blocked = keys.map(key => attempts.get(key)).find(attempt => attempt?.count >= 10);
    if (blocked) {
      res.set("Retry-After", String(Math.ceil((blocked.until - now) / 1000)));
      return res.status(429).json({ error: "尝试次数过多，请在 15 分钟后重试。" });
    }
    if (attempts.size + keys.filter(key => !attempts.has(key)).length > 10000)
      return res.status(429).json({ error: "请求过于频繁，请稍后重试。" });
    for (const key of keys) {
      const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      attempt.count++;
      attempts.set(key, attempt);
    }
    req.authLimitKeys = keys;
    next();
  };

  app.get("/api/auth/status", (req, res) => {
    const user = sessionUser(req);
    res.json({ initialized: initialized(), authenticated: !!user, ...(user || {}) });
  });
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    if (initialized()) return res.status(409).json({ error: "管理员已设置，请直接登录。" });
    const { username, password, name = '', base_currency = 'USD' } = req.body || {};
    if (typeof username !== "string" || !/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim())) {
      return res.status(400).json({ error: "账号需为 3–32 位字母、数字或 ._-。" });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "密码需为 8–128 位字符。" });
    }
    if (!validName(name)) return res.status(400).json({ error: '名称最多 60 个字。' });
    if (!['USD','CNY'].includes(base_currency)) return res.status(400).json({ error: '请选择有效的基准币种。' });
    const salt = randomBytes(16).toString("hex");
    const hash = (await deriveKey(password, salt, 64)).toString("hex");
    // Recheck inside a write transaction: competing setup requests cannot replace the admin.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (initialized()) {
        db.exec("ROLLBACK");
        return res.status(409).json({ error: "管理员已设置，请直接登录。" });
      }
      db.prepare("INSERT INTO users(id,username,password_salt,password_hash,role,created_at,name) VALUES (1,?,?,?,'admin',?,?)")
        .run(username.trim(), salt, hash, new Date().toISOString(), name.trim());
      db.prepare("UPDATE settings SET base_currency=?,display_currency=? WHERE id=1").run(base_currency, base_currency);
      const state = issueSession(req, res, { id: 1, username: username.trim(), name: name.trim(), role: 'admin' });
      db.exec("COMMIT");
      clearAttempts(req);
      res.status(201).json(state);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  const dummySalt = randomBytes(16).toString("hex");
  app.post("/api/auth/login", authLimit, async (req, res) => {
    if (!initialized()) return res.status(409).json({ error: "请先设置管理员。" });
    const { username, password } = req.body || {};
    if (typeof username !== "string" || username.length > 32 || typeof password !== "string" || password.length > 128) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username.trim());
    const hash = await deriveKey(password, user ? user.password_salt : dummySalt, 64);
    // A reset or disable may happen while scrypt is running.
    const current = user && db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!current?.active || current.password_hash !== user.password_hash ||
        !timingSafeEqual(hash, Buffer.from(current.password_hash, "hex"))) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }
    clearAttempts(req);
    res.json(issueSession(req, res, current));
  });
  app.post("/api/auth/logout", (req, res) => {
    const token = sessionToken(req);
    if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(token));
    res.clearCookie(cookieName, cookieOptions(req));
    res.json({ ok: true });
  });
  // Resolves req.user for every later /api middleware and route; installWarehouses and the
  // business modules read it, so this must stay registered before them.
  app.use("/api", (req, res, next) => {
    req.user = sessionUser(req);
    if (!req.user) return res.status(401).json({ error: "请登录后继续操作。" });
    next();
  });
  app.patch('/api/auth/language', (req, res) => {
    if (req.body?.user_id !== undefined && req.body.user_id !== req.user.id)
      return res.status(409).json({ error: '当前登录账号已变化，请刷新后重试。', code: 'ACCOUNT_CHANGED' });
    const language = req.body?.language;
    if (!isSupportedLanguage(language)) return res.status(400).json({ error: '请选择有效的界面语言。' });
    db.prepare('UPDATE users SET language=? WHERE id=?').run(language, req.user.id);
    res.json({ language });
  });
  app.post('/api/auth/password', authLimit, async (req, res) => {
    const { current_password, password } = req.body || {};
    if (!validPassword(password) || typeof current_password !== 'string' || current_password.length > 128)
      return res.status(400).json({ error: '密码需为 8–128 位字符。' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const hash = await deriveKey(current_password, user.password_salt, 64);
    if (!timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex')))
      return res.status(400).json({ error: '当前密码错误。' });
    const [salt, nextHash] = await passwordFields(password);
    const current = sessionUser(req);
    if (!current || db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash !== user.password_hash)
      return res.status(401).json({ error: '登录已失效，请重新登录。' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(salt, nextHash, user.id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.clearCookie(cookieName, cookieOptions(req));
    clearAttempts(req);
    res.json({ ok: true });
  });
  // Unmapped routes stay administrator-only, including account and system settings.
  app.use('/api', (req, res, next) => {
    if (req.user.role === 'admin') return next();
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    const read = ['GET', 'HEAD'].includes(req.method);
    const post = req.method === 'POST';
    const groupProductionRoute = (read && (path === '/production-orders' || /^\/production-orders\/\d+(?:\/pdf|\/stages\/batches|\/operation-workers|\/operations\/(?:reports|acceptance-template|acceptances\/\d+))?$/.test(path))) ||
      (post && /^\/production-orders\/\d+\/(?:(?:stages\/)?complete|operations\/report)$/.test(path));
    if (usesProductionWorkspace(req.user)) {
      if (read && ['/workspace','/style','/updates'].includes(path) || groupProductionRoute && hasPermission(req.user,'production_register')) return next();
      return res.status(403).json({error:'此岗位仅允许查看本组生产单并登记。'});
    }
    if (groupProductionRoute && hasPermission(req.user,'production_register')) return next();
    if (read && path === '/production-groups' && hasPermission(req.user,'production')) return next();
    if (/^\/quality(?:\/|$)/.test(path) && hasPermission(req.user, 'quality')) return next();
    if (/^\/process-routes(?:\/|$)/.test(path) && (hasPermission(req.user, 'bom') || read && ['products','production'].some(key => hasPermission(req.user,key)))) return next();
    if (/^\/boms(?:\/|$)/.test(path) && hasPermission(req.user, 'bom')) return next();
    if (/^\/production-orders(?:\/|$)/.test(path) && hasPermission(req.user, 'production') &&
        (!/\/(?:void|delete)$/.test(path) || hasPermission(req.user, 'corrections'))) return next();
    if (/^\/production-material-documents(?:\/|$)/.test(path) &&
        (hasPermission(req.user, 'purchase') || hasPermission(req.user, 'sale') || post && /\/cancel$/.test(path) && hasPermission(req.user, 'production'))) return next();
    if (/^\/production-receipts(?:\/|$)/.test(path) && hasPermission(req.user, 'purchase')) return next();
    if (read && ['/workspace', '/style', '/updates'].includes(path)) return next();
    if (hasPermission(req.user, 'basic_view') && ((read && (['/announcements', '/announcements/unread-count'].includes(path) || /^\/announcements\/\d+$/.test(path))) ||
        (post && /^\/announcements\/\d+\/read$/.test(path)))) return next();
    if ((read && (path === '/ai/conversations' || /^\/ai\/conversations\/[0-9a-f-]+$/.test(path)) ||
         post && ['/ai/chat', '/ai/confirm'].includes(path)) && hasPermission(req.user, 'ai')) return next();
    const legacyAllowed = (read && (
      ['/workspace','/data','/style','/warehouses','/categories','/contacts','/templates','/orders/export','/products','/orders','/dashboard'].includes(path) ||
      /^\/products\/barcode\/[^/]+$/.test(path) || /^\/products\/\d+$/.test(path) ||
      /^\/orders\/\d+$/.test(path) ||
      /^\/products\/\d+\/(other-warehouses|history)$/.test(path))) ||
      (post && ['/products','/orders','/templates','/uploads/product-image'].includes(path)) ||
      (req.method === 'PUT' && /^\/products\/\d+$/.test(path)) ||
      (post && /^\/products\/\d+\/inspect$/.test(path)) ||
      (post && /^\/templates\/\d+\/delete$/.test(path)) ||
      (post && (path === '/stock-qrs/preview' || /^\/stock-qrs\/[0-9a-f-]{36}\/execute$/.test(path)));
    if (req.user.legacy_permissions) {
      if (legacyAllowed && (!read || hasPermission(req.user, 'basic_view'))) return next();
    }
    {
      const basicRead = read && (
        ['/workspace','/data','/style','/warehouses','/categories','/contacts','/templates','/products','/orders','/dashboard'].includes(path) ||
        /^\/products\/barcode\/[^/]+$/.test(path) || /^\/products\/\d+$/.test(path) ||
        /^\/orders\/\d+$/.test(path) ||
        /^\/products\/\d+\/(other-warehouses|history)$/.test(path));
      if (basicRead && hasPermission(req.user, 'basic_view')) return next();
      let permission;
      if ((post && ['/products','/uploads/product-image','/products/batch/status','/products/batch/delete/preview','/products/batch/delete'].includes(path)) ||
          (req.method === 'PUT' && /^\/products\/\d+$/.test(path)) ||
          (post && /^\/products\/\d+\/(status|inspect)$/.test(path)) ||
          (req.method === 'DELETE' && /^\/products\/\d+$/.test(path)) ||
          (['POST','PUT'].includes(req.method) && /^\/categories(?:\/\d+(?:\/delete)?)?$/.test(path))) permission = 'products';
      if (post && path === '/orders') permission = req.body?.type === 'in' ? 'purchase' : req.body?.type === 'out' ? 'sale' : null;
      if (post && /^\/orders\/\d+\/(void|returns)$/.test(path)) permission = 'corrections';
      if ((read && path === '/transfers') ||
          (post && (path === '/transfers' || /^\/transfers\/[0-9a-f-]{36}\/void$/.test(path)))) permission = 'transfer';
      if ((read || post) && path === '/stocktakes') permission = 'stocktake';
      if (post && ['/stock/reduce', '/stock/increase'].includes(path)) permission = 'stocktake';
      if ((read && path === '/stocktakes/multi/products') || (post && path === '/stocktakes/multi/compare')) permission = 'stocktake';
      if ((post && ['/contacts','/templates'].includes(path)) ||
          (post && /^\/(templates|contacts)\/\d+\/delete$/.test(path)) ||
          ((read || ['POST','PUT'].includes(req.method)) && /^\/stock-qrs(?:\/[0-9a-f-]{36}(?:\/(usages|revisions))?)?$/.test(path))) permission = 'business';
      if ((read && ['/finance','/reports/profit'].includes(path)) ||
          ((read || post) && /^\/orders\/\d+\/(payments|settlement)$/.test(path)) ||
          (post && /^\/payments\/\d+\/reverse$/.test(path))) permission = 'finance';
      if ((post && ['/products/import/preview','/products/import'].includes(path)) || (read && ['/orders/export','/products/export'].includes(path))) permission = 'data_io';
      // QR direction comes from the persisted configuration, never a client-supplied direction.
      if (post && (path === '/stock-qrs/preview' || /^\/stock-qrs\/[0-9a-f-]{36}\/execute$/.test(path))) {
        const qrId = path === '/stock-qrs/preview' ? req.body?.label?.qr_id : path.split('/')[2];
        const qr = typeof qrId === 'string' ? db.prepare('SELECT type FROM stock_qr_codes WHERE qr_id=?').get(qrId) : null;
        permission = qr?.type === 'in' ? 'purchase' : qr?.type === 'out' ? 'sale' : null;
      }
      if (permission && canManage(req.user, permission)) return next();
    }
    return res.status(403).json({ error: '没有此操作的权限，请联系管理员。' });
  });
  installPositions(app, db);
  installProductionGroups(app, db);
  app.get('/api/users', (_, res) => res.json(db.prepare('SELECT id,username,name,employee_no,role,active,created_at,position_id,production_group_id,permissions_version FROM users ORDER BY id').all().map(user => ({ ...publicUser(user), active: user.active, created_at: user.created_at }))));
  app.post('/api/users', async (req, res) => {
    const { username, password, role = 'employee', name = '', employee_no = '' } = req.body || {};
    if (!validUsername(username) || !validPassword(password) || !validName(name) || !['admin','employee'].includes(role))
      return res.status(400).json({ error: '请填写有效账号、8–128 位密码、角色及最多 60 个字的名称。' });
    if (!validEmployeeNo(employee_no)) return res.status(400).json({ error: '工号需为 1–60 个字符。' });
    try { if (role === 'employee') requirePositions(db, req.body); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
    const [salt, hash] = await passwordFields(password);
    if (sessionUser(req)?.role !== 'admin') return res.status(401).json({ error: '登录或权限已变化，请重新登录。' });
    db.exec('BEGIN IMMEDIATE');
    try {
      // Password hashing yields: the selected position may have been removed meanwhile.
      const positions = role === 'employee' ? requirePositions(db, req.body) : [];
      const position = positions[0];
      const group = role === 'employee' ? requireProductionGroup(db,req.body.production_group_id ?? null) : null;
      const employeeNo = employee_no.trim();
      // Checked inside the write transaction so concurrent requests cannot register the same number twice.
      if (db.prepare('SELECT 1 FROM users WHERE employee_no=?').get(employeeNo)) {
        db.exec('ROLLBACK'); return res.status(409).json({ error: '该工号已被使用。' });
      }
      const result = db.prepare("INSERT INTO users(username,password_salt,password_hash,role,created_at,name,employee_no,permissions,position_id,production_group_id) VALUES (?,?,?,?,?,?,?,'[]',?,?)")
        .run(username.trim(), salt, hash, role, new Date().toISOString(), name.trim(), employeeNo, position?.id ?? null,group?.id ?? null);
      if (position) {
        assignPositions(db,Number(result.lastInsertRowid),positions);
        recordPositionChange(db, req, '新员工分配岗位', position.id, Number(result.lastInsertRowid), null, {position_ids: positions.map(position => position.id)});
      }
      if (group) recordPositionChange(db, req, '新员工分配生产组', position?.id ?? null, Number(result.lastInsertRowid), null, {production_group_id:group.id});
      db.exec('COMMIT');
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      db.exec('ROLLBACK');
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (!error.message.includes('UNIQUE')) throw error;
      res.status(409).json({ error: error.message.includes('employee_no') ? '该工号已被使用。' : '该账号已存在。' });
    }
  });
  app.put('/api/users/:id/permissions', (req, res) => {
    res.status(409).json({ error: '员工权限已改为岗位授权，请刷新页面，在岗位配置中修改权限或为员工调整岗位。' });
  });
  app.put('/api/users/:id', (req, res) => {
    const { role, active } = req.body || {};
    if (!['admin','employee'].includes(role) || ![0,1].includes(active) || (req.body.name !== undefined && !validName(req.body.name)))
      return res.status(400).json({ error: '请选择有效角色、账号状态，并填写最多 60 个字的名称。' });
    if (req.body.employee_no !== undefined && !validEmployeeNo(req.body.employee_no))
      return res.status(400).json({ error: '工号需为 1–60 个字符。' });
    // Same recheck as the other account endpoints: a concurrent demotion must not slip through.
    if (sessionUser(req)?.role !== 'admin') return res.status(401).json({ error: '登录或权限已变化，请重新登录。' });
    db.exec('BEGIN IMMEDIATE');
    try {
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
      if (!user) { db.exec('ROLLBACK'); return res.status(404).json({ error: '账号不存在。' }); }
      if (user.active && user.role === 'admin' && (!active || role !== 'admin') &&
          db.prepare("SELECT COUNT(*) AS n FROM users WHERE active=1 AND role='admin'").get().n <= 1) {
        db.exec('ROLLBACK'); return res.status(409).json({ error: '不能停用或降级最后一个管理员。' });
      }
      const beforePositions = positionAuthorization(db,user).position_ids;
      const positions = role === 'admin' ? [] : user.role === 'admin'
        ? requirePositions(db, req.body) : null;
      const positionId = positions ? positions[0]?.id ?? null : user.position_id;
      if (user.role === 'employee' && role === 'employee' &&
          (req.body.position_id !== undefined || req.body.position_ids !== undefined) &&
          JSON.stringify(requirePositions(db,req.body).map(position => position.id)) !== JSON.stringify(beforePositions)) {
        db.exec('ROLLBACK'); return res.status(409).json({error:'请通过调整岗位操作提交当前权限版本。'});
      }
      if (req.body.production_group_id !== undefined && req.body.production_group_id !== user.production_group_id) {
        db.exec('ROLLBACK'); return res.status(409).json({error:'请通过调整生产组操作提交当前权限版本。'});
      }
      const employeeNo = req.body.employee_no === undefined ? user.employee_no : req.body.employee_no.trim();
      if (employeeNo && db.prepare('SELECT 1 FROM users WHERE employee_no=? AND id<>?').get(employeeNo, user.id)) {
        db.exec('ROLLBACK'); return res.status(409).json({ error: '该工号已被使用。' });
      }
      db.prepare('UPDATE users SET role=?,active=?,name=?,employee_no=?,position_id=?,production_group_id=?,permissions_version=permissions_version+? WHERE id=?')
        .run(role, active, req.body.name === undefined ? user.name : req.body.name.trim(), employeeNo, positionId, role === 'admin' ? null : user.production_group_id, role !== user.role ? 1 : 0, user.id);
      if (positions) assignPositions(db,user.id,positions);
      if (role !== user.role) recordPositionChange(db, req, '账号类型变更岗位', positionId, user.id, {position_ids:beforePositions}, {position_ids:positions.map(position => position.id)});
      if (!active || role !== user.role) db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
      if (role !== user.role || active !== user.active) queueNotification(db, req, 'admin_action', { action: '修改账号角色／状态', target_user: user.username, before_role: user.role, role, before_active: user.active, active }, { global: true });
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (error) { db.exec('ROLLBACK'); if (error.status) return res.status(error.status).json({error:error.message}); if (error.message.includes('UNIQUE')) return res.status(409).json({ error: '该工号已被使用。' }); throw error; }
  });
  app.post('/api/users/:id/password', async (req, res) => {
    if (!validPassword(req.body?.password)) return res.status(400).json({ error: '密码需为 8–128 位字符。' });
    const [salt, hash] = await passwordFields(req.body.password);
    if (sessionUser(req)?.role !== 'admin') return res.status(401).json({ error: '登录或权限已变化，请重新登录。' });
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(salt, hash, req.params.id).changes) {
        db.exec('ROLLBACK'); return res.status(404).json({ error: '账号不存在。' });
      }
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(req.params.id);
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  return { sessionUser };
}
