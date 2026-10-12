import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

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
  // installAuth runs after the business migrations, so orders and drafts already exist here.
  for (const table of ['orders', 'drafts']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    for (const [name, definition] of Object.entries({ created_by: 'INTEGER REFERENCES users(id)', created_by_name: "TEXT NOT NULL DEFAULT ''" })) {
      if (!columns.some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
  const initialized = () => !!db.prepare("SELECT 1 FROM users LIMIT 1").get();
  const publicUser = (user) => ({ id: user.id, username: user.username, role: user.role });
  const validUsername = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(value.trim());
  const validPassword = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 128;
  const passwordFields = async (password) => {
    const salt = randomBytes(16).toString('hex');
    return [salt, (await deriveKey(password, salt, 64)).toString('hex')];
  };
  // A TLS-terminating proxy hides the real scheme, so compare origins by host.
  const forwardedProto = (req) => {
    const value = (req.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
    return value === "http" || value === "https" ? value : null;
  };
  const cookieOptions = (req) => ({
    httpOnly: true, sameSite: "strict", secure: req.secure || forwardedProto(req) === "https", path: "/",
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
    return token ? db.prepare(`SELECT u.id,u.username,u.role FROM auth_sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`)
      .get(digest(token), Date.now()) : undefined;
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
      if (!req.is("application/json")) {
        return res.status(415).json({ error: "请求必须使用 JSON 格式。" });
      }
    }
    next();
  });

  // Bound attempts per client without relying on user-controlled proxy headers.
  const attempts = new Map();
  const authLimit = (req, res, next) => {
    const now = Date.now();
    for (const [ip, attempt] of attempts) {
      if (attempt.until <= now) attempts.delete(ip);
    }
    const ip = req.ip;
    let attempt = attempts.get(ip);
    if (!attempt) {
      if (attempts.size >= 10000) return res.status(429).json({ error: "请求过于频繁，请稍后重试。" });
      attempt = { count: 0, until: now + 15 * 60 * 1000 };
      attempts.set(ip, attempt);
    }
    if (attempt.count >= 10) {
      res.set("Retry-After", String(Math.ceil((attempt.until - now) / 1000)));
      return res.status(429).json({ error: "尝试次数过多，请在 15 分钟后重试。" });
    }
    attempt.count++;
    next();
  };

  app.get("/api/auth/status", (req, res) => {
    const user = sessionUser(req);
    res.json({ initialized: initialized(), authenticated: !!user, ...(user || {}) });
  });
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    if (initialized()) return res.status(409).json({ error: "管理员已设置，请直接登录。" });
    const { username, password } = req.body || {};
    if (typeof username !== "string" || !/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim())) {
      return res.status(400).json({ error: "账号需为 3–32 位字母、数字或 ._-。" });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "密码需为 8–128 位字符。" });
    }
    const salt = randomBytes(16).toString("hex");
    const hash = (await deriveKey(password, salt, 64)).toString("hex");
    // Recheck inside a write transaction: competing setup requests cannot replace the admin.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (initialized()) {
        db.exec("ROLLBACK");
        return res.status(409).json({ error: "管理员已设置，请直接登录。" });
      }
      db.prepare("INSERT INTO users(id,username,password_salt,password_hash,role,created_at) VALUES (1,?,?,?,'admin',?)")
        .run(username.trim(), salt, hash, new Date().toISOString());
      const state = issueSession(req, res, { id: 1, username: username.trim(), role: 'admin' });
      db.exec("COMMIT");
      attempts.delete(req.ip);
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
    attempts.delete(req.ip);
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
    attempts.delete(req.ip);
    res.json({ ok: true });
  });
  // Employee access is explicit and deny-by-default: a route added later stays administrator-only
  // until it is listed here. Paths are lowercased and stripped of trailing slashes, the same way
  // Express matches them.
  //   GET  /data /style /warehouses /categories /contacts /drafts, /products/barcode/:code
  //   POST /products /orders /drafts, /drafts/:id/discard
  //   PUT  /products/:id
  // /products/barcode/:code is kept for clients released before 1.4.0; current web and Android
  // builds resolve barcodes from the /data snapshot.
  app.use('/api', (req, res, next) => {
    if (req.user.role === 'admin') return next();
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    const allowed = (['GET','HEAD'].includes(req.method) && (
      ['/data','/style','/warehouses','/categories','/contacts','/drafts'].includes(path) ||
      /^\/products\/barcode\/[^/]+$/.test(path))) ||
      (req.method === 'POST' && ['/products','/orders','/drafts'].includes(path)) ||
      (req.method === 'PUT' && /^\/products\/\d+$/.test(path)) ||
      (req.method === 'POST' && /^\/drafts\/\d+\/discard$/.test(path));
    if (!allowed) return res.status(403).json({ error: '此操作仅限管理员。' });
    next();
  });
  app.get('/api/users', (_, res) => res.json(db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY id').all()));
  app.post('/api/users', async (req, res) => {
    const { username, password, role = 'employee' } = req.body || {};
    if (!validUsername(username) || !validPassword(password) || !['admin','employee'].includes(role))
      return res.status(400).json({ error: '请填写有效账号、8–128 位密码及角色。' });
    const [salt, hash] = await passwordFields(password);
    if (sessionUser(req)?.role !== 'admin') return res.status(401).json({ error: '登录或权限已变化，请重新登录。' });
    try {
      const result = db.prepare('INSERT INTO users(username,password_salt,password_hash,role,created_at) VALUES (?,?,?,?,?)')
        .run(username.trim(), salt, hash, role, new Date().toISOString());
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (!error.message.includes('UNIQUE')) throw error;
      res.status(409).json({ error: '该账号已存在。' });
    }
  });
  app.put('/api/users/:id', (req, res) => {
    const { role, active } = req.body || {};
    if (!['admin','employee'].includes(role) || ![0,1].includes(active))
      return res.status(400).json({ error: '请选择有效角色和账号状态。' });
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
      db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role, active, user.id);
      if (!active || role !== user.role) db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
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
}
