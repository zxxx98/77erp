import { assertRestoredBusiness } from './backup-assertions.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";

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
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (
    path,
    body,
    method = body === undefined ? "GET" : "POST",
    auth = true,
  ) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie && auth ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  cookie = (
    await request("/auth/setup", {
      username: "admin",
      password: "Test-password-123",
    })
  ).cookie;
  await request("/settings/reset", { confirmation: "RESET_BUSINESS_DATA" });
  const command = (path, body) =>
    request(path, { request_id: randomUUID(), ...body });
  const product = async () =>
    (
      await request("/products", {
        name: "物料",
        barcode: "COST-001",
        category: "日用",
        unit: "件",
        cost: 10,
        price: 30,
        threshold: 2,
      })
    ).data.id;
  const order = async (id, type, quantity, price, extra = {}) =>
    request("/orders", {
      type,
      partner: type === "in" ? "供应商" : "客户",
      items: [{ product_id: id, quantity, price }],
      ...extra,
    });
  return { db, request, command, product, order };
}
test("moving weighted average fixes sale cost, returns reverse original cost and product edits do not rewrite profit", async (t) => {
  const f = await fixture(t),
    id = await f.product();
  await f.order(id, "in", 10, 10);
  await f.order(id, "in", 10, 20);
  const sale = (await f.order(id, "out", 4, 30)).data;
  assert.equal(
    f.db
      .prepare("SELECT cost_cents FROM order_items WHERE order_id=?")
      .get(sale.id).cost_cents,
    6000,
  );
  assert.equal(
    f.db
      .prepare("SELECT inventory_value_cents FROM products WHERE id=?")
      .get(id).inventory_value_cents,
    24000,
  );
  await f.request(
    `/products/${id}`,
    {
      version: f.db.prepare("SELECT version FROM products WHERE id=?").get(id).version,
      name: "物料",
      barcode: "COST-001",
      category: "日用",
      unit: "件",
      cost: 99,
      price: 100,
      threshold: 2,
    },
    "PUT",
  );
  const returned = await f.command(`/orders/${sale.id}/returns`, {
    reason: "客户退回",
    items: [{ product_id: id, quantity: 1 }],
  });
  assert.equal(returned.status, 200);
  let report = (
    await f.request("/reports/profit?from=1970-01-01&to=2099-12-31")
  ).data;
  assert.equal(report.totals.revenue_cents, 9000);
  assert.equal(report.totals.cost_cents, 4500);
  assert.equal(report.totals.gross_profit_cents, 4500);
  assert.equal(report.inventory_value_cents, 25500);
  assert.equal(
    (
      await f.command(`/orders/${returned.data.id}/void`, {
        reason: "退货录错",
      })
    ).status,
    200,
  );
  report = (await f.request("/reports/profit")).data;
  assert.equal(report.totals.gross_profit_cents, 6000);
  assert.equal(
    (
      await f.command("/stocktakes", {
        reason: "盘亏",
        items: [{ product_id: id, expected_stock: 16, counted: 15 }],
      })
    ).status,
    200,
  );
  assert.equal(
    f.db
      .prepare("SELECT inventory_value_cents FROM products WHERE id=?")
      .get(id).inventory_value_cents,
    22500,
  );
});
test("return allocations preserve all rounded original cents across partial returns", async (t) => {
  const f = await fixture(t),
    id = await f.product();
  await f.order(id, "in", 1, 0.01);
  await f.order(id, "in", 2, 0);
  const sale = (await f.order(id, "out", 3, 1)).data;
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await f.command(`/orders/${sale.id}/returns`, {
          reason: "分次退货",
          items: [{ product_id: id, quantity: 1 }],
        })
      ).status,
      200,
    );
  const report = (await f.request("/reports/profit")).data;
  assert.equal(report.totals.cost_cents, 0);
  assert.equal(report.totals.revenue_cents, 0);
  assert.equal(report.inventory_value_cents, 1);
});
test("contacts are selectable, unique per type, version checked, and preserve order name snapshots", async (t) => {
  const f = await fixture(t),
    id = await f.product();
  const contact = {
    role: "supplier",
    name: "原供应商",
    person: "张先生",
    phone: "13800000000",
    address: "仓库路1号",
    note: "月结",
    active: 1,
  };
  const c = (await f.command("/contacts", contact)).data;
  assert.ok(c.id);
  assert.equal((await f.command("/contacts", contact)).status, 400);
  const incoming = await f.order(id, "in", 1, 10, {
    partner_id: c.id,
    partner: "被忽略的输入",
  });
  assert.equal(incoming.status, 201);
  assert.equal(
    (
      await f.command("/contacts", {
        ...contact,
        id: c.id,
        version: 1,
        name: "新供应商",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.command("/contacts", { ...contact, id: c.id, version: 1 })).status,
    400,
  );
  assert.equal(
    f.db.prepare("SELECT partner FROM orders WHERE id=?").get(incoming.data.id)
      .partner,
    "原供应商",
  );
  assert.equal(
    (
      await f.command("/contacts", {
        ...contact,
        id: c.id,
        version: 2,
        active: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.order(id, "in", 1, 10, { partner_id: c.id })).status,
    400,
  );
});
test("templates are named, reusable, independently editable and do not change stock until an order is submitted", async t => {
  const f = await fixture(t), id = await f.product();
  const body = { name: "每周补货", type: "in", partner: "供应商", partner_id: null, note: "常用组合", items: [{ product_id: id, quantity: "3", price: "10" }] };
  for (const invalid of [{ name: "" }, { items: [] }, { items: [{ product_id: id, quantity: "", price: 10 }] }, { items: [{ product_id: id, quantity: 0, price: 10 }] }, { items: [{ product_id: id, quantity: 1, price: -1 }] }, { items: [{ product_id: id, quantity: 1, price: "1.234" }] }]) {
    assert.equal((await f.command("/templates", { ...body, ...invalid })).status, 400);
  }
  const created = await f.command("/templates", body);
  assert.equal(created.status, 200);
  assert.equal(created.data.name, "每周补货");
  assert.equal(f.db.prepare("SELECT stock FROM products WHERE id=?").get(id).stock, 0);
  const first = await f.order(id, "in", 3, 10);
  const second = await f.order(id, "in", 5, 12);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.data.id, second.data.id);
  assert.equal(f.db.prepare("SELECT stock FROM products WHERE id=?").get(id).stock, 8);
  assert.deepEqual((await f.request("/templates")).data, [created.data]);
  const updated = await f.command("/templates", { ...body, id: created.data.id, version: 1, name: "新补货组合", items: [{ product_id: id, quantity: 4, price: 11 }] });
  assert.equal(updated.data.version, 2);
  assert.equal((await f.command("/templates", { ...body, id: created.data.id, version: 1 })).status, 400);
  assert.equal((await f.command(`/templates/${created.data.id}/delete`, { version: 1 })).status, 400);
  assert.equal((await f.command(`/templates/${created.data.id}/delete`, { version: 2 })).status, 200);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM orders").get().n, 2);
});
test("partial payments, refunds, reversal and void guards keep balances correct and retries do not double pay", async (t) => {
  const f = await fixture(t),
    id = await f.product();
  await f.order(id, "in", 10, 10);
  const sale = (await f.order(id, "out", 5, 20)).data;
  const body = {
    request_id: randomUUID(),
    amount: 40,
    method: "现金",
    note: "首款",
  };
  const first = await f.request(`/orders/${sale.id}/payments`, body);
  assert.equal(first.status, 200);
  assert.equal(
    (await f.request(`/orders/${sale.id}/payments`, body)).data.id,
    first.data.id,
  );
  const payments = (await f.request(`/orders/${sale.id}/payments`)).data;
  assert.equal(payments.payment_status, "partial");
  assert.equal(payments.due_cents, 6000);
  assert.equal(
    (
      await f.command(`/orders/${sale.id}/payments`, {
        amount: 61,
        method: "现金",
        note: "",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.command(`/orders/${sale.id}/void`, { reason: "有收款" })).status,
    400,
  );
  const returned = (
    await f.command(`/orders/${sale.id}/returns`, {
      reason: "退两件",
      items: [{ product_id: id, quantity: 2 }],
    })
  ).data;
  const balance = (await f.request("/finance")).data.balances.find(
    (b) => b.name === "客户",
  );
  assert.equal(balance.receivable_cents, 6000);
  assert.equal(balance.payable_cents, 4000);
  assert.equal(
    (
      await f.command(`/orders/${returned.id}/payments`, {
        amount: 40,
        method: "现金退款",
        note: "",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.command(`/payments/${first.data.id}/reverse`, {
        reason: "登记错误",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request(`/orders/${sale.id}/payments`)).data.due_cents,
    10000,
  );
});
test("unknown historical costs and settlement are explicit, and v11 backup round trips contacts, templates and payments", async (t) => {
  const f = await fixture(t),
    id = await f.product();
  await f.order(id, "in", 10, 10);
  const sale = (await f.order(id, "out", 1, 20)).data;
  f.db
    .prepare("UPDATE orders SET settlement_tracked=0 WHERE id=?")
    .run(sale.id);
  f.db
    .prepare("UPDATE order_items SET cost_cents=NULL WHERE order_id=?")
    .run(sale.id);
  const report = (await f.request("/reports/profit")).data;
  assert.equal(report.totals.unknown_revenue_cents, 2000);
  assert.equal(report.totals.gross_profit_cents, 0);
  assert.equal(
    (
      await f.command(`/orders/${sale.id}/payments`, {
        amount: 1,
        method: "现金",
        note: "",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.command(`/orders/${sale.id}/settlement`, {
        paid: 10,
        note: "对账确认",
        confirmation: "TRACK_SETTLEMENT",
      })
    ).status,
    200,
  );
  await f.command("/templates", { name: "常用模板",
    type: "out",
    partner: "客户",
    partner_id: null,
    note: "下次",
    items: [{ product_id: id, quantity: "2", price: "20" }],
  });
  const backup = (await f.request("/backup")).data;
  assert.equal(backup.version, 13);
  assert.equal(backup.data.payments.length, 1);
  assert.equal(backup.data.templates.length, 1);
  await f.request("/settings/reset", { confirmation: "RESET_BUSINESS_DATA" });
  const preview = (await f.request("/backup/preview", { backup })).data;
  assert.equal(
    (
      await f.command("/backup/restore", {
        backup,
        ...preview,
        confirmation: "RESTORE_BUSINESS_DATA",
      })
    ).status,
    200,
  );
  assertRestoredBusiness((await f.request("/backup")).data.data, backup.data);
  const old = structuredClone(backup);
  old.version = 1;
  delete old.data.contacts;
  delete old.data.templates;
  delete old.data.payments;
  old.data.products.forEach((p) => delete p.inventory_value_cents);
  old.data.orders.forEach((o) => {
    delete o.partner_id;
    delete o.settlement_tracked;
  });
  old.data.order_items.forEach((i) => delete i.cost_cents);
  assert.equal(
    (await f.request("/backup/preview", { backup: old })).status,
    200,
  );
  for (const path of ["/contacts", "/templates", "/finance", "/reports/profit"])
    assert.equal((await f.request(path, undefined, "GET", false)).status, 401);
});

test('fractional returns conserve cents through split refunds, voids, profit and backup restore', async t => {
  const f = await fixture(t), id = await f.product();
  await f.order(id, 'in', 1, 0.01);
  const sale = (await f.order(id, 'out', 1, 0.01)).data;
  const refund = async quantity => {
    const r = await f.command(`/orders/${sale.id}/returns`, { reason: '分批退货', items: [{ product_id: id, quantity }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.id;
  };
  const first = await refund(0.5), second = await refund(0.5);
  const line = orderId => f.db.prepare('SELECT * FROM order_items WHERE order_id=?').get(orderId);
  assert.equal(line(first).amount_cents, 1);
  assert.equal(line(second).amount_cents, 0);
  assert.equal((await f.request(`/orders/${second}/payments`)).data.payment_status, 'paid');
  assert.equal((await f.command(`/orders/${second}/payments`, { amount: 0.01, method: '现金', note: '' })).status, 400);
  assert.equal((await f.request('/reports/profit')).data.totals.revenue_cents, 0);
  assert.equal((await f.request('/reports/profit')).data.totals.gross_profit_cents, 0);
  assert.equal((await f.command(`/orders/${first}/void`, { reason: '重退' })).status, 200);
  const replacement = await refund(0.5);
  assert.equal(line(replacement).amount_cents, 1);
  const workspace = (await f.request('/data')).data;
  assert.equal(workspace.orders.find(o => o.id === second).items[0].amount_cents, 0);
  assert.equal(workspace.orders.find(o => o.id === sale.id).items[0].returned_quantity, 1);
  const balance = (await f.request('/finance')).data.balances.find(b => b.role === 'customer');
  assert.equal(balance.payable_cents, 1);
  const backup = (await f.request('/backup')).data;
  const preview = await f.request('/backup/preview', { backup });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal((await f.command('/backup/restore', { backup, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.equal((await f.request('/reports/profit')).data.totals.revenue_cents, 0);
  assert.equal(line(second).amount_cents, 0);
  const corrupt = structuredClone(backup);
  corrupt.data.order_items.find(i => i.order_id === second).amount_cents = 1;
  corrupt.data.orders.find(o => o.id === second).total = 0.01;
  assert.equal((await f.request('/backup/preview', { backup: corrupt })).status, 400);
});

test('purchase return tails and legacy v10 refunds retain their financial history', async t => {
  const f = await fixture(t), id = await f.product();
  const purchase = (await f.order(id, 'in', 1, 0.01)).data;
  for (const quantity of [0.5, 0.5]) assert.equal((await f.command(`/orders/${purchase.id}/returns`, {
    reason: '分批采购退货', items: [{ product_id: id, quantity }],
  })).status, 200);
  assert.equal(f.db.prepare("SELECT SUM(total) n FROM orders WHERE kind='return'").get().n, 0.01);
  const legacy = (await f.request('/backup')).data;
  legacy.version = 10;
  for (const item of legacy.data.order_items) delete item.amount_cents;
  // Real v10 files rounded each half independently; preserve those already-booked refunds.
  for (const order of legacy.data.orders) if (order.kind === 'return') order.total = 0.01;
  const preview = await f.request('/backup/preview', { backup: legacy });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal((await f.command('/backup/restore', { backup: legacy, ...preview.data, confirmation: 'RESTORE_BUSINESS_DATA' })).status, 200);
  assert.equal(f.db.prepare("SELECT SUM(total) n FROM orders WHERE kind='return'").get().n, 0.02);
  // A new backup of historical data must remain restorable.
  const upgraded = (await f.request('/backup')).data;
  assert.equal(upgraded.version, 13);
  assert.equal((await f.request('/backup/preview', { backup: upgraded })).status, 200);
});

test('return allocation also carries sub-cent remainders forward until the final fractional return', async t => {
  const f = await fixture(t), id = await f.product();
  await f.order(id, 'in', 1, 0.01);
  const sale = (await f.order(id, 'out', 1, 0.01)).data;
  const amounts = [];
  for (const quantity of [0.333333, 0.333333, 0.333334]) {
    const returned = await f.command(`/orders/${sale.id}/returns`, { reason: '三次退完', items: [{ product_id: id, quantity }] });
    assert.equal(returned.status, 200, JSON.stringify(returned.data));
    amounts.push(f.db.prepare('SELECT amount_cents FROM order_items WHERE order_id=?').get(returned.data.id).amount_cents);
  }
  assert.deepEqual(amounts, [0, 0, 1]);
  const report = (await f.request('/reports/profit')).data;
  assert.equal(report.totals.revenue_cents, 0);
  assert.equal(report.totals.cost_cents, 0);
  assert.equal(report.totals.gross_profit_cents, 0);
  const backup = (await f.request('/backup')).data;
  assert.equal((await f.request('/backup/preview', { backup })).status, 200);
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const corrupt = structuredClone(backup);
    corrupt.data.order_items[0].amount_cents = amount;
    assert.equal((await f.request('/backup/preview', { backup: corrupt })).status, 400);
  }
});
