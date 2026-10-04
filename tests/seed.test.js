import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

test("fresh database initializes near midnight without duplicate order numbers", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-04T00:10:00Z") });
  const { db } = createApp(":memory:");
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 64);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_items").get().count, 64);
  } finally {
    db.close();
  }
});
