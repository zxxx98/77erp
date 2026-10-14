import { test, expect } from "@playwright/test";

test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/auth/setup", {
    data: { username: "admin", password: "Test-admin-123" },
  });
  expect([201, 409]).toContain(response.status());
});
test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "admin", password: "Test-admin-123" },
  });
  expect(response.ok()).toBe(true);
});

test("product → barcode lookup → inbound → stock guard → outbound → persisted stock", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.getByRole("link", { name: "物料管理", exact: true }).click();
  await page
    .getByRole("button", { name: "新增物料", exact: true })
    .first()
    .click();
  await page.getByPlaceholder("例如：RVV 护套电线").fill("浏览器测试物料");
  await page.getByPlaceholder("扫描或输入条码，可留空").fill("TEST-UI-001");
  await page.getByRole("spinbutton", { name: /参考采购价/ }).fill("10");
  await page.getByRole("spinbutton", { name: /参考销售价/ }).fill("20");
  await page.getByRole("spinbutton", { name: /安全库存/ }).fill("0.123456");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "扫码工作台", exact: true }).click();
  await page.getByRole("button", { name: "手动输入条码", exact: true }).click();
  await page
    .getByRole("textbox", { name: "物料条码", exact: true })
    .fill("TEST-UI-001");
  await page
    .getByRole("textbox", { name: "物料条码", exact: true })
    .press("Enter");
  await expect(page.locator(".scan-result-product h3")).toHaveText(
    "浏览器测试物料",
  );
  await expect(page.locator(".scan-result-stock strong")).toContainText("0");
  await page
    .locator(".scan-result-actions")
    .getByRole("button", { name: "采购入库" })
    .click();
  await page.getByRole("combobox", { name: /供应商/ }).fill("自动化测试供应商");
  await page
    .getByRole("spinbutton", { name: "浏览器测试物料 数量" })
    .fill("10.25");
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".scan-result-stock strong")).toContainText("10.25");
  await page
    .locator(".scan-result-actions")
    .getByRole("button", { name: "销售出库" })
    .click();
  await page
    .getByRole("spinbutton", { name: "浏览器测试物料 数量" })
    .fill("11");
  await page.getByRole("button", { name: "确认出库", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("库存不足");
  await page.getByRole("spinbutton", { name: "浏览器测试物料 数量" }).fill("0.125");
  await page.getByRole("button", { name: "确认出库", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".scan-result-stock strong")).toContainText("10.125");
  await page.reload();
  await page.getByRole("button", { name: "手动输入条码", exact: true }).click();
  await page
    .getByRole("textbox", { name: "物料条码", exact: true })
    .fill("TEST-UI-001");
  await page
    .getByRole("textbox", { name: "物料条码", exact: true })
    .press("Enter");
  await expect(page.locator(".scan-result-stock strong")).toContainText("10.125");
  await page.getByRole("link", { name: "操作记录", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索单据" }).fill("浏览器测试物料");
  await expect(page.locator(".orders-table tbody tr")).toHaveCount(2);
  await page.locator(".orders-table tbody tr").first().click();
  await expect(page.getByRole("dialog")).toContainText("浏览器测试物料");
  await expect(page.locator(".detail-table")).toContainText("2.50");
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出单据" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  expect(errors).toEqual([]);
});

test("blank barcode generates a visible code that survives edits and supports lookup and labels", async ({
  page,
}) => {
  await page.goto("/#products");
  await page
    .getByRole("button", { name: "新增物料", exact: true })
    .first()
    .click();
  await expect(
    page.getByPlaceholder("扫描或输入条码，可留空"),
  ).toHaveJSProperty("required", false);
  await page.getByPlaceholder("例如：RVV 护套电线").fill("自动条码测试物料");
  await page.getByRole("spinbutton", { name: /参考采购价/ }).fill("10");
  await page.getByRole("spinbutton", { name: /参考销售价/ }).fill("20");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "筛选物料" })
    .fill("自动条码测试物料");
  await expect(page.locator(".product-table tbody tr")).toHaveCount(1);
  const code = await page
    .locator(".product-table .product-info small")
    .innerText();
  expect(code).toMatch(/^SKU-\d{6,}$/);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByPlaceholder("扫描或输入条码，可留空").fill("");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".product-table .product-info small")).toHaveText(
    code,
  );
  await page
    .getByRole("button", { name: "查看 自动条码测试物料 条码" })
    .click();
  await expect(page.locator(".barcode-detail .barcode")).toHaveAttribute(
    "aria-label",
    `条码 ${code}`,
  );
  const barcodeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载标签" }).click();
  expect((await barcodeDownload).suggestedFilename()).toBe(`${code}.svg`);
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("link", { name: "扫码工作台", exact: true }).click();
  await page.getByRole("button", { name: "手动输入条码", exact: true }).click();
  await page.getByRole("textbox", { name: "物料条码", exact: true }).fill(code);
  await page
    .getByRole("textbox", { name: "物料条码", exact: true })
    .press("Enter");
  await expect(page.locator(".scan-result-product h3")).toHaveText(
    "自动条码测试物料",
  );
});

