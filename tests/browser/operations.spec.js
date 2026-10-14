import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";
import { readFile } from "node:fs/promises";
import { importTemplate } from "../../src/data-files.js";

async function fixture(page) {
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.request.post(base + "/api/auth/setup", {
    data: { username: "operations", password: "Test-password-123" },
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
const settings = async (page) => {
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: /备份与恢复/ }).click();
};
const accept = (page) => page.once("dialog", (dialog) => dialog.accept());

test("shared business management handles import and stocktake while settings retain backup and restore", async ({
  page,
}) => {
  const f = await fixture(page),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(f.base + "/?manage=data");
    await page.getByRole("button", { name: "批量导入", exact: true }).click();
    await page
      .getByLabel("选择物料文件")
      .setInputFiles({
        name: "products.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(importTemplate.replace(",5,20", ",0.5,20.25")),
      });
    await expect(
      page.getByText("共 1 行，0 行错误。确认前请核对预览。"),
    ).toBeVisible();
    await page.getByRole('button', { name: '库存盘点', exact: true }).click();
    await page.getByRole('button', { name: '批量导入', exact: true }).click();
    await expect(page.getByText('共 1 行，0 行错误。确认前请核对预览。')).toBeVisible();
    accept(page);
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(f.db.prepare("SELECT stock FROM products").get().stock).toBe(20.25);
    await page.getByRole("button", { name: "业务管理", exact: true }).click();
    await page.getByRole("button", { name: "库存盘点", exact: true }).click();
    await page.getByRole("checkbox", { name: /示例电线/ }).check();
    await page
      .getByRole("spinbutton", { name: "示例电线 实盘数量" })
      .fill("18.125");
    await page.getByLabel("盘点原因").fill("盘点差异");
    accept(page);
    await page.getByRole("button", { name: "确认盘点", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(f.db.prepare("SELECT stock FROM products").get().stock).toBe(18.125);
    await settings(page);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载业务备份", exact: true })
      .click();
    const download = await downloadEvent;
    const backup = await readFile(await download.path());
    expect(JSON.parse(backup).data.products[0].stock).toBe(18.125);
    accept(page);
    await page
      .getByRole("button", { name: "重置业务数据", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM products").get().n).toBe(0);
    await settings(page);
    await page
      .getByLabel("选择备份文件")
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: backup,
      });
    await expect(
      page.getByText(/物料 1 件，单据 0 张，库存调整 2 条/),
    ).toBeVisible();
    accept(page);
    await page
      .getByRole("button", { name: "确认恢复备份", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(f.db.prepare("SELECT stock FROM products").get().stock).toBe(18.125);
    expect((await page.request.get(f.base + "/api/data")).status()).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(f.base + "/?manage=data");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto(f.base + '/?manage=backup');
    await expect(page.getByRole('button', { name: '下载业务备份', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '批量导入', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("order details create partial returns and void return orders with confirmation", async ({
  page,
}) => {
  const f = await fixture(page),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const product = await (
      await page.request.post(f.base + "/api/products", {
        data: {
          name: "退货物料",
          barcode: "RET-001",
          category: "日用",
          unit: "件",
          cost: 10,
          price: 20,
          threshold: 2,
        },
      })
    ).json();
    const incoming = await (
      await page.request.post(f.base + "/api/orders", {
        data: {
          type: "in",
          partner: "供应商",
          items: [{ product_id: product.id, quantity: 10, price: 10 }],
        },
      })
    ).json();
    await page.goto(f.base + "/#history");
    await page.getByText(incoming.number, { exact: true }).click();
    await page.getByLabel("操作原因").fill("退回破损");
    await page.getByRole("spinbutton", { name: "退货物料 退货数量" }).fill("2");
    accept(page);
    await page.getByRole("button", { name: "确认退货", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(f.db.prepare("SELECT stock FROM products").get().stock).toBe(8);
    const returned = f.db
      .prepare("SELECT * FROM orders WHERE kind='return'")
      .get();
    await page.getByText(returned.number, { exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "采购退货单详情" }),
    ).toBeVisible();
    await page.getByLabel("操作原因").fill("退货录错");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "作废单据", exact: true }).click();
    expect(f.db.prepare("SELECT stock FROM products").get().stock).toBe(8);
    accept(page);
    await page.getByRole("button", { name: "作废单据", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(f.db.prepare("SELECT stock FROM products").get().stock).toBe(10);
    await expect(
      page.getByText("采购退货 · 已作废", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("Excel xlsx first worksheet imports through preview", async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.goto(f.base + "/?manage=data");
    await page.getByRole("button", { name: "批量导入", exact: true }).click();
    await page
      .getByLabel("选择物料文件")
      .setInputFiles("tests/fixtures/products.xlsx");
    await expect(
      page.getByText("共 1 行，0 行错误。确认前请核对预览。"),
    ).toBeVisible();
    accept(page);
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      f.db.prepare("SELECT barcode,stock FROM products").get(),
    ).toMatchObject({ barcode: "001234", stock: 7 });
  } finally {
    await f.close();
  }
});

test('a fully returned fractional sale displays its zero-cent tail instead of recomputing price times quantity', async ({ page }) => {
  const f = await fixture(page);
  try {
    const product = await (await page.request.post(f.base + '/api/products', { data: {
      name: '尾差物料', barcode: 'TAIL-001', category: '日用', unit: '件', cost: 0.01, price: 0.01, threshold: 0,
    } })).json();
    for (const type of ['in', 'out']) await page.request.post(f.base + '/api/orders', { data: {
      type, partner: type === 'in' ? '供应商' : '客户', items: [{ product_id: product.id, quantity: 1, price: 0.01 }],
    } });
    const sale = f.db.prepare("SELECT * FROM orders WHERE type='out'").get();
    let tail;
    for (let n = 0; n < 2; n++) tail = await (await page.request.post(`${f.base}/api/orders/${sale.id}/returns`, {
      data: { request_id: `tail-${n}`, reason: '分批退货', items: [{ product_id: product.id, quantity: 0.5 }] },
    })).json();
    await page.goto(f.base + '/#history');
    await page.getByText(tail.number, { exact: true }).click();
    const row = page.getByRole('dialog').getByRole('row').filter({ hasText: '尾差物料' });
    await expect(row.getByRole('cell').last()).toHaveText('¥ 0.00');
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /导出/ }).click();
    const csv = await readFile(await (await download).path(), 'utf8');
    expect(csv).toContain('明细金额');
    expect(csv.split('\n').find(line => line.includes(tail.number))).toContain('"0.00"');
  } finally { await f.close(); }
});
