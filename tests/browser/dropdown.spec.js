import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";

async function fixture(page) {
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.request.post(base + "/api/auth/setup", { data: { username: "dropdown", password: "Test-password-123" } });
  await page.request.post(base + "/api/settings/reset", { data: { confirmation: "RESET_BUSINESS_DATA" } });
  const settings = (await (await page.request.get(base + "/api/data")).json()).settings;
  await page.request.put(base + "/api/settings", { data: { ...settings, units: ["个", "件", "箱"] } });
  return { base, db, close: async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  } };
}

for (const width of [1440, 390]) {
  test(`shared dropdown supports keyboard selection, dismissal and fits the viewport at ${width}px`, async ({ page }) => {
    const f = await fixture(page);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(f.base + "/#products");
      await page.getByRole("button", { name: "新增物料", exact: true }).first().click();
      const control = page.getByRole("combobox", { name: /计量单位/ });
      await expect(control).toHaveValue("个");
      await control.focus();
      await control.press("ArrowDown");
      await expect(page.getByRole("option", { name: "个", exact: true })).toHaveAttribute("aria-selected", "true");
      await control.press("End");
      await control.press("Enter");
      await expect(control).toHaveValue("箱");
      await expect(control).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await control.click();
      const menu = page.locator(".dropdown-menu");
      await expect(menu.getByRole("option", { name: "箱", exact: true })).toHaveAttribute("aria-selected", "true");
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
      await control.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await control.click();
      await control.press("Tab");
      await expect(menu).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "规格型号", exact: true })).toBeFocused();
      await control.click();
      await page.getByPlaceholder("例如：RVV 护套电线").click();
      await expect(menu).toHaveCount(0);
      expect(errors).toEqual([]);
      if (width === 390) {
        await control.click();
        await page.screenshot({ path: "/tmp/77erp-dropdown-mobile.png" });
      }
    } finally { await f.close(); }
  });
}

test("a required dropdown blocks submission and focuses its visible control", async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.goto(f.base + "/#products");
    await page.getByRole("button", { name: "新增物料", exact: true }).first().click();
    await page.getByPlaceholder("例如：RVV 护套电线").fill("缺少分类的物料");
    await page.getByRole("spinbutton", { name: /参考采购价/ }).fill("1");
    await page.getByRole("spinbutton", { name: /参考销售价/ }).fill("2");
    await page.getByRole("button", { name: "保存物料", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("请选择一个选项。");
    await expect(page.getByRole("combobox", { name: /物料分类/ })).toBeFocused();
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM products").get().n).toBe(0);
  } finally { await f.close(); }
});
