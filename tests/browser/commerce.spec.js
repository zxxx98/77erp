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
test("contact selection, reusable template, payment bookkeeping and margin report work together", async ({
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
    await page.getByLabel("模板名称", { exact: true }).fill("每周补货");
    await page.getByRole("button", { name: "保存为模板", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("每周补货");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock,
    ).toBe(0);
    const template = f.db.prepare("SELECT * FROM templates").get();
    await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "往来与财务", exact: false }).click();
    await page.getByRole("button", { name: "单据模板", exact: true }).click();
    await page
      .getByRole("button", { name: `使用模板 #${template.id}`, exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "商务商品 数量", exact: true }),
    ).toHaveValue("10");
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock,
    ).toBe(10);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM templates").get().n).toBe(1);
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

test("template picker filters by order type, preserves canceled edits and fits a narrow screen", async ({ page }) => {
  const f = await fixture(page);
  try {
    const template = await (await page.request.post(f.base + "/api/templates", {
      data: { name: "采购补货组合", request_id: "picker-in", type: "in", partner: "继续采购的供应商", note: "待核对数量", items: [{ product_id: f.id, quantity: 1, price: 10 }] },
    })).json();
    await page.request.post(f.base + "/api/templates", {
      data: { name: "销售常用组合", request_id: "picker-out", type: "out", partner: "销售模板客户", note: "", items: [{ product_id: f.id, quantity: 1, price: 10 }] },
    });
    await page.goto(f.base);
    await page.getByRole("link", { name: "采购入库", exact: true }).click();
    await page.getByRole("button", { name: "新建入库", exact: true }).click();
    const picker = page.getByRole("button", { name: "选择单据模板", exact: true });
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(picker).toContainText("1 份");
    await picker.focus();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("继续采购的供应商", { exact: true })).toBeVisible();
    await expect(page.getByText("销售模板客户", { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const card = page.locator(".template-card");
    const bounds = await card.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(picker).toBeFocused();
    await expect(page.getByPlaceholder("选择或输入供应商")).toHaveValue("继续采购的供应商");
    await expect(page.locator(".order-template-status")).toContainText("已套用「采购补货组合」");

    await page.getByPlaceholder("选择或输入供应商").fill("当前正在编辑的供应商");
    await picker.click();
    await expect(card.getByText("本次已套用", { exact: true })).toBeVisible();
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByPlaceholder("选择或输入供应商")).toHaveValue("当前正在编辑的供应商");

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: `删除模板 #${template.id}`, exact: true }).click();
    await expect(page.getByText("暂无模板", { exact: true })).toBeVisible();
    await expect(picker).toContainText("0 份");
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM templates WHERE type='out'").get().n).toBe(1);
  } finally {
    await f.close();
  }
});

test("one template can create multiple independent orders, with explicit update and save as a copy", async ({ page }) => {
  const f = await fixture(page);
  try {
    const template = await (await page.request.post(f.base + "/api/templates", {
      data: { name: "每周采购", request_id: "repeat-template", type: "in", partner: "常用供应商", note: "", items: [{ product_id: f.id, quantity: 2, price: 10 }] },
    })).json();
    await page.goto(f.base);
    await page.getByRole("link", { name: "采购入库", exact: true }).click();
    for (const quantity of [3, 4]) {
      await page.getByRole("button", { name: "新建入库", exact: true }).click();
      await page.getByRole("button", { name: "选择单据模板", exact: true }).click();
      await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
      await expect(page.getByRole("spinbutton", { name: "商务商品 数量", exact: true })).toHaveValue("2");
      await page.getByRole("spinbutton", { name: "商务商品 数量", exact: true }).fill(String(quantity));
      await page.getByRole("button", { name: "确认入库", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(JSON.parse(f.db.prepare("SELECT items FROM templates WHERE id=?").get(template.id).items)[0].quantity).toBe(2);
    }
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM orders").get().n).toBe(2);
    expect(f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock).toBe(7);
    await page.getByRole("button", { name: "新建入库", exact: true }).click();
    await page.getByRole("button", { name: "选择单据模板", exact: true }).click();
    await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
    await page.getByRole("spinbutton", { name: "商务商品 数量", exact: true }).fill("5");
    await page.getByLabel("模板名称", { exact: true }).fill("每月采购");
    await page.getByRole("button", { name: "更新模板", exact: true }).click();
    await expect(page.locator(".template-success")).toContainText("每月采购");
    expect(f.db.prepare("SELECT name, version FROM templates WHERE id=?").get(template.id)).toMatchObject({ name: "每月采购", version: 2 });
    await page.getByLabel("模板名称", { exact: true }).fill("临时采购组合");
    await page.getByRole("button", { name: "另存为模板", exact: true }).click();
    await expect(page.locator(".template-success")).toContainText("临时采购组合");
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM templates").get().n).toBe(2);
    expect(f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock).toBe(7);
    await page.getByRole("button", { name: "取消", exact: true }).click();
  } finally {
    await f.close();
  }
});
