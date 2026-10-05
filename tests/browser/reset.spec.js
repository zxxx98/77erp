import { test, expect } from "@playwright/test";
import { createApp } from "../../server/app.js";

test("settings reset supports cancellation and clears data while keeping the session", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const { app, db } = createApp(":memory:");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.request.post(base + "/api/auth/setup", {
      data: { username: "resetadmin", password: "Reset-test-123" },
    });
    await page.goto(base);
    await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "库存与数据", exact: false }).click();
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "重置业务数据", exact: true }).click();
    expect(db.prepare("SELECT COUNT(*) AS n FROM products").get().n).toBe(12);
    page.once("dialog", async dialog => {
      expect(dialog.message()).toContain("包括正式数据");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "重置业务数据", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const data = await page.request.get(base + "/api/data");
    expect(data.status()).toBe(200);
    expect(await data.json()).toMatchObject({ products: [], orders: [] });
    await page.reload();
    await expect(page.getByRole("heading", { name: "工作台", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
