import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CommerceScreen } from "../src/commerce";
import { OrderEditor } from "../src/forms";
import { Contact } from "../src/model";
import { api } from "../src/native";
import { product } from "./fixtures";

jest.mock("../src/native", () => ({ api: jest.fn(), getWarehouseId: jest.fn(() => 1) }));
const request = jest.mocked(api);
const contact = (id: number, name: string, role: Contact["role"], active = 1): Contact => ({
  id, name, role, active, person: "王先生", phone: "13812345678", address: "", note: "", version: 1,
});
const contacts = [contact(1, "常用供应商", "supplier"), contact(2, "城南门店", "customer"), contact(3, "停用供应商", "supplier", 0)];
beforeEach(() => { jest.clearAllMocks(); });

test("stocktake and data management actions belong to their own tabs", async () => {
  request.mockImplementation(async path => path === "/contacts" ? contacts : path === "/finance" ? { orders: [], balances: [] } : path.startsWith("/reports/profit") ? {
    totals: { revenue_cents: 0, cost_cents: 0, gross_profit_cents: 0, unknown_revenue_cents: 0, unknown_lines: 0 }, inventory_value_cents: 0, rows: [],
  } : []);
  const stocktake = jest.fn(), dataManagement = jest.fn();
  render(<CommerceScreen onClose={jest.fn()} onRefresh={jest.fn()} onUse={jest.fn()} onStocktake={stocktake} onDataManagement={dataManagement} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("/contacts"));
  for (const tab of ["往来单位", "模板", "收付款", "毛利"]) {
    fireEvent.press(screen.getByRole("button", { name: tab }));
    expect(screen.queryByRole("button", { name: "开始库存盘点" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开网页导入导出" })).toBeNull();
  }
  fireEvent.press(screen.getByRole("button", { name: "库存盘点" }));
  expect(stocktake).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "开始库存盘点" }));
  expect(stocktake).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole("button", { name: "导入导出" }));
  expect(screen.queryByRole("button", { name: "开始库存盘点" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "打开网页导入导出" }));
  expect(dataManagement).toHaveBeenCalledTimes(1);
});

test("contacts stay collapsed, support search and populate the existing contact editor", async () => {
  request.mockResolvedValue(contacts);
  render(<CommerceScreen onClose={jest.fn()} onRefresh={jest.fn()} onUse={jest.fn()} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("/contacts"));
  expect(screen.queryByRole("button", { name: "供应商 · 常用供应商" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "展开搜索往来单位列表" }));
  await screen.findByRole("button", { name: "供应商 · 停用供应商（已停用）" });
  fireEvent.changeText(screen.getByLabelText("搜索往来单位"), "城南");
  expect(screen.queryByRole("button", { name: "供应商 · 常用供应商" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "客户 · 城南门店" }));
  expect(screen.getByLabelText("单位名称")).toHaveProp("value", "城南门店");
  expect(screen.getByLabelText("搜索往来单位")).toHaveProp("value", "城南门店");
  expect(screen.queryByRole("button", { name: "客户 · 城南门店" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "展开搜索往来单位列表" }));
  expect(screen.getByRole("button", { name: "供应商 · 常用供应商" })).toBeOnTheScreen();
});

test.each(["in", "out"] as const)("%s partner dropdown filters roles and submits the selected contact ID", async type => {
  request.mockResolvedValue({ number: "TEST-ORDER" });
  const alert = jest.spyOn(Alert, "alert");
  render(<OrderEditor type={type} contacts={contacts} products={[product]} initialProduct={product} onClose={jest.fn()} onSaved={jest.fn()} />);
  const label = type === "in" ? "供应商" : "客户";
  const name = type === "in" ? "常用供应商" : "城南门店";
  expect(screen.queryByRole("button", { name: `${label} · ${name}` })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: `展开${label}列表` }));
  expect(screen.queryByRole("button", { name: "供应商 · 停用供应商（已停用）" })).toBeNull();
  expect(screen.queryByRole("button", { name: type === "in" ? "客户 · 城南门店" : "供应商 · 常用供应商" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: `${label} · ${name}` }));
  expect(screen.getByLabelText(label)).toHaveProp("value", name);
  fireEvent.press(screen.getByRole("button", { name: type === "in" ? "确认入库" : "确认出库" }));
  const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === "确认提交")?.onPress;
  expect(confirm).toBeDefined();
  await act(async () => { confirm?.(); });
  expect(request).toHaveBeenCalledWith("/orders", "POST", expect.objectContaining({ partner: name, partner_id: type === "in" ? 1 : 2 }));
  alert.mockRestore();
});
