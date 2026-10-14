import { parseProductCode, resolveProductCode } from "../src/product-scan";
import { product } from "./fixtures";

const sourceId = "708528e6-7d1e-4d1b-8ba3-f4f769931c49";
const label = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  format: "77erp", version: 1, type: "product", source_id: sourceId, warehouse_id: 1,
  product: { id: product.id, barcode: product.barcode, name: "旧名称", unit: "箱" }, ...overrides,
});
const context = { products: [product], warehouseId: 1, sourceId };

test("plain barcodes resolve by barcode and product labels resolve by identity", () => {
  expect(resolveProductCode(` ${product.barcode} `, context)).toBe(product);
  expect(resolveProductCode("UNKNOWN", context)).toBeNull();
  expect(resolveProductCode(label(), context)).toBe(product);
  expect(parseProductCode(label()).barcode).toBe(product.barcode);
  expect(parseProductCode("{not json")).toEqual({ kind: "barcode", barcode: "{not json" });
});

test("labels that do not match the current server, warehouse or product are rejected", () => {
  expect(() => resolveProductCode(label({ source_id: "5ed3098f-d9f4-4992-b6ab-6355966dbb43" }), context)).toThrow("其他服务器");
  expect(() => resolveProductCode(label({ warehouse_id: 2 }), context)).toThrow("其他仓库");
  expect(() => resolveProductCode(label({ product: { id: product.id, barcode: "SKU-999999" } }), context)).toThrow("不一致");
  expect(() => resolveProductCode(label(), { products: [product], warehouseId: 1 })).toThrow("无法核对");
  expect(() => resolveProductCode(label({ version: 2 }), context)).toThrow("版本");
  expect(() => resolveProductCode(label({ type: "stock_receipt" }), context)).toThrow("不是物料标签");
});
