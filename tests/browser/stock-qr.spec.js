import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function fixture(page) {
  await page.request.post("/api/auth/setup", {
    data: { username: "admin", password: "Test-admin-123" },
  });
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: { username: "admin", password: "Test-admin-123" },
      })
    ).ok(),
  ).toBe(true);
  const tag = randomUUID().slice(0, 8),
    products = [];
  for (const [name, unit] of [
    [`组合杯${tag}`, "个"],
    [`组合箱${tag}`, "箱"],
  ]) {
    const body = {
      name,
      unit,
      barcode: `QRUI-${products.length}-${tag}`,
      category: "生活日用",
      cost: 10,
      price: 20,
      threshold: 0,
    };
    const r = await page.request.post("/api/products", { data: body });
    expect(r.ok()).toBe(true);
    products.push({ ...body, ...(await r.json()) });
  }
  const data = await (await page.request.get("/api/data")).json();
  const qr = async (overrides) => {
    const r = await page.request.post("/api/stock-qrs", {
      data: {
        name: `组合单${tag}`,
        type: "in",
        partner: "测试二维码供应商",
        max_scans: 3,
        items: products.map((p, i) => ({
          product_id: p.id,
          quantity: i ? 2 : 5,
          price_cents: 1000,
        })),
        request_id: randomUUID(),
        ...overrides,
      },
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const label = (q) =>
    JSON.stringify({
      format: "77erp",
      version: 1,
      type: "stock_operation",
      source_id: data.instance_id,
      warehouse_id: 1,
      qr_id: q.qr_id,
    });
  const snapshot = async () => {
    const d = await (await page.request.get("/api/data")).json();
    return {
      stocks: products.map((p) => d.products.find((i) => i.id === p.id).stock),
      orders: d.orders.filter((o) =>
        o.items.some((i) => products.some((p) => p.id === i.product_id)),
      ),
    };
  };
  const scan = async (q) => {
    await page
      .getByRole("textbox", { name: "物料条码", exact: true })
      .fill(label(q));
    await page
      .getByRole("textbox", { name: "物料条码", exact: true })
      .press("Enter");
  };
  const open = async () => {
    await page.goto("/#scanner");
    await page.getByRole("button", { name: "扫码入库", exact: true }).click();
    await page
      .getByRole("button", { name: "手动输入条码", exact: true })
      .click();
  };
  return { products, qr, label, snapshot, scan, open };
}

test("create and edit a multi-item QR, confirm the entire order, cancel without quota and export label", async ({
  page,
}) => {
  const f = await fixture(page);
  await f.open();
  await page.getByRole("button", { name: "管理出入库二维码" }).click();
  await page.getByRole("button", { name: "新建二维码", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("二维码名称", { exact: true }).fill("网页组合配置");
  await expect(
    dialog.getByRole("checkbox", { name: "需要二次确认" }),
  ).toBeChecked();
  for (const p of f.products) {
    await dialog.getByLabel("搜索添加物料").fill(p.name);
    await dialog
      .getByRole("button", { name: `${p.name} · ${p.barcode}`, exact: true })
      .click();
  }
  await dialog.getByLabel(`${f.products[0].name} 单次数量（个）`).fill("5");
  await dialog.getByLabel(`${f.products[1].name} 单次数量（箱）`).fill("2");
  await dialog.getByLabel("可扫描次数（累计上限）").fill("3");
  await dialog.getByLabel("往来单位", { exact: true }).fill("网页组合供应商");
  await dialog.getByRole("button", { name: "保存二维码", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "出入库二维码" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载标签" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/-stock-qr.svg$/);
  const q = (await (await page.request.get("/api/stock-qrs")).json()).rows.find(
    (q) => q.name === "网页组合配置",
  );
  expect(q.items).toHaveLength(2);
  await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  await f.scan(q);
  const confirmation = page.getByRole("dialog");
  await expect(
    confirmation.getByRole("heading", { name: "确认入库", exact: true }),
  ).toBeVisible();
  for (const p of f.products)
    await expect(confirmation.getByText(p.name, { exact: true })).toBeVisible();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect((await f.snapshot()).stocks).toEqual([0, 0]);
  await f.scan(q);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认入库", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/单据 RK.* 已保存/).first()).toBeVisible();
  const saved = await f.snapshot();
  expect(saved.stocks).toEqual([5, 2]);
  expect(saved.orders).toHaveLength(1);
  expect(saved.orders[0].items).toHaveLength(2);
  await page.getByRole("button", { name: "管理出入库二维码" }).click();
  await page
    .getByRole("button", { name: "编辑 网页组合配置", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(`${f.products[0].name} 单次数量（个）`)
    .fill("7");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "保存二维码", exact: true }).click();
  await expect(page.getByRole("img", { name: "出入库二维码" })).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await f.scan(q);
  await expect(page.getByRole("dialog").getByText(/7 个 ×/)).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认入库", exact: true })
    .click();
  await expect.poll(async () => (await f.snapshot()).stocks).toEqual([12, 4]);
});

test("no-confirmation QR executes all lines once and rejects exhausted quota and wrong mode", async ({
  page,
}) => {
  const f = await fixture(page),
    q = await f.qr({ require_confirmation: false, max_scans: 1 });
  await f.open();
  await page.getByRole("button", { name: "扫码出库", exact: true }).click();
  await f.scan(q);
  await expect(
    page.getByText("这是入库二维码，请切换到对应扫码模式。"),
  ).toBeVisible();
  expect((await f.snapshot()).stocks).toEqual([0, 0]);
  await page.getByRole("button", { name: "扫码入库", exact: true }).click();
  await f.scan(q);
  await expect.poll(async () => (await f.snapshot()).stocks).toEqual([5, 2]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await f.scan(q);
  await expect(page.getByText("该二维码可扫描次数已用完。")).toBeVisible();
  expect((await f.snapshot()).orders).toHaveLength(1);
});

test("a committed request with lost response survives refresh and retries without a second order", async ({
  page,
}) => {
  const f = await fixture(page),
    q = await f.qr({ require_confirmation: false, max_scans: null });
  await f.open();
  await page.route(
    `**/api/stock-qrs/${q.qr_id}/execute`,
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await f.scan(q);
  await expect(
    page.getByRole("button", { name: "重试原扫码请求" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重试原扫码请求" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试原扫码请求" }).click();
  await expect(
    page.getByRole("button", { name: "重试原扫码请求" }),
  ).toHaveCount(0);
  expect((await f.snapshot()).stocks).toEqual([5, 2]);
  expect((await f.snapshot()).orders).toHaveLength(1);
});