test("barcode labels can be exported", async ({ page }) => {
  await page.goto("/#products");
  await page
    .getByRole("button", { name: "查看 极简陶瓷马克杯 条码", exact: true })
    .click();
  await expect(page.locator(".barcode-detail .barcode")).toBeVisible();
  const barcodeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载标签" }).click();
  expect((await barcodeDownload).suggestedFilename()).toMatch(/\.svg$/);
});

test("camera failure has a useful fallback, mobile pages have no document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [id, title] of [
    ["overview", "工作台"],
    ["products", "物料管理"],
    ["purchases", "采购入库"],
    ["sales", "销售出库"],
    ["inventory", "库存管理"],
    ["scanner", "扫码工作台"],
  ]) {
    await page.goto("/#" + id);
    await expect(page.locator(".page-heading h1")).toContainText(title);
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      containers: [...document.querySelectorAll('main, .main-shell, .table-scroll, .inventory-toolbar, .pwa-notice')].map(node => ({ name: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right })),
    }));
    expect(bounds.scroll, `${id}: ${JSON.stringify(bounds)}`).toBeLessThanOrEqual(bounds.width);
  }
  await page.getByRole("link", { name: "扫码工作台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "手机扫码", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "物料条码", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("扫码枪");
  await expect(page.locator("main")).not.toContainText("演示物料");
  await expect(page.locator("main")).not.toContainText("示例");
  await page.getByRole("button", { name: "手动输入条码", exact: true }).click();
  await page.getByRole("button", { name: "手机扫码" }).click();
  await expect(page.locator(".camera-error")).toContainText(/摄像头|权限/);
  await page.getByRole("button", { name: "关闭摄像头" }).click();
  await page
    .getByRole("textbox", { name: "物料条码", exact: true })
    .fill("DOES-NOT-EXIST");
  await page.getByRole("button", { name: "识别", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText(
    "请先在物料管理中建档",
  );
  expect(errors).toEqual([]);
});

test("product QR labels resolve in the scan workspace and foreign labels are explained", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  const data = await (await page.request.get("/api/data")).json();
  const product = data.products.find((p) => p.name === "极简陶瓷马克杯");
  const label = (source) => JSON.stringify({ format: "77erp", version: 1, type: "product", source_id: source,
    warehouse_id: data.warehouse_id, product: { id: product.id, barcode: product.barcode, name: "旧名称", unit: product.unit } });
  await page.getByRole("link", { name: "扫码工作台", exact: true }).click();
  await page.getByRole("button", { name: "手动输入条码", exact: true }).click();
  const input = page.getByRole("textbox", { name: "物料条码", exact: true });
  await input.fill(label("5ed3098f-d9f4-4992-b6ab-6355966dbb43"));
  await input.press("Enter");
  await expect(page.locator(".scanner-main .form-error")).toContainText("其他服务器");
  await expect(page.locator(".scan-result")).toHaveCount(0);
  await input.fill(label(data.instance_id));
  await input.press("Enter");
  await expect(page.locator(".scan-result-product h3")).toHaveText("极简陶瓷马克杯");
});

test("inventory page reduces stock with an adjustment record and blocks overdraw", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.getByRole("link", { name: "物料管理", exact: true }).click();
  await page.getByRole("button", { name: "新增物料", exact: true }).first().click();
  await page.getByPlaceholder("例如：RVV 护套电线").fill("报损测试物料");
  await page.getByPlaceholder("扫描或输入条码，可留空").fill("REDUCE-UI-001");
  await page.getByRole("spinbutton", { name: /参考采购价/ }).fill("8");
  await page.getByRole("spinbutton", { name: /参考销售价/ }).fill("15");
  await page.getByRole("button", { name: "保存物料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "库存管理", exact: true }).click();
  await page.getByPlaceholder("搜索物料或条码").fill("REDUCE-UI-001");
  const row = page.locator("tr", { hasText: "报损测试物料" });
  await row.getByRole("button", { name: "补货", exact: true }).click();
  await page.getByRole("combobox", { name: /供应商/ }).fill("自动化测试供应商");
  await page.getByRole("spinbutton", { name: "报损测试物料 数量" }).fill("5");
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: "减少", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("减少库存");
  await dialog.getByRole("spinbutton").fill("9");
  await dialog.getByPlaceholder("例如：破损报废、盘点损耗").fill("破损报废");
  await dialog.getByRole("button", { name: "确认减少", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("减少数量不能超过现有库存");
  await dialog.getByRole("spinbutton").fill("2");
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "确认减少", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row.locator(".number-cell strong").first()).toContainText("3");
  const adjustments = await (await page.request.get("/api/stocktakes")).json();
  const record = adjustments.find((a) => a.kind === "reduce");
  expect(record).toMatchObject({ before_stock: 5, after_stock: 3, reason: "破损报废" });
  expect(errors).toEqual([]);
});
