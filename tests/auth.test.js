import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request as request_http } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";

const credentials = { username: "owner", password: "Strong-password-123" };
async function fixture(t, path = ":memory:", options = {}) {
  const { app, db } = createApp(path, options);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (method, path, headers, payload) => new Promise((resolve, reject) => {
    const req = request_http(`${base}/api${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        data: JSON.parse(Buffer.concat(chunks).toString() || "null"),
        headers: new Headers(res.headers),
        cookie: res.headers["set-cookie"]?.[0]?.split(";")[0],
      }));
    });
    req.on("error", reject);
    req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
  const request = async (path, { method = "GET", body, cookie, headers = {} } = {}) => {
    const res = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json(), headers: res.headers,
      cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  // fetch() forbids overriding Host, which a reverse proxy does.
  const proxied = (path, { method = "GET", body, cookie, headers = {} } = {}) =>
    send(method, path, { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body);
  return { db, request, proxied, close, base };
}

test("first run creates exactly one admin, hashes credentials and protects all business APIs", async (t) => {
  const { db, request } = await fixture(t);
  assert.deepEqual((await request("/auth/status")).data, { initialized: false, authenticated: false });
  for (const [path, method, body] of [
    ["/data", "GET"], ["/style", "GET"], ["/products/barcode/6901234567001", "GET"],
    ["/products", "POST", {}], ["/products/1", "PUT", {}], ["/orders", "POST", {}], ["/settings", "PUT", {}],
  ]) assert.equal((await request(path, { method, body })).status, 401);
  const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  const setup = await request("/auth/setup", { method: "POST", body: credentials });
  assert.equal(setup.status, 201);
  assert.equal(setup.data.username, credentials.username);
  assert.match(setup.headers.get("set-cookie"), /HttpOnly/);
  assert.match(setup.headers.get("set-cookie"), /SameSite=Strict/);
  const admin = db.prepare("SELECT * FROM administrator").get();
  assert.notEqual(admin.password_hash, credentials.password);
  assert.equal(admin.password_hash.length, 128);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products").get().n, count);
  assert.equal((await request("/data", { cookie: setup.cookie })).status, 200);
  assert.equal((await request("/auth/setup", { method: "POST", body: { ...credentials, username: "other" } })).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM administrator").get().n, 1);
  assert.equal((await request("/auth/status")).data.username, undefined);
});

test("setup validates credentials and competing initializations cannot overwrite each other", async (t) => {
  const { db, request } = await fixture(t);
  for (const body of [{}, null, { username: "a", password: credentials.password },
    { username: "invalid name", password: credentials.password }, { ...credentials, password: "short" },
    { ...credentials, password: "x".repeat(129) }]) {
    assert.equal((await request("/auth/setup", { method: "POST", body })).status, 400);
  }
  const results = await Promise.all(["first", "second"].map((username) =>
    request("/auth/setup", { method: "POST", body: { ...credentials, username } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM administrator").get().n, 1);
  assert.equal((await request("/auth/login", { method: "POST", body: credentials })).status, 401);
});

test("login rejects invalid credentials, logout revokes the token and expired sessions fail", async (t) => {
  const { db, request } = await fixture(t);
  assert.equal((await request("/auth/login", { method: "POST", body: credentials })).status, 409);
  const setup = await request("/auth/setup", { method: "POST", body: credentials });
  for (const body of [{ ...credentials, password: "wrong-password" }, { ...credentials, username: "wrong" }, {}]) {
    assert.equal((await request("/auth/login", { method: "POST", body })).status, 401);
  }
  assert.equal((await request("/auth/login", { method: "POST", body: null })).status, 400);
  const logout = await request("/auth/logout", { method: "POST", cookie: setup.cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request("/data", { cookie: setup.cookie })).status, 401);
  const login = await request("/auth/login", { method: "POST", body: credentials });
  assert.equal(login.status, 200);
  assert.notEqual(login.cookie, setup.cookie);
  assert.equal((await request("/auth/status", { cookie: login.cookie })).data.authenticated, true);
  assert.equal((await request("/data", { cookie: "77erp_session=" + "x".repeat(43) })).status, 401);
  db.prepare("UPDATE auth_sessions SET expires_at=?").run(Date.now() - 1);
  assert.equal((await request("/data", { cookie: login.cookie })).status, 401);
  assert.equal((await request("/auth/status", { cookie: login.cookie })).data.authenticated, false);
});

test("cross-site mutations and non-JSON submissions are blocked and failed logins are limited", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/auth/setup", { method: "POST", body: credentials, headers: { Origin: "https://unrelated.example" } })).status, 403);
  assert.equal((await request("/auth/setup", { method: "POST", body: credentials, headers: { "Content-Type": "text/plain" } })).status, 415);
  const setup = await request("/auth/setup", { method: "POST", body: credentials });
  assert.equal(setup.status, 201);
  assert.equal((await request("/settings", { method: "PUT", body: {}, cookie: setup.cookie, headers: { Origin: "https://unrelated.example" } })).status, 403);
  for (let n = 0; n < 10; n++) {
    assert.equal((await request("/auth/login", { method: "POST", body: { ...credentials, password: "incorrect" } })).status, 401);
  }
  const limited = await request("/auth/login", { method: "POST", body: credentials });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

test("domain requests pass through a TLS-terminating proxy, configured origins included", async (t) => {
  const { proxied } = await fixture(t);
  const domain = { Host: "erp.example.com", Origin: "https://erp.example.com",
    "X-Forwarded-Proto": "https", "Sec-Fetch-Site": "same-origin" };
  const setup = await proxied("/auth/setup", { method: "POST", body: credentials, headers: domain });
  assert.equal(setup.status, 201);
  assert.match(setup.headers.get("set-cookie"), /Secure/);
  assert.equal((await proxied("/settings", {
    method: "PUT", body: { business_name: "七七商贸", warehouse_name: "主仓库" },
    cookie: setup.cookie, headers: domain,
  })).status, 200);
  assert.equal((await proxied("/auth/logout", { method: "POST", cookie: setup.cookie, headers: domain })).status, 200);
  // A browser cannot mark a same-host origin as cross-site, so that verdict wins.
  assert.equal((await proxied("/auth/login", {
    method: "POST", body: credentials, headers: { ...domain, "Sec-Fetch-Site": "cross-site" },
  })).status, 403);
  assert.equal((await proxied("/auth/login", {
    method: "POST", body: credentials, headers: { ...domain, Origin: "https://other.example" },
  })).status, 403);
  const plain = await fixture(t);
  const anonymous = await plain.request("/auth/setup", { method: "POST", body: credentials });
  assert.doesNotMatch(anonymous.headers.get("set-cookie"), /Secure/);
});

test("proxies that rewrite Host need the domain listed in public origins", async (t) => {
  const strict = await fixture(t);
  const rewritten = { Origin: "https://erp.example.com", "Sec-Fetch-Site": "same-origin" };
  assert.equal((await strict.request("/auth/setup", { method: "POST", body: credentials, headers: rewritten })).status, 403);
  const { request } = await fixture(t, ":memory:", { publicOrigins: ["https://erp.example.com"] });
  const setup = await request("/auth/setup", { method: "POST", body: credentials, headers: rewritten });
  assert.equal(setup.status, 201);
  assert.equal((await request("/auth/login", {
    method: "POST", body: credentials, headers: { Origin: "https://unrelated.example" },
  })).status, 403);
});

test("administrator and session survive restarting with the same database", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "77erp-auth-"));
  try {
    const path = join(directory, "app.sqlite");
    const first = await fixture(t, path);
    const setup = await first.request("/auth/setup", { method: "POST", body: credentials });
    await first.close();
    const second = await fixture(t, path);
    assert.equal((await second.request("/auth/status")).data.initialized, true);
    assert.equal((await second.request("/data", { cookie: setup.cookie })).status, 200);
    assert.equal((await second.request("/auth/setup", { method: "POST", body: credentials })).status, 409);
    assert.equal((await second.request("/auth/login", { method: "POST", body: credentials })).status, 200);
    await second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("business reset requires login and confirmation, preserves account/settings, and stays empty after restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "77erp-reset-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "erp.sqlite");
  const first = await fixture(t, path);
  const reset = { method: "POST", body: { confirmation: "RESET_BUSINESS_DATA" } };
  assert.equal((await first.request("/settings/reset", reset)).status, 401);
  const { cookie } = await first.request("/auth/setup", { method: "POST", body: credentials });
  await first.request("/settings", { method: "PUT", cookie, body: { business_name: "保留商户", warehouse_name: "保留仓库" } });
  const admin = first.db.prepare("SELECT * FROM administrator").get();
  const count = first.db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  assert.equal((await first.request("/settings/reset", { method: "POST", cookie, body: {} })).status, 400);
  assert.equal(first.db.prepare("SELECT COUNT(*) AS n FROM products").get().n, count);
  // Force the last delete to fail; earlier deletions must roll back too.
  first.db.exec("CREATE TRIGGER prevent_reset BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await first.request("/settings/reset", { ...reset, cookie })).status, 500);
  assert.equal(first.db.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 64);
  assert.equal(first.db.prepare("SELECT COUNT(*) AS n FROM order_items").get().n, 64);
  first.db.exec("DROP TRIGGER prevent_reset");
  assert.equal((await first.request("/settings/reset", { ...reset, cookie })).status, 200);
  assert.deepEqual(first.db.prepare("SELECT * FROM administrator").get(), admin);
  assert.equal(first.db.prepare("SELECT COUNT(*) AS n FROM order_items").get().n, 0);
  await first.close();
  const second = await fixture(t, path);
  const result = await second.request("/data", { cookie });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.products, []);
  assert.deepEqual(result.data.orders, []);
  assert.equal(result.data.settings.business_name, "保留商户");
  assert.equal(result.data.settings.warehouse_name, "保留仓库");
  assert.equal((await second.request("/auth/login", { method: "POST", body: credentials })).status, 200);
  assert.equal((await second.request("/products", { method: "POST", cookie, body: { name: "正式商品", category: "日用", unit: "件", cost: 1, price: 2, threshold: 0 } })).status, 201);
  await second.close();
});
