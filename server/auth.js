import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const cookieName = "77erp_session";
const sessionLifetime = 12 * 60 * 60 * 1000;
const digest = (token) => createHash("sha256").update(token).digest("hex");

export function installAuth(app, db, { publicOrigins = [] } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS administrator (
      id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES administrator(id),
      expires_at INTEGER NOT NULL
    );
  `);
  const administrator = () => db.prepare("SELECT * FROM administrator WHERE id=1").get();
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
  const sessionAdmin = (req) => {
    const token = sessionToken(req);
    return token ? db.prepare(`SELECT a.username FROM auth_sessions s
      JOIN administrator a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>?`)
      .get(digest(token), Date.now()) : undefined;
  };
  const issueSession = (req, res, username) => {
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").run(Date.now());
    const previous = sessionToken(req);
    if (previous) db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(previous));
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO auth_sessions VALUES (?,1,?)").run(digest(token), Date.now() + sessionLifetime);
    res.cookie(cookieName, token, { ...cookieOptions(req), maxAge: sessionLifetime });
    return { initialized: true, authenticated: true, username };
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
    const admin = sessionAdmin(req);
    res.json({ initialized: !!administrator(), authenticated: !!admin, ...(admin || {}) });
  });
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    if (administrator()) return res.status(409).json({ error: "管理员已设置，请直接登录。" });
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
      if (administrator()) {
        db.exec("ROLLBACK");
        return res.status(409).json({ error: "管理员已设置，请直接登录。" });
      }
      db.prepare("INSERT INTO administrator VALUES (1,?,?,?,?)")
        .run(username.trim(), salt, hash, new Date().toISOString());
      const state = issueSession(req, res, username.trim());
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
    const admin = administrator();
    if (!admin) return res.status(409).json({ error: "请先设置管理员。" });
    const { username, password } = req.body || {};
    if (typeof username !== "string" || username.length > 32 || typeof password !== "string" || password.length > 128) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }
    const matchesUsername = username.trim() === admin.username;
    const hash = await deriveKey(password, matchesUsername ? admin.password_salt : dummySalt, 64);
    if (!matchesUsername || !timingSafeEqual(hash, Buffer.from(admin.password_hash, "hex"))) {
      return res.status(401).json({ error: "账号或密码错误。" });
    }
    attempts.delete(req.ip);
    res.json(issueSession(req, res, admin.username));
  });
  app.post("/api/auth/logout", (req, res) => {
    const token = sessionToken(req);
    if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(token));
    res.clearCookie(cookieName, cookieOptions(req));
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    if (!sessionAdmin(req)) return res.status(401).json({ error: "请登录后继续操作。" });
    next();
  });
}
