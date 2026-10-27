import { assertRestoredBusiness } from './backup-assertions.js';
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
        name: "测试物料",
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
test("decimal stock moves, partial returns, voids and stocktakes retain quantities and costs", async (t) => {
  const f = await fixture(t), id = await f.makeProduct();
  await f.makeOrder(id, "in", 0.1);
  await f.makeOrder(id, "in", 0.2);
  assert.equal(f.stock(id), 0.3);
  const sale = await f.makeOrder(id, "out", 0.3);
  assert.equal(f.stock(id), 0);
  const returned = [];
  for (const quantity of [0.1, 0.2]) {
    const response = await f.command(`/orders/${sale.id}/returns`, {
      reason: "部分退货", items: [{ product_id: id, quantity }],
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    returned.push(response.data.id);
  }
  assert.equal(f.stock(id), 0.3);
  const snapshot = (await f.request("/data")).data.orders.find(o => o.id === sale.id);
  assert.equal(snapshot.items[0].returned_quantity, 0.3);
  assert.equal(f.db.prepare("SELECT inventory_value_cents FROM products WHERE id=?").get(id).inventory_value_cents, 300);
  assert.equal((await f.command(`/orders/${sale.id}/returns`, { reason: "超量", items: [{ product_id: id, quantity: 0.0001 }] })).status, 400);
  for (const returnId of returned)
    assert.equal((await f.command(`/orders/${returnId}/void`, { reason: "撤销退货" })).status, 200);
  assert.equal(f.stock(id), 0);
  assert.equal((await f.command(`/orders/${sale.id}/void`, { reason: "撤销销售" })).status, 200);
  assert.equal(f.stock(id), 0.3);
  for (const counted of [0.1234, 0]) {
    const result = await f.command("/stocktakes", { reason: "盘点", items: [{ product_id: id, expected_stock: f.stock(id), counted }] });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(f.stock(id), counted);
  }
  assert.equal(f.db.prepare("SELECT inventory_value_cents FROM products WHERE id=?").get(id).inventory_value_cents, 0);
});

test("reducing stock records an adjustment, caps at available stock and rolls back on failure", async (t) => {
  const f = await fixture(t), id = await f.makeProduct();
  await f.makeOrder(id, "in", 5);
  assert.equal(f.stock(id), 5);
  const before = f.db.prepare("SELECT inventory_value_cents FROM products WHERE id=?").get(id).inventory_value_cents;
  const reduced = await f.command("/stock/reduce", { product_id: id, quantity: 2, expected_stock: 5, reason: "破损报废" });
  assert.equal(reduced.status, 200, JSON.stringify(reduced.data));
  assert.equal(f.stock(id), 3);
  assert.equal(f.db.prepare("SELECT inventory_value_cents FROM products WHERE id=?").get(id).inventory_value_cents, before - 2000);
  const records = (await f.request("/stocktakes")).data;
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "reduce");
  assert.equal(records[0].reason, "破损报废");
  assert.equal(records[0].before_stock, 5);
  assert.equal(records[0].after_stock, 3);
  assert.equal((await f.command("/stock/reduce", { product_id: id, quantity: 4, expected_stock: 3, reason: "超额" })).status, 400);
  assert.equal((await f.command("/stock/reduce", { product_id: id, quantity: 0, expected_stock: 3, reason: "零" })).status, 400);
  assert.equal((await f.command("/stock/reduce", { product_id: id, quantity: 1, expected_stock: 99, reason: "过期" })).status, 400);
  assert.equal(f.stock(id), 3);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM stock_adjustments").get().n, 1);
});

test("decimal import, templates and backup restoration preserve quantities and reject excess precision", async (t) => {
  const f = await fixture(t);
  const rows = rowsToProducts(parseCSV(importTemplate.replace(",5,20", ",0.1234,0.3")));
  const preview = await f.request("/products/import/preview", { rows });
  assert.deepEqual(preview.data.errors, []);
  assert.equal((await f.command("/products/import", { rows, token: preview.data.token })).status, 200);
  const p = f.db.prepare("SELECT * FROM products WHERE barcode='TEST-001'").get();
  assert.equal(p.stock, 0.3);
  assert.equal(p.threshold, 0.1234);
  const template = await f.command("/templates", { name: "小数模板", type: "out", partner: "客户", note: "", items: [{ product_id: p.id, quantity: "0.1234", price: "15" }] });
  assert.equal(template.status, 200, JSON.stringify(template.data));
  await f.makeOrder(p.id, "out", 0.1);
  for (const quantity of [0, -0.1, 0.0000001, 1e-15, 1e-30, 99999999.1, "0.1", null]) {
    const result = await f.request("/orders", { type: "in", partner: "供应商", items: [{ product_id: p.id, quantity, price: 10 }] });
    assert.equal(result.status, 400);
    assert.equal(f.stock(p.id), 0.2);
  }
  const backup = (await f.request("/backup")).data;
  await f.makeOrder(p.id, "in", 1);
  const restorePreview = await f.request("/backup/preview", { backup });
  assert.equal(restorePreview.status, 200, JSON.stringify(restorePreview.data));
  assert.equal((await f.command("/backup/restore", { backup, ...restorePreview.data, confirmation: "RESTORE_BUSINESS_DATA" })).status, 200);
  assert.equal(f.stock(p.id), 0.2);
  assert.equal(JSON.parse(f.db.prepare("SELECT items FROM templates WHERE id=?").get(template.data.id).items)[0].quantity, 0.1234);
  const invalid = structuredClone(backup);
  invalid.data.products.find(product => product.id === p.id).stock = 0.0000001;
  assert.equal((await f.request("/backup/preview", { backup: invalid })).status, 400);
});

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
    name: "批量物料",
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
  const admin = f.db.prepare("SELECT * FROM users").get();
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
  assert.deepEqual(f.db.prepare("SELECT * FROM users").get(), admin);
  assert.equal(
    (await f.request("/data")).data.settings.business_name,
    "保留设置",
  );
  assertRestoredBusiness((await f.request("/backup")).data.data, backup.data);
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
    '物料名称,条码,分类,单位,参考采购价,参考销售价,安全库存,期初库存\r\n"杯子,\n大号",001234,日用,件,1.20,2,0,3';
  const result = rowsToProducts(parseCSV(csv));
  assert.equal(result[0].name, "杯子,\n大号");
  assert.equal(result[0].barcode, "001234");
  assert.throws(() => parseCSV('"missing'));
  assert.throws(() => rowsToProducts([["wrong"]]));
  assert.throws(() =>
    rowsToProducts([
      parseCSV(importTemplate)[0],
      ["物料", "", "日用", "件", "", "2", "0", "0"],
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
    name: `批量导入验证物料${i}`,
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
  for (const { name } of legacy.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'data_revision_*'").all()) legacy.exec(`DROP TRIGGER ${name}`);
  legacy.exec("DROP INDEX orders_source_status");
  for (const column of ["source_order_id", "kind", "status", "stock_applied", "void_reason", "voided_at"]) legacy.exec(`ALTER TABLE orders DROP COLUMN ${column}`);
  legacy.close();
  const migrated = createApp(path);
  try {
    assert.deepEqual(migrated.db.prepare("SELECT id,stock FROM products ORDER BY id").all(), originalStock);
    assert.equal(migrated.db.prepare("SELECT stock_applied FROM orders WHERE number='LEGACY-001'").get().stock_applied, 1);
    assert.equal(migrated.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE stock_applied=0").get().n, 64);
  } finally { migrated.db.close(); }
});


test('material returns increase inventory once, preserve average cost, reject stale and invalid quantities, and survive backup restore', async t => {
  const f = await fixture(t), id = await f.makeProduct();
  const payload = { product_id: id, quantity: 0.1234, expected_stock: 0, reason: '生产余料退回', request_id: randomUUID() };
  assert.equal((await f.request('/stock/increase', payload)).status, 200);
  assert.equal((await f.request('/stock/increase', payload)).status, 200);
  assert.equal(f.stock(id), 0.1234);
  assert.equal(f.db.prepare('SELECT inventory_value_cents FROM products WHERE id=?').get(id).inventory_value_cents, 123);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stock_adjustments WHERE product_id=? AND kind='increase'").get(id).n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders WHERE note=?').get(payload.reason).n, 0);
  assert.equal((await f.command('/stock/increase', { ...payload, request_id: randomUUID() })).status, 400);
  for (const quantity of [0, -1, 0.0000001, '1', 99999999]) {
    const result = await f.command('/stock/increase', { product_id: id, quantity, expected_stock: f.stock(id), reason: '错误数量' });
    assert.equal(result.status, 400);
  }
  assert.equal((await f.command('/stock/increase', { product_id: id, quantity: 1, expected_stock: f.stock(id), reason: '' })).status, 400);
  const warehouse = (await f.request('/warehouses', { name: '退料分仓' })).data.id;
  assert.equal((await f.command(`/stock/increase?warehouse_id=${warehouse}`, { product_id: id, quantity: 1, expected_stock: f.stock(id), reason: '跨仓' })).status, 400);
  f.db.prepare('UPDATE products SET stock=2,inventory_value_cents=3000 WHERE id=?').run(id);
  assert.equal((await f.command('/stock/increase', { product_id: id, quantity: 1, expected_stock: 2, reason: '余料回库' })).status, 200);
  assert.equal(f.db.prepare('SELECT inventory_value_cents FROM products WHERE id=?').get(id).inventory_value_cents, 4500);
  const history = (await f.request(`/products/${id}/history`)).data.records;
  assert.ok(history.some(row => row.event === 'increase' && row.delta === 1));
  const backup = (await f.request('/backup')).data;
  const preview = await f.request('/backup/preview', { backup });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal((await f.command('/backup/restore', { backup, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.equal(f.stock(id), 3);
});

test('business backup uses production group aware format', async t => {
  const f = await fixture(t);
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 41);
  const legacy = structuredClone(backup); legacy.version = 36;
  assert.equal((await f.request('/backup/preview', { backup: legacy })).status, 200);
});

for (const crossInstance of [false, true]) test(`production backup preserves snapshots and ${crossInstance ? 'clears foreign' : 'resolves local'} group and actor IDs`, async t => {
  const f = await fixture(t);
  const group = (await f.request('/production-groups', {name:'Backup group',description:''})).data;
  const product=f.db.prepare('SELECT * FROM products WHERE id=1').get(), material=f.db.prepare('SELECT * FROM products WHERE id=2').get();
  const bom=(await f.command('/boms',{name:'Backup recipe',product_id:product.id,base_quantity:1,base_unit:product.unit,note:'',enabled:1,items:[{product_id:material.id,quantity:1,unit:material.unit,note:''}]})).data;
  const created=await f.command('/production-orders',{bom_id:bom.id,bom_version:bom.version,planned_quantity:1,note:'',production_group_id:group.id});
  assert.equal(created.status,200);
  const id=created.data.id;
  f.db.prepare('UPDATE production_orders SET material_workflow=0 WHERE id=?').run(id);
  const completed=await f.command(`/production-orders/${id}/complete`,{version:created.data.version,completed_quantity:1,finish_order:false,items:[{product_id:material.id,quantity:1,variance_reason:''}],scraps:[]});
  assert.equal(completed.status,200);
  const backup=(await f.request('/backup')).data;
  const before=backup.data.production_batches[0];
  assert.equal(before.production_group_id,group.id); assert.ok(before.created_by);
  if(crossInstance) backup.source_instance_id=randomUUID();
  const preview=await f.request('/backup/preview',{backup}); assert.equal(preview.status,200);
  assert.equal((await f.command('/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA'})).status,200);
  const restored=(await f.request('/backup')).data.data;
  assert.equal(restored.production_orders[0].production_group_id,crossInstance?null:group.id);
  assert.equal(restored.production_batches[0].production_group_id,crossInstance?null:group.id);
  assert.equal(restored.production_batches[0].created_by,crossInstance?null:before.created_by);
  assert.equal(restored.production_batches[0].production_group_name,before.production_group_name);
  assert.equal(restored.production_batches[0].created_by_name,before.created_by_name);
  const legacy=structuredClone(backup); legacy.version=36;
  for(const row of [...legacy.data.production_orders,...legacy.data.production_batches]) {delete row.production_group_id;delete row.production_group_name;}
  for(const row of legacy.data.production_batches) delete row.created_by;
  assert.equal((await f.request('/backup/preview',{backup:legacy})).status,200);
  for(const [field,value] of [['production_group_id',-1],['production_group_name','x'.repeat(61)],['created_by',0],['created_by_name',null]]) {
    const invalid=structuredClone(backup);invalid.data.production_batches[0][field]=value;
    assert.equal((await f.request('/backup/preview',{backup:invalid})).status,400);
  }
});
