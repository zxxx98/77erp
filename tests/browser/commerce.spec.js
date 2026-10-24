import { selectedControl } from './dropdown-helpers.js';
import { ensureContact, chooseContact } from './contact-helpers.js';
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
        name: "商务物料",
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
for (const width of [1440, 390]) {
  test(`order partner dropdowns show active contacts and preserve their IDs at width ${width}`, async ({ page }) => {
    const f = await fixture(page);
    try {
      await page.setViewportSize({ width, height: 844 });
      const rows = [];
      for (const [role, name, active] of [["supplier", "常用供应商", 1], ["supplier", "备用供应商", 1], ["customer", "城南门店", 1], ["supplier", "停用供应商", 0]]) {
        const response = await page.request.post(f.base + "/api/contacts", {
          data: { request_id: `partner-${name}`, role, name, active, person: "王先生", phone: "13812345678", address: "", note: "" },
        });
        expect(response.ok()).toBe(true);
        rows.push(await response.json());
      }
      await page.goto(f.base);
      for (const type of ["in", "out"]) {
        await page.getByRole("link", { name: type === "in" ? "入库" : "出库", exact: true }).click();
        await page.getByRole("button", { name: type === "in" ? "新建入库" : "新建出库", exact: true }).click();
        const label = type === "in" ? "供应商" : "客户 / 往来单位";
        const input = page.getByRole("combobox", { name: label });
        await expect(input).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await input.click();
        const options = page.getByRole('listbox').getByRole("option");
        await expect(options).toHaveCount(type === "in" ? 2 : 1);
        await expect(options.filter({ hasText: "停用供应商" })).toHaveCount(0);
        const bounds = await page.getByRole('listbox').boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        // Typing only filters the list; it must never create or replace a partner.
        await input.fill("未建档的往来单位");
        await expect(options).toHaveCount(0);
        await input.press("Escape");
        await expect(selectedControl(input)).toContainText(type === "in" ? "" : "零售客户");
        await input.fill(type === "in" ? "备用" : "城南");
        await expect(options).toHaveCount(1);
        await input.press("ArrowDown");
        await input.press("Enter");
        await expect(selectedControl(input)).toContainText(type === "in" ? "备用供应商" : "城南门店");
        await expect(input).toHaveAttribute("aria-expanded", "false");
        // Reopening must show every eligible contact, even after selecting one.
        await input.click();
        await expect(options).toHaveCount(type === "in" ? 2 : 1);
        await input.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await page.getByRole("textbox", { name: "查找并添加物料" }).fill("商务");
        await page.locator(".picker-results button").first().click();
        await page.getByRole("button", { name: type === "in" ? "确认入库" : "确认出库", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(f.db.prepare("SELECT partner_id FROM orders WHERE type=?").get(type).partner_id).toBe(rows[type === "in" ? 1 : 2].id);
        expect(f.db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n).toBe(4);
      }
    } finally {
      await f.close();
    }
  });
}
test("contact selection, reusable template, payment bookkeeping and margin report work together", async ({
  page,
}) => {
  const f = await fixture(page),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(f.base + "/?manage=data");
    await page.getByRole("button", { name: "往来单位", exact: true }).click();
    await page.getByLabel("单位名称", { exact: true }).fill("常用供应商");
    await page.getByLabel("联系人", { exact: true }).fill("王先生");
    await page.getByLabel("联系电话", { exact: true }).fill("13812345678");
    await page
      .getByRole("button", { name: "保存往来单位", exact: true })
      .click();
    const contacts = page.getByRole("combobox", { name: "搜索往来单位", exact: true });
    await expect(contacts).toHaveAttribute("aria-expanded", "false");
    await contacts.click();
    await expect(page.getByRole("option").filter({ hasText: "常用供应商" })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("link", { name: "入库", exact: true }).click();
    await page.getByRole("button", { name: "新建入库", exact: true }).click();
    await chooseContact(page, "常用供应商");
    await page.getByRole("textbox", { name: "查找并添加物料" }).fill("商务");
    await page.locator(".picker-results button").first().click();
    await page
      .getByRole("spinbutton", { name: "商务物料 数量", exact: true })
      .fill("10");
    await page.getByLabel("模板名称", { exact: true }).fill("每周补货");
    await page.getByRole("button", { name: "保存为模板", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText("每周补货");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock,
    ).toBe(0);
    const template = f.db.prepare("SELECT * FROM templates").get();
    await page.getByRole("button", { name: "业务管理", exact: true }).click();
  await page.getByRole("button", { name: "往来单位", exact: true }).click();
    await page.getByRole("button", { name: "单据模板", exact: true }).click();
    await page
      .getByRole("button", { name: `使用模板 #${template.id}`, exact: true })
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "商务物料 数量", exact: true }),
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
    await page.getByRole("button", { name: "业务管理", exact: true }).click();
  await page.getByRole("button", { name: "往来单位", exact: true }).click();
    await page.getByRole("button", { name: "成本与毛利", exact: true }).click();
    await expect(page.getByText(/已知毛利 \$40.00/)).toBeVisible();
    await page
      .getByRole("button", { name: "收付款与欠款", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "$60.00", exact: true }),
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

test("contact search stays collapsed, filters in a dropdown and selects without submitting the form", async ({ page }) => {
  const f = await fixture(page);
  try {
    for (const [role, name, person, phone, active] of [["supplier", "常用供应商", "王先生", "13812345678", 1], ["customer", "城南门店", "李女士", "13987654321", 1], ["supplier", "停用供应商", "", "", 0]]) {
      await page.request.post(f.base + "/api/contacts", { data: { request_id: `contact-${name}`, role, name, person, phone, address: "", note: "", active } });
    }
    await page.goto(f.base + "/?manage=data");
    await page.getByRole("button", { name: "往来单位", exact: true }).click();
    const search = page.getByRole("combobox", { name: "搜索往来单位", exact: true });
    const list = page.getByRole('listbox');
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await search.click();
    await expect(list.getByRole("option")).toHaveCount(3);
    await expect(list.getByRole("option").filter({ hasText: "停用供应商" })).toContainText("已停用");
    await search.fill("8765");
    await expect(list.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(selectedControl(search)).toContainText("城南门店");
    await expect(page.getByLabel("单位名称", { exact: true })).toHaveValue("城南门店");
    await expect(page.getByLabel("联系人", { exact: true })).toHaveValue("李女士");
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n).toBe(3);
    await search.click();
    await page.getByText(/^同一类型下名称不可重复。编辑不改写历史单据名称；停用后不能再开新单。/).click();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.click();
    await page.keyboard.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await search.click();
    await search.fill("找不到的单位");
    await expect(page.getByText("没有匹配的往来单位", { exact: true })).toBeVisible();
    await page.getByLabel("单位名称", { exact: true }).click();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.click();
    await search.fill("王先生");
    await page.setViewportSize({ width: 390, height: 844 });
    // The portaled menu repositions after the browser dispatches its resize event.
    await expect(async () => {
      const bounds = await list.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    }).toPass({ timeout: 5000 });
    await list.getByRole("option").filter({ hasText: "常用供应商" }).click();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("单位名称", { exact: true })).toHaveValue("常用供应商");
    await page.getByRole("button", { name: "新增往来单位", exact: true }).click();
    await expect(selectedControl(search)).toContainText("");
    await expect(page.getByLabel("单位名称", { exact: true })).toHaveValue("");
  } finally {
    await f.close();
  }
});

test("template picker filters by order type, preserves canceled edits and fits a narrow screen", async ({ page }) => {
  const f = await fixture(page);
  try {
    await ensureContact(page.request, "当前正在编辑的供应商", { base: f.base });
    const template = await (await page.request.post(f.base + "/api/templates", {
      data: { name: "采购补货组合", request_id: "picker-in", type: "in", partner: "继续采购的供应商", note: "待核对数量", items: [{ product_id: f.id, quantity: 1, price: 10 }] },
    })).json();
    await page.request.post(f.base + "/api/templates", {
      data: { name: "销售常用组合", request_id: "picker-out", type: "out", partner: "销售模板客户", note: "", items: [{ product_id: f.id, quantity: 1, price: 10 }] },
    });
    await page.goto(f.base);
    await page.getByRole("link", { name: "入库", exact: true }).click();
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
    await expect(selectedControl(page.getByRole("combobox", { name: "供应商", exact: true }))).toContainText("继续采购的供应商");
    await expect(page.locator(".order-template-status")).toContainText("已套用「采购补货组合」");

    await chooseContact(page, "当前正在编辑的供应商");
    await picker.click();
    await expect(card.getByText("本次已套用", { exact: true })).toBeVisible();
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await expect(selectedControl(page.getByRole("combobox", { name: "供应商", exact: true }))).toContainText("当前正在编辑的供应商");

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
    await page.getByRole("link", { name: "入库", exact: true }).click();
    for (const quantity of [3, 4]) {
      await page.getByRole("button", { name: "新建入库", exact: true }).click();
      await page.getByRole("button", { name: "选择单据模板", exact: true }).click();
      await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
      await expect(page.getByRole("spinbutton", { name: "商务物料 数量", exact: true })).toHaveValue("2");
      await page.getByRole("spinbutton", { name: "商务物料 数量", exact: true }).fill(String(quantity));
      await page.getByRole("button", { name: "确认入库", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(JSON.parse(f.db.prepare("SELECT items FROM templates WHERE id=?").get(template.id).items)[0].quantity).toBe(2);
    }
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM orders").get().n).toBe(2);
    expect(f.db.prepare("SELECT stock FROM products WHERE id=?").get(f.id).stock).toBe(7);
    await page.getByRole("button", { name: "新建入库", exact: true }).click();
    await page.getByRole("button", { name: "选择单据模板", exact: true }).click();
    await page.getByRole("button", { name: `使用模板 #${template.id}`, exact: true }).click();
    await page.getByRole("spinbutton", { name: "商务物料 数量", exact: true }).fill("5");
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
