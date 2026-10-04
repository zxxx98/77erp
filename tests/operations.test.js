import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { parseCSV, rowsToProducts, importTemplate } from "../src/data-files.js";

async function fixture(t) {
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie;
  const request = async (path, body, auth = true) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth && cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  cookie = (
    await request("/auth/setup", {
      username: "admin",
      password: "Test-password-123",
    })
  ).cookie;
  const makeProduct = async (barcode = "OP-001") =>
    (
      await request("/products", {
        name: "测试商品",
        barcode,
        category: "日用",
        unit: "件",
        cost: 10,
        price: 20,
        threshold: 2,
      })
    ).data.id;
  const makeOrder = async (id, type, quantity) =>
    (
      await request("/orders", {
        type,
        partner: "往来单位",
        items: [{ product_id: id, quantity, price: 10 }],
      })
    ).data;
  const command = (path, body) =>
    request(path, { request_id: randomUUID(), ...body });
  const stock = (id) =>
    db.prepare("SELECT stock FROM products WHERE id=?").get(id).stock;
  return { db, request, command, stock, makeProduct, makeOrder };
}
test("partial returns, replay protection, voiding returns and original orders preserve inventory", async (t) => {
  const f = await fixture(t),
    id = await f.makeProduct();
  const incoming = await f.makeOrder(id, "in", 10);
  const body = {
    request_id: randomUUID(),
    reason: "采购退货",
    items: [{ product_id: id, quantity: 3 }],
  };
  const returned = await f.request(`/orders/${incoming.id}/returns`, body);
  assert.equal(returned.status, 200);
  assert.equal(f.stock(id), 7);
  assert.deepEqual(
    (await f.request(`/orders/${incoming.id}/returns`, body)).data,
    returned.data,
  );
  assert.equal(f.stock(id), 7);
  assert.equal(
    (
      await f.command(`/orders/${incoming.id}/returns`, {
        reason: "超量",
        items: [{ product_id: id, quantity: 8 }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.command(`/orders/${incoming.id}/void`, { reason: "已有退货" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.command(`/orders/${returned.data.id}/void`, {
        reason: "退货录错",
      })
    ).status,
    200,
  );
  assert.equal(f.stock(id), 10);
  const sale = await f.makeOrder(id, "out", 4);
  assert.equal(
    (
      await f.command(`/orders/${sale.id}/returns`, {
        reason: "客户退货",
        items: [{ product_id: id, quantity: 2 }],
      })
    ).status,
    200,
  );
  assert.equal(f.stock(id), 8);
  assert.equal(
    (
      await f.command(`/orders/${incoming.id}/void`, {
        reason: "库存不足不能反冲",
      })
    ).status,
    400,
  );
  const workspace = (await f.request("/data")).data;
  assert.equal(
    workspace.orders.find((o) => o.id === sale.id).items[0].returned_quantity,
    2,
  );
  assert.equal(
    workspace.orders.find((o) => o.id === returned.data.id).status,
    "void",
  );
  assert.equal(
    (await f.command("/orders/1/void", { reason: "演示数据" })).status,
    400,
  );
});
test("void outbound reverses inventory once and leaves historical details", async (t) => {
  const f = await fixture(t),
    id = await f.makeProduct();
  await f.makeOrder(id, "in", 5);
  const sale = await f.makeOrder(id, "out", 3);
  assert.equal(
    (await f.command(`/orders/${sale.id}/void`, { reason: "录错" })).status,
    200,
  );
  assert.equal(f.stock(id), 5);
  assert.equal(
    (await f.command(`/orders/${sale.id}/void`, { reason: "再次作废" })).status,
    400,
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id=?")
      .get(sale.id).n,
    1,
  );
});
test("stocktakes reject stale counts and roll back all lines on failure", async (t) => {
  const f = await fixture(t),
    one = await f.makeProduct(),
    two = await f.makeProduct("OP-002");
  await f.makeOrder(one, "in", 5);
  const bad = await f.command("/stocktakes", {
    reason: "月末",
    items: [
      { product_id: one, expected_stock: 5, counted: 3 },
      { product_id: two, expected_stock: 1, counted: 2 },
    ],
  });
  assert.equal(bad.status, 400);
  assert.equal(f.stock(one), 5);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM stock_adjustments").get().n,
    0,
  );
  const body = {
    request_id: randomUUID(),
    reason: "破损",
    items: [{ product_id: one, expected_stock: 5, counted: 0 }],
  };
  assert.equal((await f.request("/stocktakes", body)).status, 200);
  assert.equal((await f.request("/stocktakes", body)).status, 200);
  assert.equal(f.stock(one), 0);
  assert.equal((await f.request("/stocktakes")).data.length, 1);
});
test("imports preview row errors, reject existing codes atomically, and record opening stock", async (t) => {
  const f = await fixture(t),
    id = await f.makeProduct();
  const row = {
    name: "批量商品",
    barcode: "BATCH-001",
    category: "日用",
    unit: "件",
    cost: 1.2,
    price: 2,
    threshold: 1,
    stock: 8,
  };
  const bad = await f.request("/products/import/preview", {
    rows: [row, { ...row, barcode: "OP-001" }],
  });
  assert.equal(bad.data.errors[0].row, 3);
  assert.equal(
    (
      await f.command("/products/import", {
        rows: [row, { ...row, barcode: "OP-001" }],
        token: bad.data.token,
      })
    ).status,
    400,
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM products WHERE barcode=?")
      .get(row.barcode).n,
    0,
  );
  const rows = [row, { ...row, barcode: "" }],
    preview = (await f.request("/products/import/preview", { rows })).data;
  const body = { request_id: randomUUID(), rows, token: preview.token };
  assert.equal((await f.request("/products/import", body)).status, 200);
  assert.equal((await f.request("/products/import", body)).status, 200);
  assert.equal(
    f.db.prepare("SELECT stock FROM products WHERE barcode=?").get(row.barcode)
      .stock,
    8,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM stock_adjustments").get().n,
    2,
  );
  assert.equal(f.stock(id), 0);
  assert.equal(
    (
      await f.request("/products/import/preview", {
        rows: [{ ...row, stock: -1 }],
      })
    ).data.errors.length,
    1,
  );
});
test("backup round trip restores business data without replacing credentials or settings; stale/corrupt previews cannot overwrite", async (t) => {
  const f = await fixture(t),
    id = await f.makeProduct();
  const incoming = await f.makeOrder(id, "in", 10);
  await f.command(`/orders/${incoming.id}/returns`, {
    reason: "退货",
    items: [{ product_id: id, quantity: 2 }],
  });
  await f.command("/stocktakes", {
    reason: "盘盈",
    items: [{ product_id: id, expected_stock: 8, counted: 9 }],
  });
  const backup = (await f.request("/backup")).data;
  assert.equal(JSON.stringify(backup).includes("password_hash"), false);
  assert.equal(JSON.stringify(backup).includes("auth_sessions"), false);
  const before = (await f.request("/backup/preview", { backup })).data;
  await f.makeOrder(id, "out", 1);
  assert.equal(
    (
      await f.command("/backup/restore", {
        backup,
        ...before,
        confirmation: "RESTORE_BUSINESS_DATA",
      })
    ).status,
    400,
  );
  assert.equal(f.stock(id), 8);
  const corrupt = structuredClone(backup);
  corrupt.data.order_items[0].product_id = 999999;
  assert.equal(
    (await f.request("/backup/preview", { backup: corrupt })).status,
    400,
  );
  const admin = f.db.prepare("SELECT * FROM administrator").get();
  f.db.prepare("UPDATE settings SET business_name='保留设置'").run();
  await f.request("/settings/reset", { confirmation: "RESET_BUSINESS_DATA" });
  const preview = (await f.request("/backup/preview", { backup })).data;
  const body = {
    request_id: randomUUID(),
    backup,
    ...preview,
    confirmation: "RESTORE_BUSINESS_DATA",
  };
  assert.equal((await f.request("/backup/restore", body)).status, 200);
  assert.equal((await f.request("/backup/restore", body)).status, 200);
  assert.equal(f.stock(id), 9);
  assert.deepEqual(f.db.prepare("SELECT * FROM administrator").get(), admin);
  assert.equal(
    (await f.request("/data")).data.settings.business_name,
    "保留设置",
  );
  assert.deepEqual((await f.request("/backup")).data.data, backup.data);
  assert.equal((await f.request("/backup", undefined, false)).status, 401);
  for (const path of [
    "/stocktakes",
    "/products/import",
    "/backup/restore",
    `/orders/${incoming.id}/void`,
  ])
    assert.equal((await f.request(path, {}, false)).status, 401);
});
test("CSV and spreadsheet rows preserve barcodes, quoted commas/newlines and reject malformed data", () => {
  const rows = rowsToProducts(parseCSV(importTemplate));
  assert.equal(rows[0].stock, 20);
  const csv =
    '商品名称,条码,分类,单位,采购价,销售价,安全库存,期初库存\r\n"杯子,\n大号",001234,日用,件,1.20,2,0,3';
  const result = rowsToProducts(parseCSV(csv));
  assert.equal(result[0].name, "杯子,\n大号");
  assert.equal(result[0].barcode, "001234");
  assert.throws(() => parseCSV('"missing'));
  assert.throws(() => rowsToProducts([["wrong"]]));
  assert.throws(() =>
    rowsToProducts([
      parseCSV(importTemplate)[0],
      ["商品", "", "日用", "件", "", "2", "0", "0"],
    ]),
  );
});

test("restore failure rolls back deletes and inserts, preserving current business data", async (t) => {
  const f = await fixture(t),
    id = await f.makeProduct();
  await f.makeOrder(id, "in", 3);
  const backup = (await f.request("/backup")).data;
  await f.makeOrder(id, "in", 2);
  const before = (await f.request("/backup")).data.data;
  const preview = (await f.request("/backup/preview", { backup })).data;
  f.db.exec(
    "CREATE TRIGGER prevent_restore BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT, 'test restore failure'); END",
  );
  assert.equal(
    (
      await f.command("/backup/restore", {
        backup,
        ...preview,
        confirmation: "RESTORE_BUSINESS_DATA",
      })
    ).status,
    400,
  );
  assert.deepEqual((await f.request("/backup")).data.data, before);
});

test("1000-row import accepts a payload larger than the default JSON limit", async (t) => {
  const f = await fixture(t);
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    name: `批量导入验证商品${i}`,
    barcode: `LARGE-${i}`,
    category: "日用百货",
    unit: "件",
    cost: 1,
    price: 2,
    threshold: 5,
    stock: 10,
  }));
  assert.ok(Buffer.byteLength(JSON.stringify({ rows })) > 100 * 1024);
  const preview = await f.request("/products/import/preview", { rows });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.errors, []);
  const response = await f.command("/products/import", {
    rows,
    token: preview.data.token,
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.count, 1000);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM stock_adjustments").get().n,
    1000,
  );
});


test("existing order schema upgrades without changing stock and marks only seeded history as settled", t => {
  const dir = mkdtempSync(join(tmpdir(), "77erp-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "legacy.sqlite");
  const first = createApp(path);
  const originalStock = first.db.prepare("SELECT id,stock FROM products ORDER BY id").all();
  first.db.prepare("INSERT INTO orders(number,type,partner,note,total,created_at) VALUES ('LEGACY-001','in','供应商','正常单据',10,'2026-10-04T10:00:00Z')").run();
  first.db.close();
  const legacy = new DatabaseSync(path);
  for (const column of ["source_order_id", "kind", "status", "stock_applied", "void_reason", "voided_at"]) legacy.exec(`ALTER TABLE orders DROP COLUMN ${column}`);
  legacy.close();
  const migrated = createApp(path);
  try {
    assert.deepEqual(migrated.db.prepare("SELECT id,stock FROM products ORDER BY id").all(), originalStock);
    assert.equal(migrated.db.prepare("SELECT stock_applied FROM orders WHERE number='LEGACY-001'").get().stock_applied, 1);
    assert.equal(migrated.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE stock_applied=0").get().n, 64);
  } finally { migrated.db.close(); }
});
