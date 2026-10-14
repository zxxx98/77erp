import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { ProductDetail } from "../src/screens";
import { api } from "../src/native";
import { Product } from "../src/model";
import { product } from "./fixtures";

jest.mock("../src/native", () => ({ api: jest.fn() }));
const request = jest.mocked(api);
const detail = (value: Product = product) => (
  <ProductDetail product={value} onClose={jest.fn()} edit={jest.fn()}
    openOrder={jest.fn()} onSaved={jest.fn()} />
);
beforeEach(() => request.mockReset());

test("product details load stock by warehouse, including zero and fractional quantities", async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(detail());
  expect(screen.getByText("读取中…")).toBeOnTheScreen();
  expect(request).toHaveBeenCalledWith(`/products/${product.id}/other-warehouses`);
  await act(async () => finish({ warehouses: [
    { warehouse_id: 2, warehouse_name: "分仓", product_id: 2, stock: 0, unit: "箱" },
    { warehouse_id: 3, warehouse_name: "备用仓", product_id: 3, stock: 2.5, unit: "" },
  ] }));
  expect(screen.getByText("分仓")).toBeOnTheScreen();
  expect(screen.getByText("0 箱")).toBeOnTheScreen();
  expect(screen.getByText("备用仓")).toBeOnTheScreen();
  expect(screen.getByText("2.5 个")).toBeOnTheScreen();
  expect(screen.queryByText("读取中…")).toBeNull();
});

test("product details explain when other warehouses have no matching product", async () => {
  request.mockResolvedValueOnce({ warehouses: [] });
  render(detail());
  expect(await screen.findByText("其他仓库暂无同一物料")).toBeOnTheScreen();
});

test("stock lookup errors preserve product details and order actions", async () => {
  request.mockRejectedValueOnce(new Error("网络连接失败"));
  render(detail());
  expect(await screen.findByText("网络连接失败")).toBeOnTheScreen();
  expect(screen.queryByText("读取中…")).toBeNull();
  expect(screen.queryByText("其他仓库暂无同一物料")).toBeNull();
  expect(screen.getByText(product.name)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "采购入库" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "销售出库" })).toBeEnabled();
});

test("switching products ignores late stock responses from the previous product", async () => {
  let finishFirst!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  const view = render(detail());
  request.mockResolvedValueOnce({ warehouses: [
    { warehouse_id: 2, warehouse_name: "新物料分仓", product_id: 4, stock: 9, unit: "件" },
  ] });
  view.rerender(detail({ ...product, id: 10, name: "新物料" }));
  expect(await screen.findByText("9 件")).toBeOnTheScreen();
  expect(request).toHaveBeenLastCalledWith("/products/10/other-warehouses");
  await act(async () => finishFirst({ warehouses: [
    { warehouse_id: 2, warehouse_name: "旧物料分仓", product_id: 2, stock: 1, unit: "箱" },
  ] }));
  expect(screen.queryByText("旧物料分仓")).toBeNull();
  expect(screen.getByText("新物料分仓")).toBeOnTheScreen();
  expect(screen.getByText("9 件")).toBeOnTheScreen();
});
