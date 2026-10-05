import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";

async function fixture(page) {
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.request.post(base + "/api/auth/setup", {
    data: { username: "business", password: "Test-password-123" },
  });
  await page.request.post(base + "/api/settings/reset", {
    data: { confirmation: "RESET_BUSINESS_DATA" },
  });
  const p = await (
    await page.request.post(base + "/api/products", {
      data: {
        name: "商务商品",
        barcode: "BUSINESS-001",
        category: "日用",
        unit: "件",
        cost: 10,
        price: 30,
        threshold: 2,
      },
    })
  ).json();
  return {
    base,
    db,
    id: p.id,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}
test("contact selection, saved draft resume, payment bookkeeping and margin report work together", async ({
  page,
}) => {
  const f = await fixture(page),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(f.base + "/?manage=data");
    await page.getByRole("button", { name: "往来与财务", exact: false }).click();
    await page.getByLabel("单位名称", { exact: true }).fill("常用供应商");
    await page.getByLabel("联系人", { exact: true }).fill("王先生");
    await page.getByLabel("联系电话", { exact: true }).fill("13812345678");
    await page
      .getByRole("button", { name: "保存往来单位", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "供应商 · 常用供应商", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("link", { name: "采购入库", exact: true }).click();
    await page.getByRole("button", { name: "新建入库", exact: true }).click();
    await page.getByPlaceholder("选择或输入供应商").fill("常用供应商");
    await page.getByRole("textbox", { name: "查找并添加商品" }).fill("商务");
    await page.locator(".picker-results button").first().click();
    await page
      .getByRole("spinbutton", { name: "商务商品 数量", exact: true })
      .fill("10");
    await page
      .getByRole("button", { name: "保存草稿并关闭", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock,
    ).toBe(0);
    const draft = f.db.prepare("SELECT * FROM drafts").get();
    await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "往来与财务", exact: false }).click();
    await page.getByRole("button", { name: "单据草稿", exact: true }).click();
    await page
      .getByRole("button", { name: `继续草稿 #${draft.id}`, exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "商务商品 数量", exact: true }),
    ).toHaveValue("10");
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock,
    ).toBe(10);
    const incoming = f.db.prepare("SELECT * FROM orders WHERE type='in'").get();
    expect(incoming.partner_id).toBeTruthy();
    await page.getByText(incoming.number, { exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "收付款金额", exact: true })
      .fill("40");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "登记收付款", exact: true }).click();
    await expect(page.getByText(/部分收付.*60.00/)).toBeVisible();
    await page
      .getByRole("spinbutton", { name: "收付款金额", exact: true })
      .fill("40");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "登记收付款", exact: true }).click();
    await expect(page.getByText(/部分收付.*20.00/)).toBeVisible();
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM payments").get().n).toBe(2);
    for (let i = 0; i < 2; i++) {
      page.once("dialog", (d) => d.accept("录错金额"));
      await page
        .getByRole("button", { name: /撤销登记 #/ })
        .first()
        .click();
      await expect(
        page.getByRole("button", { name: /撤销登记 #/ }),
      ).toHaveCount(1 - i);
    }
    await expect(page.getByText(/未收付.*100.00/)).toBeVisible();
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await page.request.post(f.base + "/api/orders", {
      data: {
        type: "out",
        partner: "客户",
        items: [{ product_id: f.id, quantity: 2, price: 30 }],
      },
    });
    await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "往来与财务", exact: false }).click();
    await page.getByRole("button", { name: "成本与毛利", exact: true }).click();
    await expect(page.getByText(/已知毛利 ¥ 40.00/)).toBeVisible();
    await page
      .getByRole("button", { name: "收付款与欠款", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "¥ 60.00", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});
