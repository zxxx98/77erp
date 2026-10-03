import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AuthScreen, ScannerScreen } from "../src/screens";
import { OrderEditor, ProductEditor } from "../src/forms";
import { AppContent } from "../src/App";
import { api, device, scanBarcode } from "../src/native";
import { product, workspace } from "./fixtures";

jest.mock("../src/native", () => ({
  api: jest.fn(),
  scanBarcode: jest.fn(),
  onUnauthorized: jest.fn(() => () => {}),
  device: {
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
  render(<ProductEditor onClose={jest.fn()} onSaved={saved} />);
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
