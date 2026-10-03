import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

let server, db, base, cookie;
before(async () => {
  const instance = createApp(":memory:");
  db = instance.db;
  server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const setup = await fetch(base + "/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Test-admin-123" }),
  });
  assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
async function request(path, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const order = (type, items) =>
  request("/orders", "POST", { type, partner: "测试往来单位", items });

test("design specification and tokens are persisted in SQLite", async () => {
  const { data } = await request("/style");
  assert.equal(data.tokens.accent, "#2563EB");
  assert.equal(data.source, "https://www.designprompts.dev/saas/");
  assert.match(data.specification, /进销存|工作台/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM design_styles").get().count,
    1,
  );
});
test("barcode lookup returns exact product and unknown codes have actionable error", async () => {
  const known = await request("/products/barcode/6901234567001");
  assert.equal(known.data.id, 1);
  assert.equal((await request("/products/barcode/UNKNOWN")).status, 404);
});
test("create product starts at zero and rejects duplicate barcode", async () => {
  const body = {
    name: "测试商品",
    barcode: "TEST-001",
    category: "其他",
    unit: "个",
    cost: 2.5,
    price: 5,
    threshold: 3,
    stock: 1000,
  };
  const created = await request("/products", "POST", body);
  assert.equal(created.status, 201);
  assert.equal(
    db.prepare("SELECT stock FROM products WHERE id=?").get(created.data.id)
      .stock,
    0,
  );
  const duplicate = await request("/products", "POST", body);
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.data.error, /条码/);
});
const automaticProduct = {
  name: "自动条码商品",
  category: "其他",
  unit: "个",
  cost: 10,
  price: 20,
  threshold: 5,
};
test("omitted, empty, whitespace and null barcodes generate persisted scannable codes", async () => {
  const codes = new Set();
  for (const barcode of [undefined, "", "   ", null]) {
    const result = await request("/products", "POST", {
      ...automaticProduct,
      barcode,
    });
    assert.equal(result.status, 201);
    assert.match(result.data.barcode, /^SKU-\d{6,}$/);
    assert.ok(!codes.has(result.data.barcode));
    codes.add(result.data.barcode);
    const stored = db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(result.data.id);
    assert.equal(stored.barcode, result.data.barcode);
    assert.equal(stored.stock, 0);
    const lookup = await request(`/products/barcode/${result.data.barcode}`);
    assert.equal(lookup.status, 200);
    assert.equal(lookup.data.id, result.data.id);
  }
});
test("automatic codes skip codes already assigned manually", async () => {
  const nextId = db
    .prepare("SELECT MAX(id) + 1 AS next FROM products")
    .get().next;
  const reserved = `SKU-${String(nextId + 1).padStart(6, "0")}`;
  assert.equal(
    (
      await request("/products", "POST", {
        ...automaticProduct,
        barcode: reserved,
      })
    ).status,
    201,
  );
  const automatic = await request("/products", "POST", automaticProduct);
  assert.equal(automatic.status, 201);
  assert.notEqual(automatic.data.barcode, reserved);
  assert.match(automatic.data.barcode, /^SKU-\d{6,}$/);
});
test("concurrent creates return distinct automatic barcodes", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      request("/products", "POST", automaticProduct),
    ),
  );
  assert.ok(results.every((result) => result.status === 201));
  assert.equal(
    new Set(results.map((result) => result.data.barcode)).size,
    results.length,
  );
});
test("editing with a blank barcode retains the existing barcode", async () => {
  const created = await request("/products", "POST", automaticProduct);
  const edited = await request(`/products/${created.data.id}`, "PUT", {
    ...automaticProduct,
    name: "修改商品名称",
    barcode: "",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.barcode, created.data.barcode);
  assert.equal(
    db.prepare("SELECT barcode FROM products WHERE id=?").get(created.data.id)
      .barcode,
    created.data.barcode,
  );
  assert.equal(
    (await request("/products/99999", "PUT", automaticProduct)).status,
    404,
  );
});
test("optional barcode still rejects malformed explicit codes", async () => {
  for (const barcode of [
    123,
    "x",
    "invalid code",
    "中文条码",
    "x".repeat(65),
  ]) {
    assert.equal(
      (await request("/products", "POST", { ...automaticProduct, barcode }))
        .status,
      400,
    );
  }
});
test("inbound and outbound update stock and preserve item snapshots", async () => {
  const original = db.prepare("SELECT * FROM products WHERE id=1").get();
  const incoming = await order("in", [
    { product_id: 1, quantity: 7, price: 24 },
  ]);
  assert.equal(incoming.status, 201);
  assert.equal(
    db.prepare("SELECT stock FROM products WHERE id=1").get().stock,
    original.stock + 7,
  );
  const outgoing = await order("out", [
    { product_id: 1, quantity: 2, price: 49 },
  ]);
  assert.equal(outgoing.status, 201);
  assert.equal(
    db.prepare("SELECT stock FROM products WHERE id=1").get().stock,
    original.stock + 5,
  );
  const outgoingAgain = await order("out", [
    { product_id: 1, quantity: 1, price: 49 },
  ]);
  assert.equal(outgoingAgain.status, 201);
  assert.notEqual(outgoing.data.number, outgoingAgain.data.number);
  const updated = await request("/products/1", "PUT", {
    ...original,
    name: "修改后的商品",
    price: 99,
  });
  assert.equal(updated.status, 200);
  const snapshot = db
    .prepare("SELECT * FROM order_items WHERE order_id=?")
    .get(outgoing.data.id);
  assert.equal(snapshot.name, original.name);
  assert.equal(snapshot.price, 49);
});
test("insufficient stock rolls back entire order, including first valid item", async () => {
  const previousStock = db
    .prepare("SELECT stock FROM products WHERE id=1")
    .get().stock;
  const previousCount = db
    .prepare("SELECT COUNT(*) AS count FROM orders")
    .get().count;
  const result = await order("out", [
    { product_id: 1, quantity: 1, price: 49 },
    { product_id: 7, quantity: 1, price: 29 },
  ]);
  assert.equal(result.status, 400);
  assert.match(result.data.error, /库存不足/);
  assert.equal(
    db.prepare("SELECT stock FROM products WHERE id=1").get().stock,
    previousStock,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM orders").get().count,
    previousCount,
  );
});
test("invalid quantity, negative amounts, missing products, and duplicate items are rejected", async () => {
  for (const items of [
    [{ product_id: 1, quantity: 0, price: 1 }],
    [{ product_id: 1, quantity: 1.5, price: 1 }],
    [{ product_id: 1, quantity: 1, price: -1 }],
    [{ product_id: 1, quantity: 1, price: 1.001 }],
    [{ product_id: 9999, quantity: 1, price: 1 }],
    [
      { product_id: 1, quantity: 1, price: 1 },
      { product_id: 1, quantity: 1, price: 1 },
    ],
  ])
    assert.equal((await order("in", items)).status, 400);
});
test("stock cannot be overwritten by product edit and settings persist", async () => {
  const p = db.prepare("SELECT * FROM products WHERE id=2").get();
  await request("/products/2", "PUT", { ...p, stock: 999999 });
  assert.equal(
    db.prepare("SELECT stock FROM products WHERE id=2").get().stock,
    p.stock,
  );
  assert.equal(
    (
      await request("/settings", "PUT", {
        business_name: "新商户",
        warehouse_name: "新仓库",
      })
    ).status,
    200,
  );
  const { data } = await request("/data");
  assert.equal(data.settings.business_name, "新商户");
});
