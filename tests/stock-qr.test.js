import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { migrateStockQr } from "../server/stock-qr.js";

async function fixture(t) {
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  });
  let cookie;
  const request = async (
    path,
    method = "GET",
    body,
    warehouse = 1,
    session = cookie,
  ) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Warehouse-ID": String(warehouse),
          ...(session ? { Cookie: session } : {}),
        },
        body:
          body === undefined
            ? method === "DELETE"
              ? "{}"
              : undefined
            : JSON.stringify(body),
      },
    );
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  cookie = (
    await request("/auth/setup", "POST", {
      username: "admin",
      password: "Test-admin-123",
    })
  ).cookie;
  await request("/settings/reset", "POST", {
    confirmation: "RESET_BUSINESS_DATA",
  });
  const products = [];
  for (const [name, unit] of [
    ["物料A", "个"],
    ["物料B", "箱"],
  ]) {
    const body = {
      name,
      unit,
      category: "日用",
      barcode: `QR-${products.length + 1}`,
      cost: 10,
      price: 20,
      threshold: 0,
    };
    const r = await request("/products", "POST", body);
    assert.equal(r.status, 201);
    products.push({ ...body, id: r.data.id });
  }
  const source = db
    .prepare("SELECT value FROM app_metadata WHERE key='instance_id'")
    .get().value;
  const label = (q) => ({
    format: "77erp",
    version: 1,
    type: "stock_operation",
    source_id: source,
    warehouse_id: 1,
    qr_id: q.qr_id,
  });
  const body = {
    name: "组合入库",
    type: "in",
    partner: "供应商",
    items: products.map((p, i) => ({
      product_id: p.id,
      quantity: i ? 2 : 5,
      price_e4: 100000,
    })),
    max_scans: 3,
  };
  const create = async (overrides) => {
    const r = await request("/stock-qrs", "POST", {
      ...body,
      ...overrides,
      request_id: randomUUID(),
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  const preview = (q, extra = {}, session) =>
    request(
      "/stock-qrs/preview",
      "POST",
      { label: label(q), mode: q.type, ...extra },
      1,
      session,
    );
  const execute = (q, p, extra = {}, session) =>
    request(
      `/stock-qrs/${q.qr_id}/execute`,
      "POST",
      {
        preview_token: p.preview_token,
        confirmed: true,
        request_id: randomUUID(),
        ...extra,
      },
      1,
      session,
    );
  const stocks = () =>
    db
      .prepare("SELECT stock,inventory_value_cents FROM products ORDER BY id")
      .all()
      .map((p) => ({ ...p }));
  return {
    request,
    db,
    products,
    body,
    create,
    label,
    preview,
    execute,
    stocks,
  };
}

test('internal units work with receipt and issue QR codes and survive backup restore', async t => {
  const f = await fixture(t);
  const contact = await f.request('/contacts', 'POST', { request_id: randomUUID(), role: 'internal', name: '扫码产线', person: '', phone: '', address: '', note: '', active: 1 });
  assert.equal(contact.status, 200);
  const items = [{ product_id: f.products[0].id, quantity: 2, price_e4: 100000 }];
  for (const type of ['in', 'out']) {
    const qr = await f.create({ type, partner: '扫码产线', partner_id: contact.data.id, items });
    const preview = await f.preview(qr);
    assert.equal(preview.status, 200);
    const executed = await f.execute(qr, preview.data);
    assert.equal(executed.status, 201);
    const order = f.db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
    assert.equal(order.kind, 'internal');
    assert.equal(order.partner_id, contact.data.id);
    assert.equal(order.settlement_tracked, 0);
  }
  assert.equal(f.stocks()[0].stock, 0);
  const summary = (await f.request('/dashboard')).data;
  assert.equal(summary.today.purchase_cents, 0);
  assert.equal(summary.today.sales_cents, 0);
  const backup = (await f.request('/backup')).data;
  const preview = await f.request('/backup/preview', 'POST', { backup });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal((await f.request('/backup/restore', 'POST', { backup, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA', request_id: randomUUID() })).status, 200);
});

test("fractional QR receipts and sales round line amounts and survive backup restore", async (t) => {
  const f = await fixture(t);
  const items = [{ product_id: f.products[0].id, quantity: 0.125, price_e4: 12300 }];
  const receipt = await f.create({ items });
  const preview = (await f.preview(receipt)).data;
  assert.equal(preview.items[0].amount_cents, 15);
  assert.equal((await f.execute(receipt, preview)).status, 201);
  assert.equal(f.stocks()[0].stock, 0.125);
  assert.equal(f.stocks()[0].inventory_value_cents, 15);
  const sale = await f.create({ type: "out", partner: "客户", items });
  assert.equal((await f.execute(sale, (await f.preview(sale)).data)).status, 201);
  assert.equal(f.stocks()[0].stock, 0);
  assert.equal(f.stocks()[0].inventory_value_cents, 0);
  const backup = (await f.request("/backup")).data;
  const restorePreview = await f.request("/backup/preview", "POST", { backup });
  assert.equal(restorePreview.status, 200, JSON.stringify(restorePreview.data));
  const restored = await f.request("/backup/restore", "POST", { backup, ...restorePreview.data, confirmation: "RESTORE_BUSINESS_DATA", request_id: randomUUID() });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(f.db.prepare("SELECT quantity FROM stock_qr_items LIMIT 1").get().quantity, 0.125);
  assert.equal(f.db.prepare("SELECT quantity FROM order_items LIMIT 1").get().quantity, 0.125);
});

test("legacy QR quantity constraint migrates idempotently and preserves existing rows", async (t) => {
  const f = await fixture(t), original = await f.create();
  const schema = f.db.prepare("SELECT sql FROM sqlite_master WHERE name='stock_qr_items'").get().sql;
  const rows = f.db.prepare("SELECT * FROM stock_qr_items ORDER BY id").all();
  f.db.exec("DROP TABLE stock_qr_items");
  f.db.exec(schema.replace('quantity REAL NOT NULL CHECK(quantity > 0 AND quantity <= 99999999)', 'quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99999999)'));
  const insert = f.db.prepare(`INSERT INTO stock_qr_items VALUES (${Object.keys(rows[0]).map(() => '?').join(',')})`);
  rows.forEach(row => insert.run(...Object.values(row)));
  migrateStockQr(f.db);
  migrateStockQr(f.db);
  assert.deepEqual(f.db.prepare("SELECT * FROM stock_qr_items ORDER BY id").all(), rows);
  assert.equal((await f.preview(original)).status, 200);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  const fractional = await f.create({ items: [{ product_id: f.products[0].id, quantity: 0.000001, price_e4: 100000 }] });
  assert.equal((await f.execute(fractional, (await f.preview(fractional)).data)).status, 201);
  assert.equal(f.stocks()[0].stock, 0.000001);
});

test("multi-product receipt uses one order, one quota and current immutable prices; defaults require confirmation", async (t) => {
  const f = await fixture(t),
    q = await f.create();
  assert.equal(q.require_confirmation, true);
  for (let n = 0; n < 3; n++) {
    const p = await f.preview(q);
    assert.equal(p.status, 200);
    assert.deepEqual(
      f.stocks().map((p) => p.stock),
      [n * 5, n * 2],
    );
    assert.equal(
      (await f.execute(q, p.data, { confirmed: false })).data.code,
      "CONFIRMATION_REQUIRED",
    );
    const r = await f.execute(q, p.data);
    assert.equal(r.status, 201);
    assert.equal(r.data.items.length, 2);
    assert.equal(r.data.used_scans, n + 1);
  }
  assert.deepEqual(f.stocks(), [
    { stock: 15, inventory_value_cents: 15000 },
    { stock: 6, inventory_value_cents: 6000 },
  ]);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 3);
  assert.equal((await f.preview(q)).data.code, "SCAN_LIMIT_REACHED");
});

test("network retries and new request IDs with the same token replay even after expiry and disable", async (t) => {
  const f = await fixture(t),
    q = await f.create({ require_confirmation: false }),
    p = (await f.preview(q)).data,
    id = randomUUID();
  const first = await f.execute(q, p, { confirmed: false, request_id: id });
  assert.equal(first.status, 201);
  f.db
    .prepare("UPDATE stock_qr_codes SET enabled=0,version=version+1 WHERE id=?")
    .run(q.id);
  f.db.prepare("UPDATE stock_qr_previews SET expires_at='2000-01-01'").run();
  assert.equal(
    (await f.execute(q, p, { confirmed: false, request_id: id })).data.number,
    first.data.number,
  );
  assert.equal(
    (await f.execute(q, p, { confirmed: false })).data.number,
    first.data.number,
  );
  assert.equal(
    f.db.prepare("SELECT used_scans FROM stock_qr_codes").get().used_scans,
    1,
  );
  assert.equal((await f.execute(q, p, { request_id: id })).status, 409);
});

test("last quota concurrent tokens create at most one multi-item order", async (t) => {
  const f = await fixture(t),
    q = await f.create({ max_scans: 1, require_confirmation: false });
  const [a, b] = await Promise.all([f.preview(q), f.preview(q)]);
  const rs = await Promise.all([
    f.execute(q, a.data, { confirmed: false }),
    f.execute(q, b.data, { confirmed: false }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  assert.deepEqual(
    f.stocks().map((p) => p.stock),
    [5, 2],
  );
});

test("insufficient stock in any line, including changes after preview, rejects entire sale", async (t) => {
  const f = await fixture(t);
  await f.execute(
    await f.create(),
    (await f.preview((await f.request("/stock-qrs")).data.rows[0])).data,
  );
  const q = await f.create({
    name: "组合出库",
    type: "out",
    partner: "客户",
    items: f.products.map((p, i) => ({
      product_id: p.id,
      quantity: i ? 2 : 1,
      price_e4: 200000,
    })),
  });
  const p = (await f.preview(q)).data;
  f.db
    .prepare(
      "UPDATE products SET stock=1,inventory_value_cents=1000 WHERE id=?",
    )
    .run(f.products[1].id);
  const before = f.stocks(),
    r = await f.execute(q, p);
  assert.equal(r.status, 409);
  assert.equal(r.data.details[0].product_id, f.products[1].id);
  assert.deepEqual(f.stocks(), before);
  assert.equal(
    f.db.prepare("SELECT used_scans FROM stock_qr_codes WHERE id=?").get(q.id)
      .used_scans,
    0,
  );
});

test("a failure after the first inventory write rolls back all stock, cost, orders and quota", async (t) => {
  const f = await fixture(t),
    q = await f.create(),
    p = (await f.preview(q)).data,
    before = f.stocks();
  f.db.exec(
    `CREATE TRIGGER test_qr_failure BEFORE UPDATE OF stock ON products WHEN NEW.id=${f.products[1].id} BEGIN SELECT RAISE(ABORT,'forced second item failure'); END;`,
  );
  const r = await f.execute(q, p);
  assert.equal(r.status, 400);
  assert.deepEqual(f.stocks(), before);
  for (const table of [
    "orders",
    "order_items",
    "stock_qr_usages",
    "operation_requests",
  ])
    assert.equal(
      f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
      table === "operation_requests" ? 1 : 0,
    );
  assert.equal(
    f.db.prepare("SELECT used_scans FROM stock_qr_codes").get().used_scans,
    0,
  );
});

test("editing replaces composition atomically, preserves count and invalidates previews; raising limit reuses printed label", async (t) => {
  const f = await fixture(t),
    q = await f.create(),
    old = (await f.preview(q)).data;
  await f.execute(q, old);
  const preview = (await f.preview(q)).data;
  const update = {
    ...f.body,
    require_confirmation: true,
    version: 1,
    items: [{ product_id: f.products[1].id, quantity: 7, price_e4: 300000 }],
    max_scans: 5,
    request_id: randomUUID(),
  };
  const r = await f.request(`/stock-qrs/${q.qr_id}`, "PUT", update);
  assert.equal(r.status, 200);
  assert.equal(r.data.version, 2);
  assert.equal(r.data.remaining_scans, 4);
  assert.equal((await f.execute(q, preview)).data.code, "CONFIG_CHANGED");
  const next = (await f.preview(q)).data;
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].quantity, 7);
  assert.equal(
    (await f.request(`/stock-qrs/${q.qr_id}`, "PUT", update)).data.version,
    2,
  );
  assert.equal(
    (
      await f.request(`/stock-qrs/${q.qr_id}`, "PUT", {
        ...update,
        version: 1,
        request_id: randomUUID(),
      })
    ).data.code,
    "CONFIG_CHANGED",
  );
  const backup = (await f.request("/backup")).data;
  const invalid = await f.request(`/stock-qrs/${q.qr_id}`, "PUT", {
    ...update,
    version: 2,
    items: [],
    request_id: randomUUID(),
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await f.request("/backup")).data.data, backup.data);
  const history = (await f.request(`/stock-qrs/${q.qr_id}/usages`)).data
    .rows[0];
  assert.equal(history.snapshot.items.length, 2);
});

test("invalid combinations, cross-warehouse items, prices and boolean values never save partial configuration", async (t) => {
  const f = await fixture(t),
    p = f.body.items[0];
  const w = (await f.request("/warehouses", "POST", { name: "分仓" })).data.id;
  const other = (
    await f.request(
      "/products",
      "POST",
      { ...f.products[0], barcode: "REMOTE-QR" },
      w,
    )
  ).data;
  for (const overrides of [
    { items: [] },
    { items: [p, p] },
    { items: Array.from({ length: 101 }, () => p) },
    { items: [{ ...p, quantity: 0 }] },
    { items: [{ ...p, price_e4: 1.5 }] },
    { items: [p, { ...p, product_id: other.id }] },
    { require_confirmation: "false" },
    { max_scans: 0 },
    { items: [{ ...p, quantity: 99999999, price_e4: 999999990001 }] },
  ]) {
    const r = await f.request("/stock-qrs", "POST", {
      ...f.body,
      ...overrides,
      request_id: randomUUID(),
    });
    assert.equal(r.status, 400, JSON.stringify(overrides));
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM stock_qr_codes").get().n,
      0,
    );
  }
  const q = await f.create({ max_scans: null });
  assert.equal(q.remaining_scans, null);
});

test("source, mode, type and warehouse must match, and product or partner edits invalidate pending execution", async (t) => {
  const f = await fixture(t),
    q = await f.create();
  for (const extra of [
    { mode: "query" },
    { mode: "out" },
    { label: { ...f.label(q), source_id: randomUUID() } },
    { label: { ...f.label(q), warehouse_id: 2 } },
    { label: { ...f.label(q), type: "product" } },
    { label: { ...f.label(q), version: 2 } },
  ])
    assert.equal((await f.preview(q, extra)).status, 400);
  const p = (await f.preview(q)).data;
  f.db
    .prepare("UPDATE products SET unit='盒' WHERE id=?")
    .run(f.products[1].id);
  assert.equal((await f.execute(q, p)).data.code, "PRODUCT_CHANGED");
  f.db
    .prepare("UPDATE products SET unit='箱' WHERE id=?")
    .run(f.products[1].id);
  f.db
    .prepare("UPDATE contacts SET name='新供应商' WHERE id=?")
    .run(q.partner_id);
  assert.equal((await f.execute(q, p)).data.code, "PARTNER_CHANGED");
  f.db.prepare("UPDATE contacts SET active=0 WHERE id=?").run(q.partner_id);
  assert.equal((await f.preview(q)).data.code, "PARTNER_CHANGED");
});

test("employee can execute but cannot manage, reuse another user preview, or bypass login", async (t) => {
  const f = await fixture(t),
    q = await f.create({ require_confirmation: false }),
    p = (await f.preview(q)).data;
  await f.request("/users", "POST", {
    username: "worker",
    password: "Test-worker-123",
    role: "employee",
  });
  f.db.prepare('UPDATE users SET permissions=? WHERE username=?').run(JSON.stringify(["purchase", "sale"]), "worker");
  const cookie = (
    await f.request("/auth/login", "POST", {
      username: "worker",
      password: "Test-worker-123",
    })
  ).cookie;
  assert.equal(
    (await f.request("/stock-qrs", "GET", undefined, 1, cookie)).status,
    403,
  );
  assert.equal(
    (await f.request(`/stock-qrs/${q.qr_id}`, "GET", undefined, 1, cookie))
      .status,
    403,
  );
  assert.equal(
    (await f.execute(q, p, { confirmed: false }, cookie)).status,
    409,
  );
  const own = (await f.preview(q, {}, cookie)).data;
  const r = await f.execute(q, own, { confirmed: false }, cookie);
  assert.equal(r.status, 201);
  assert.equal(
    f.db.prepare("SELECT created_by_name FROM orders WHERE id=?").get(r.data.id)
      .created_by_name,
    "worker",
  );
  assert.equal((await f.preview(q, {}, null)).status, 401);
});

test("backup v7 preserves multi-item history, restore rotates labels and disables, v6 clears QR data", async (t) => {
  const f = await fixture(t),
    q = await f.create();
  await f.execute(q, (await f.preview(q)).data);
  const backup = (await f.request("/backup")).data;
  assert.equal(backup.version, 32);
  const restore = async (value) => {
    const p = await f.request("/backup/preview", "POST", { backup: value });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    return f.request("/backup/restore", "POST", {
      backup: value,
      ...p.data,
      confirmation: "RESTORE_BUSINESS_DATA",
      request_id: randomUUID(),
    });
  };
  const broken = structuredClone(backup);
  broken.data.stock_qr_items[0].stock_qr_id = 999;
  assert.equal(
    (await f.request("/backup/preview", "POST", { backup: broken })).status,
    400,
  );
  assert.equal((await restore(backup)).status, 200);
  assert.equal((await f.preview(q)).status, 404);
  const restored = (await f.request("/stock-qrs")).data.rows[0];
  assert.equal(restored.enabled, false);
  assert.equal(restored.used_scans, 1);
  assert.equal(restored.items.length, 2);
  assert.equal(
    (
      await f.request("/backup/preview", "POST", {
        backup: (await f.request("/backup")).data,
      })
    ).status,
    200,
  );
  const legacy = structuredClone(backup);
  legacy.version = 6;
  for (const c of legacy.data.categories) delete c.warehouse_id;
  for (const table of [
    "stock_qr_codes",
    "stock_qr_items",
    "stock_qr_revisions",
    "stock_qr_usages",
  ])
    delete legacy.data[table];
  assert.equal((await restore(legacy)).status, 200);
  assert.equal((await f.request("/stock-qrs")).data.total, 0);
});

test("configuration references block product deletion; reset invalidates all old QR codes", async (t) => {
  const f = await fixture(t),
    q = await f.create();
  assert.equal(
    (await f.request(`/products/${f.products[0].id}`, "DELETE")).status,
    400,
  );
  await f.request("/settings/reset", "POST", {
    confirmation: "RESET_BUSINESS_DATA",
  });
  assert.equal((await f.preview(q)).status, 404);
  for (const table of [
    "stock_qr_codes",
    "stock_qr_items",
    "stock_qr_usages",
    "stock_qr_revisions",
    "stock_qr_previews",
  ])
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});

test("multi-item sale uses weighted costs and voiding does not refund quota", async (t) => {
  const f = await fixture(t),
    receipt = await f.create();
  await f.execute(receipt, (await f.preview(receipt)).data);
  const sale = await f.create({
    name: "组合销售",
    type: "out",
    partner: "客户",
    max_scans: 1,
  });
  const result = await f.execute(sale, (await f.preview(sale)).data);
  assert.equal(result.status, 201);
  assert.deepEqual(f.stocks(), [
    { stock: 0, inventory_value_cents: 0 },
    { stock: 0, inventory_value_cents: 0 },
  ]);
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT cost_cents FROM order_items WHERE order_id=? ORDER BY id",
      )
      .all(result.data.id)
      .map((i) => i.cost_cents),
    [5000, 2000],
  );
  assert.equal(
    (
      await f.request(`/orders/${result.data.id}/void`, "POST", {
        request_id: randomUUID(),
        reason: "误扫纠正",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    f.stocks().map((p) => p.stock),
    [5, 2],
  );
  assert.equal((await f.preview(sale)).data.code, "SCAN_LIMIT_REACHED");
  const usage = (await f.request(`/stock-qrs/${sale.qr_id}/usages`)).data
    .rows[0];
  assert.equal(usage.order.status, "void");
});
