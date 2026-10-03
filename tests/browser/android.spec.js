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
  await page.addInitScript(() => {
    window.nativeRequests = [];
    window.ERPAndroid = {
      postMessage(raw) { window.nativeRequests.push(JSON.parse(raw)); },
    };
    window.replyNative = (payload) => {
      const request = window.nativeRequests.at(-1);
      window.ERPAndroid.onmessage({ data: JSON.stringify({ id: request.id, ...payload }) });
    };
  });
});

test("Android scan passes the native result to product lookup", async ({ page }) => {
  const data = await (await page.request.get("/api/data")).json();
  const product = data.products[0];
  await page.goto("/#scanner");
  await page.getByRole("button", { name: "手机扫码", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.nativeRequests.at(-1)?.action)).toBe("scan");
  await page.evaluate((barcode) => window.replyNative({ result: barcode }), product.barcode);
  await expect(page.locator(".scan-result-product h3")).toHaveText(product.name);
  await expect(page.locator(".camera-scanner")).toHaveCount(0);
});

test("Android camera permission failure allows retry", async ({ page }) => {
  await page.goto("/#scanner");
  await page.getByRole("button", { name: "手机扫码", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.nativeRequests.length)).toBe(1);
  await page.evaluate(() => window.replyNative({ error: "摄像头权限未开启，请在系统设置中授权。" }));
  await expect(page.locator(".camera-error")).toContainText("摄像头权限未开启");
  await page.getByRole("button", { name: "关闭摄像头", exact: true }).click();
  await page.getByRole("button", { name: "手机扫码", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.nativeRequests.length)).toBe(2);
});

test("Android export waits for file save and reports cancellation", async ({ page }) => {
  await page.goto("/#history");
  await page.getByRole("button", { name: "导出单据" }).click();
  await expect.poll(() => page.evaluate(() => window.nativeRequests.at(-1)?.action)).toBe("save");
  const request = await page.evaluate(() => window.nativeRequests.at(-1));
  expect(request.filename).toMatch(/\.csv$/);
  expect(request.mime).toBe("text/csv");
  expect(request.text).toContain("\uFEFF");
  await expect(page.getByText("单据已导出为 CSV", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.replyNative({ error: "已取消保存。" }));
  await expect(page.getByText("已取消保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "导出单据" }).click();
  await expect.poll(() => page.evaluate(() => window.nativeRequests.length)).toBe(2);
  await page.evaluate(() => window.replyNative({ result: "saved" }));
  await expect(page.getByText("单据已导出为 CSV", { exact: true })).toBeVisible();
});
