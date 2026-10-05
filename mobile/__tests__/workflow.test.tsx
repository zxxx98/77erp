import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AuthScreen, ProductDetail, ProductsScreen, ScannerScreen } from "../src/screens";
import { CategoryEditor } from "../src/catalog";
import { OrderEditor, ProductEditor, SettingsEditor } from "../src/forms";
import { AppContent } from "../src/App";
import { api, device, scanBarcode } from "../src/native";
import { categories, product, workspace } from "./fixtures";

jest.mock("../src/native", () => ({
  api: jest.fn(),
  scanBarcode: jest.fn(),
  onUnauthorized: jest.fn(() => () => {}),
  device: {
    pickImage: jest.fn(),
    getServer: jest.fn(),
    setServer: jest.fn(),
    clearSession: jest.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, code: number) {
      super(message);
      this.status = code;
    }
  },
}));
const request = jest.mocked(api);
beforeEach(() => {
  jest.clearAllMocks();
});

test("native setup validates password confirmation before creating the administrator", async () => {
  const success = jest.fn();
  render(
    <AuthScreen
      auth={{ initialized: false, authenticated: false }}
      server="https://erp.example.com"
      notice=""
      onSuccess={success}
      onRefresh={jest.fn()}
      onServer={jest.fn()}
    />,
  );
  fireEvent.changeText(screen.getByLabelText("管理员账号"), "admin");
  fireEvent.changeText(screen.getByLabelText("密码"), "Test-admin-123");
  fireEvent.changeText(screen.getByLabelText("确认密码"), "different");
  fireEvent.press(screen.getByRole("button", { name: "创建管理员并进入" }));
  await screen.findByText("两次输入的密码不一致。");
  expect(request).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("确认密码"), "Test-admin-123");
  request.mockResolvedValue({
    initialized: true,
    authenticated: true,
    username: "admin",
  });
  fireEvent.press(screen.getByRole("button", { name: "创建管理员并进入" }));
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith({
      initialized: true,
      authenticated: true,
      username: "admin",
    }),
  );
  expect(request).toHaveBeenCalledWith("/auth/setup", "POST", {
    username: "admin",
    password: "Test-admin-123",
  });
});
test("native product editor creates a product with an automatically generated barcode", async () => {
  request.mockResolvedValue({ id: 2, barcode: "SKU-000002" });
  const saved = jest.fn();
  render(<ProductEditor categories={categories} onClose={jest.fn()} onSaved={saved} />);
  fireEvent.changeText(screen.getByLabelText("商品名称"), "原生测试商品");
  fireEvent.press(screen.getByRole("button", { name: "保存商品" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith(
    "/products",
    "POST",
    expect.objectContaining({ name: "原生测试商品", barcode: "" }),
  );
});
test("outbound blocks insufficient stock then requires confirmation and suppresses repeat submissions", async () => {
  const alert = jest.spyOn(Alert, "alert");
  let finish: (value: unknown) => void = () => {};
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saved = jest.fn();
  render(
    <OrderEditor
      type="out"
      products={[product]}
      initialProduct={product}
      onClose={jest.fn()}
      onSaved={saved}
    />,
  );
  fireEvent.changeText(screen.getByLabelText("陶瓷杯 数量"), "6");
  fireEvent.press(screen.getByRole("button", { name: "确认出库" }));
  await screen.findByText(/库存不足/);
  expect(request).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("陶瓷杯 数量"), "3");
  fireEvent.press(screen.getByRole("button", { name: "确认出库" }));
  expect(alert).toHaveBeenCalled();
  const confirm = alert.mock.calls
    .at(-1)?.[2]
    ?.find((button) => button.text === "确认提交")?.onPress;
  expect(confirm).toBeDefined();
  act(() => {
    confirm?.();
    confirm?.();
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/orders", "POST", {
    type: "out",
    partner: "零售客户",
    note: "",
    items: [{ product_id: 1, quantity: 3, price: 20 }],
  });
  await act(async () => {
    finish({ number: "CK1" });
  });
  expect(saved).toHaveBeenCalledWith("单据 CK1 已保存");
  alert.mockRestore();
});
test("native scanner finds the product and cancellation leaves the screen usable", async () => {
  jest
    .mocked(scanBarcode)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(product.barcode);
  const openOrder = jest.fn();
  render(
    <ScannerScreen
      products={[product]}
      onClose={jest.fn()}
      openOrder={openOrder}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "打开摄像头扫码" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "打开摄像头扫码" }),
    ).toBeEnabled(),
  );
  expect(screen.queryByText("商品已识别")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "打开摄像头扫码" }));
  await screen.findByText("商品已识别");
  expect(screen.getByText("陶瓷杯")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "销售出库" }));
  expect(openOrder).toHaveBeenCalledWith("out", product);
});
test("native application restores the server, loads API data and navigates without a web page", async () => {
  jest.mocked(device.getServer).mockResolvedValue("http://erp.example.com");
  request.mockImplementation(async (path) =>
    path === "/auth/status"
      ? { initialized: true, authenticated: true, username: "admin" }
      : workspace,
  );
  render(<AppContent />);
  await screen.findByText("测试商户 · 主仓库");
  fireEvent.press(screen.getByRole("tab", { name: "库存" }));
  await screen.findByText("库存管理");
  fireEvent.press(screen.getByRole("button", { name: "陶瓷杯，库存 5 个" }));
  await screen.findByText("商品详情");
  expect(request).toHaveBeenCalledWith("/data");
});


