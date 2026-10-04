import { test, expect } from "@playwright/test";

test("first-run setup, password confirmation, logout, login and session expiry", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = "http://127.0.0.1:3200";
  await page.goto(base + "/#inventory");
  await expect(page.getByRole("heading", { name: "设置管理员" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect((await page.request.get(base + "/api/data")).status()).toBe(401);
  await page.getByLabel("管理员账号", { exact: true }).fill("owner");
  await page.getByLabel("设置密码", { exact: true }).fill("Strong-password-123");
  await page.getByLabel("确认密码", { exact: true }).fill("Different-password-123");
  await page.getByRole("button", { name: "创建管理员并进入" }).click();
  await expect(page.getByRole("alert")).toContainText("两次输入的密码不一致");
  await page.getByLabel("确认密码", { exact: true }).fill("Strong-password-123");
  await page.getByRole("button", { name: "创建管理员并进入" }).click();
  await expect(page.getByRole("heading", { name: "库存管理", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "库存管理", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await expect(page.getByLabel("确认密码", { exact: true })).toHaveCount(0);
  expect((await page.request.get(base + "/api/data")).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("管理员账号", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("账号或密码错误");
  await page.getByLabel("密码", { exact: true }).fill("Strong-password-123");
  await page.getByRole("button", { name: "显示密码" }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "库存管理", exact: true })).toBeVisible();
  // Revoke the session outside the UI; the next business call must clear the workspace.
  expect((await page.request.post(base + "/api/auth/logout", { data: {} })).ok()).toBe(true);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  // Opening data management loads stocktake history and detects expiry immediately.
  await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("登录已失效");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(errors).toEqual([]);
});
