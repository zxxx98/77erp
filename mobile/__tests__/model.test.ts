import {
  addLine,
  orderPayload,
  orderTotal,
  productPayload,
} from "../src/model";
import { product } from "./fixtures";

test("scanning the same product merges quantity and uses the correct purchase/sale price", () => {
  const lines = addLine(addLine([], product, "in"), product, "in");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ quantity: "2", price: "10" });
  expect(orderTotal(lines)).toBe(20);
  expect(addLine([], product, "out")[0]?.price).toBe("20");
});
test("outbound cannot exceed stock, and input errors do not silently become zero", () => {
  const lines = [{ product, quantity: "6", price: "20" }];
  expect(() => orderPayload("out", "客户", "", lines)).toThrow("库存不足");
  expect(orderPayload("in", "供应商", "", lines).items[0]?.quantity).toBe(6);
  for (const quantity of ["", "0", "-1", "1.2", "Infinity", "1e2"]) {
    expect(() =>
      orderPayload("out", "客户", "", [{ product, quantity, price: "20" }]),
    ).toThrow();
  }
  for (const price of ["", "-1", "1.001", "NaN"]) {
    expect(() =>
      orderPayload("in", "供应商", "", [{ product, quantity: "1", price }]),
    ).toThrow();
  }
});
test("order payload matches the existing server contract and totals use cents", () => {
  const lines = [{ product, quantity: "3", price: "0.10" }];
  expect(orderPayload("out", " 客户 ", "备注", lines)).toEqual({
    type: "out",
    partner: "客户",
    note: "备注",
    items: [{ product_id: 1, quantity: 3, price: 0.1 }],
  });
  expect(orderTotal(lines)).toBe(0.3);
  expect(() => orderPayload("in", "供应商", "", [...lines, ...lines])).toThrow(
    "重复",
  );
  expect(() => orderPayload("in", "", "", lines)).toThrow("请填写供应商名称。");
});
test("product creation keeps barcode optional and sends no direct stock mutation", () => {
  const payload = productPayload({
    name: " 新商品 ",
    barcode: "",
    category: "文具",
    unit: "件",
    cost: "0",
    price: "1.20",
    threshold: "5",
  });
  expect(payload).toEqual({
    name: "新商品",
    barcode: "",
    category: "文具",
    unit: "件",
    cost: 0,
    price: 1.2,
    threshold: 5,
  });
  expect(payload).not.toHaveProperty("stock");
});

test("reports exclude voided orders and subtract returns from the original business direction", () => {
  const { reportOrders, orderLabel } = require("../src/model");
  const orders = [
    { type: "in", total: 100, kind: "normal", status: "active" },
    { type: "out", total: 20, kind: "return", status: "active" },
    { type: "out", total: 50, kind: "normal", status: "void" },
  ];
  expect(reportOrders(orders).map((o: { type: string; total: number }) => [o.type, o.total])).toEqual([["in", 100], ["in", -20]]);
  expect(orderLabel(orders[1])).toBe("采购退货");
  expect(orderLabel(orders[2])).toBe("销售出库 · 已作废");
});