test("business reset requires confirmation and preserves device connection and session", async () => {
  const alert = jest.spyOn(Alert, "alert");
  const saved = jest.fn();
  request.mockResolvedValue({ ok: true });
  render(<SettingsEditor settings={workspace.settings} onClose={jest.fn()} onSaved={saved} />);
  fireEvent.press(screen.getByRole("button", { name: "重置业务数据" }));
  expect(request).not.toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)?.[2];
  expect(buttons?.find(button => button.text === "取消")?.style).toBe("cancel");
  const confirm = buttons?.find(button => button.text === "确认清空")?.onPress;
  expect(confirm).toBeDefined();
  await act(async () => { confirm?.(); confirm?.(); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/settings/reset", "POST", { confirmation: "RESET_BUSINESS_DATA" });
  expect(saved).toHaveBeenCalledWith("业务数据已清空，账户和配置已保留");
  expect(device.setServer).not.toHaveBeenCalled();
  expect(device.clearSession).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("native partial return sends original product quantities only after confirmation", async () => {
  const { OrderCorrection } = require("../src/operations");
  const alert = jest.spyOn(Alert, "alert");
  request.mockResolvedValue({ ok: true });
  const saved = jest.fn();
  render(<OrderCorrection order={{ id: 42, number: "RK42", type: "in", kind: "normal", status: "active", stock_applied: 1, partner: "供应商", note: "", total: 100, created_at: "2026-10-04T10:00:00Z", items: [{ product_id: 1, name: "陶瓷杯", barcode: "SKU-000001", quantity: 10, price: 10, returned_quantity: 2 }] }} onSaved={saved} />);
  fireEvent.changeText(screen.getByLabelText("操作原因"), "包装破损");
  fireEvent.changeText(screen.getByLabelText("陶瓷杯 退货数量（可退 8）"), "3");
  fireEvent.press(screen.getByRole("button", { name: "确认退货" }));
  expect(request).not.toHaveBeenCalled();
  const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === "确认提交")?.onPress;
  await act(async () => { confirm?.(); confirm?.(); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/orders/42/returns", "POST", expect.objectContaining({ reason: "包装破损", items: [{ product_id: 1, quantity: 3 }], request_id: expect.any(String) }));
  expect(saved).toHaveBeenCalledWith("退货单已生成");
  alert.mockRestore();
});

test("native stocktake includes expected stock and permits counting zero", async () => {
  const { StocktakeEditor } = require("../src/operations");
  const alert = jest.spyOn(Alert, "alert");
  request.mockImplementation(async path => path === "/stocktakes" ? [] : { ok: true });
  const saved = jest.fn();
  render(<StocktakeEditor products={[product]} onSaved={saved} onClose={jest.fn()} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("/stocktakes"));
  fireEvent.changeText(screen.getByLabelText("搜索商品或条码"), "陶瓷");
  fireEvent.press(screen.getByRole("button", { name: "添加 陶瓷杯" }));
  fireEvent.changeText(screen.getByLabelText("陶瓷杯 实盘数量"), "0");
  fireEvent.changeText(screen.getByLabelText("盘点原因"), "全部破损");
  fireEvent.press(screen.getByRole("button", { name: "确认盘点" }));
  expect(request).toHaveBeenCalledTimes(1);
  const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === "确认提交")?.onPress;
  await act(async () => { confirm?.(); });
  expect(request).toHaveBeenCalledWith("/stocktakes", "POST", expect.objectContaining({ reason: "全部破损", items: [{ product_id: 1, expected_stock: 5, counted: 0 }] }));
  expect(saved).toHaveBeenCalledWith("盘点已完成");
  alert.mockRestore();
});

test("native order can save an incomplete draft without affecting stock", async () => {
  request.mockResolvedValue({ id: 7, version: 1 });
  const saved = jest.fn();
  render(<OrderEditor type="in" products={[product]} initialProduct={product} onClose={jest.fn()} onSaved={saved} />);
  fireEvent.changeText(screen.getByLabelText("陶瓷杯 数量"), "");
  fireEvent.press(screen.getByRole("button", { name: "保存草稿并关闭" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("草稿已保存，库存未变化"));
  expect(request).toHaveBeenCalledWith("/drafts", "POST", expect.objectContaining({ type: "in", partner: "", items: [{ product_id: 1, quantity: "", price: "10" }], request_id: expect.any(String) }));
  expect(request).toHaveBeenCalledTimes(1);
});

test("native order resumes a shared draft and submits its revision with the selected contact", async () => {
  const alert = jest.spyOn(Alert, "alert");
  request.mockResolvedValue({ number: "RK99" });
  const saved = jest.fn();
  render(<OrderEditor type="in" products={[product]} initialDraft={{ id: 7, version: 2, type: "in", partner: "供应商", partner_id: 9, note: "继续", updated_at: "2026-10-04T10:00:00Z", items: [{ product_id: 1, quantity: "3", price: "10" }] }} onClose={jest.fn()} onSaved={saved} />);
  expect(screen.getByLabelText("陶瓷杯 数量")).toHaveProp("value", "3");
  fireEvent.press(screen.getByRole("button", { name: "确认入库" }));
  const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === "确认提交")?.onPress;
  await act(async () => { confirm?.(); });
  expect(request).toHaveBeenCalledWith("/orders", "POST", expect.objectContaining({ draft_id: 7, draft_version: 2, partner_id: 9, items: [{ product_id: 1, quantity: 3, price: 10 }] }));
  expect(saved).toHaveBeenCalledWith("单据 RK99 已保存");
  alert.mockRestore();
});

test("native payment registration requires confirmation and refreshes the remaining balance", async () => {
  const { PaymentEditor } = require("../src/commerce");
  const alert = jest.spyOn(Alert, "alert");
  let registered = false;
  request.mockImplementation(async (path, method) => {
    if (method === "POST") { registered = true; return { id: 1 }; }
    return { total: 100, paid_cents: registered ? 4000 : 0, due_cents: registered ? 6000 : 10000, payment_status: registered ? "partial" : "unpaid", direction: "receive", entries: [] };
  });
  render(<PaymentEditor order={{ id: 99, number: "CK99", type: "out", status: "active", partner: "客户", total: 100, note: "", created_at: "2026-10-04T10:00:00Z", items: [] }} />);
  await screen.findByLabelText("本次收付款金额");
  fireEvent.changeText(screen.getByLabelText("本次收付款金额"), "40");
  fireEvent.press(screen.getByRole("button", { name: "登记收付款" }));
  expect(registered).toBe(false);
  const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === "确认登记")?.onPress;
  await act(async () => { confirm?.(); confirm?.(); });
  expect(request.mock.calls.filter(([,method]) => method === "POST")).toHaveLength(1);
  expect(request).toHaveBeenCalledWith("/orders/99/payments", "POST", expect.objectContaining({ amount: 40, method: "银行转账", request_id: expect.any(String) }));
  await screen.findByText(/部分收付.*60.00/);
  alert.mockRestore();
});

test("native product editor selects a descendant category and persists picked image, specification and notes", async () => {
  const image = 'data:image/jpeg;base64,/9j/';
  jest.mocked(device.pickImage).mockResolvedValue(image);
  request.mockResolvedValue({ id: 2, barcode: 'SKU-000002' });
  const saved = jest.fn();
  render(<ProductEditor categories={categories} onClose={jest.fn()} onSaved={saved} />);
  fireEvent.changeText(screen.getByLabelText('商品名称'), '带图片的杯子');
  fireEvent.press(screen.getByRole('button', { name: '日用百货 / 杯具' }));
  fireEvent.changeText(screen.getByLabelText('商品规格'), '350ml');
  fireEvent.changeText(screen.getByLabelText('商品备注'), '小心轻放');
  fireEvent.press(screen.getByRole('button', { name: '选择商品图片' }));
  await waitFor(() => expect(screen.getByLabelText('商品图片预览')).toBeOnTheScreen());
  fireEvent.press(screen.getByRole('button', { name: '保存商品' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith('/products', 'POST', expect.objectContaining({ category_id: 2, category: '日用百货 / 杯具', image, specification: '350ml', note: '小心轻放' }));
});

test("native product details display its image, specification and notes", () => {
  const image = 'data:image/jpeg;base64,/9j/';
  render(<ProductDetail product={{ ...product, image, specification: '350ml', note: '小心轻放' }} onClose={jest.fn()} edit={jest.fn()} openOrder={jest.fn()} />);
  expect(screen.getByLabelText('商品图片')).toBeOnTheScreen();
  expect(screen.getByText('350ml')).toBeOnTheScreen();
  expect(screen.getByText('小心轻放')).toBeOnTheScreen();
});

test("native parent category filtering includes descendant products", () => {
  render(<ProductsScreen categories={categories} products={[
    { ...product, category_id: 2, category: '日用百货 / 杯具' },
    { ...product, id: 2, name: '无关商品', category_id: 3, category: '其他' },
  ]} inventory={false} refreshing={false} onRefresh={jest.fn()} openProduct={jest.fn()} addProduct={jest.fn()} />);
  expect(screen.getByText('无关商品')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: '日用百货' }));
  expect(screen.getByText('陶瓷杯')).toBeOnTheScreen();
  expect(screen.queryByText('无关商品')).toBeNull();
});

test("native category editor creates a child with the selected parent", async () => {
  const changed = jest.fn().mockResolvedValue(undefined);
  request.mockResolvedValue({ id: 3 });
  render(<CategoryEditor categories={categories} onClose={jest.fn()} onChanged={changed} />);
  fireEvent.changeText(screen.getByLabelText('分类名称'), '保温杯');
  fireEvent.press(screen.getAllByRole('button', { name: '日用百货 / 杯具' })[1]!);
  fireEvent.press(screen.getByRole('button', { name: '保存分类' }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith('/categories', 'POST', { name: '保温杯', parent_id: 2 });
});
