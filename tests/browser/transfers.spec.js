import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { randomUUID } from "node:crypto";

async function fixture(page) {
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.request.post(base + "/api/auth/setup", {
    data: { username: "transfer", password: "Test-password-123" },
  });
  await page.request.post(base + "/api/settings/reset", {
    data: { confirmation: "RESET_BUSINESS_DATA" },
  });
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  };
  return { base, db, close };
}

test("warehouse transfers create linked legs, appear in both warehouses and stay out of money totals", async ({ page }) => {
  const f = await fixture(page), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    // The fixture resets business data, so the catalog starts empty.
    const category = await (await page.request.post(f.base + "/api/categories", { data: { name: "调拨分类" } })).json();
    const product = await (await page.request.post(f.base + "/api/products", {
      data: { name: "浏览器调拨物料", barcode: "BT-001", category: "调拨分类", category_id: category.id, unit: "件", cost: 10, price: 20, threshold: 2 },
    })).json();
    expect((await page.request.post(f.base + "/api/orders", { data: { type: "in", partner: "调拨供应商", items: [{ product_id: product.id, quantity: 10, price: 10 }] } })).ok()).toBe(true);
    const target = await (await page.request.post(f.base + "/api/warehouses", { data: { name: "分仓" } })).json();
    const transfer = await (await page.request.post(f.base + "/api/transfers", {
      data: { request_id: randomUUID(), to_warehouse_id: target.id, note: "门店补货", items: [{ product_id: product.id, quantity: 4 }] },
    })).json();
    expect(transfer.ok).toBe(true);

    // The transfer form reports what moved and where it went.
    await page.goto(f.base + "/#inventory");
    await page.getByRole("button", { name: "仓库调拨" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "仓库调拨" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText(transfer.number)).toBeVisible();
    await expect(dialog.getByText("发往 分仓")).toBeVisible();
    await expect(dialog.getByText("成本 ¥40.00")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "撤销调拨" })).toBeVisible();
    // The product is now stocked here and in the destination warehouse.
    await expect(page.getByText("浏览器调拨物料").first()).toBeVisible();
    await dialog.getByRole("button", { name: "取消" }).click();

    // 操作记录 lists both directions of the transfer and never as a sale.
    await page.goto(f.base + "/#history");
    await page.getByRole("button", { name: /仓库调拨/ }).click();
    await expect(page.getByText(transfer.number)).toBeVisible();
    await expect(page.getByText("不涉及金额").first()).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`查看单据 ${transfer.number}`) }).click();
    await expect(page.getByRole("dialog").getByText("调拨出库单详情")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("发往仓库")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "作废单据" })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByText(/不涉及金额/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "关闭详情" }).click();

    // The destination warehouse shows the inbound leg and its new stock.
    await page.goto(`${f.base}/?warehouse_id=${target.id}#inventory`);
    await expect(page.getByText("浏览器调拨物料").first()).toBeVisible();
    await page.goto(`${f.base}/?warehouse_id=${target.id}#history`);
    await expect(page.getByText(transfer.in_number)).toBeVisible();

    // Undo is owned by the source warehouse, so it happens back in the main one.
    await page.goto(f.base + "/?warehouse_id=1#inventory");
    await page.getByRole("button", { name: "仓库调拨" }).click();
    await page.getByRole("button", { name: "撤销调拨" }).click();
    await page.getByLabel("撤销原因").fill("测试撤销");
    // The confirmation guard must be accepted before the reversal runs.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "确认撤销" }).click();
    await expect(page.getByText("调拨已撤销，库存已恢复")).toBeVisible();
    // Every warehouse lists only its own leg of the undone transfer.
    const mainLegs = await (await page.request.get(`${f.base}/api/orders?kind=transfer`)).json();
    expect(mainLegs.orders.map((order) => [order.type, order.status])).toEqual([["out", "void"]]);
    const remoteLegs = await (await page.request.get(`${f.base}/api/orders?kind=transfer`, { headers: { "X-Warehouse-ID": String(target.id) } })).json();
    expect(remoteLegs.orders.map((order) => [order.type, order.status])).toEqual([["in", "void"]]);

    // The form itself creates a pair: search, quantity, destination and confirm.
    const second = await (await page.request.post(f.base + "/api/products", {
      data: { name: "浏览器调拨物料2", barcode: "BT-002", category: "调拨分类", category_id: category.id, unit: "件", cost: 5, price: 12, threshold: 1 },
    })).json();
    await page.request.post(f.base + "/api/orders", { data: { type: "in", partner: "调拨供应商", items: [{ product_id: second.id, quantity: 6, price: 5 }] } });
    await page.goto(f.base + "/?warehouse_id=1#inventory");
    await page.getByRole("button", { name: "仓库调拨" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("搜索要调拨的物料").fill("浏览器调拨物料2");
    await form.getByRole("button", { name: "添加" }).click();
    await form.getByLabel("浏览器调拨物料2 调拨数量").fill("2");
    await form.getByRole("button", { name: "展开调入仓库列表" }).click();
    await page.getByRole("listbox", { name: "调入仓库" }).getByRole("option", { name: "分仓" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "确认调拨" }).click();
    // Saving closes the modal and reports through the shared toast.
    await expect(page.getByText("仓库调拨已完成")).toBeVisible();
    await page.getByRole("button", { name: "仓库调拨" }).click();
    await expect(page.getByRole("dialog").getByText("发往 分仓").first()).toBeVisible();
    // The moved stock is visible in both warehouses right away.
    const stocks = await (await page.request.get(`${f.base}/api/products?q=BT-002`)).json();
    expect(stocks.products[0].stock).toBe(4);
    const remote = await (await page.request.get(`${f.base}/api/products?q=BT-002`, { headers: { "X-Warehouse-ID": String(target.id) } })).json();
    expect(remote.products[0].stock).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});
