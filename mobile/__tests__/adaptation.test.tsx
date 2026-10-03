import React from "react";
import * as RN from "react-native";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { AppContent } from "../src/App";
import { ProductEditor, OrderEditor } from "../src/forms";
import { AuthScreen, ProductDetail, ScannerScreen } from "../src/screens";
import { api, device, scanBarcode } from "../src/native";
import { product, workspace } from "./fixtures";
import { KeyboardSafeArea } from "../src/ui";

// These are component/event regressions, not device layout or screenshot tests.
jest.mock("../src/native", () => ({
  api: jest.fn(),
  scanBarcode: jest.fn(),
  onUnauthorized: jest.fn(() => () => {}),
  device: {
    getServer: jest.fn(),
    setServer: jest.fn(),
    clearSession: jest.fn(),
  },
  ApiError: class extends Error {},
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const request = jest.mocked(api);
function viewport(width: number, height: number, fontScale = 1, bottom = 24) {
  jest
    .mocked(RN.useWindowDimensions)
    .mockReturnValue({ width, height, fontScale, scale: 3 });
  jest.mocked(useSafeAreaFrame).mockReturnValue({ x: 0, y: 0, width, height });
  jest
    .mocked(useSafeAreaInsets)
    .mockReturnValue({ top: 24, bottom, left: 0, right: 0 });
}
function keyboard(visible: boolean) {
  act(() =>
    RN.DeviceEventEmitter.emit(
      visible ? "keyboardDidShow" : "keyboardDidHide",
      {
        endCoordinates: { screenX: 0, screenY: 400, width: 360, height: 280 },
        duration: 0,
        easing: "keyboard",
      },
    ),
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(RN.Platform, "OS", "android");
  viewport(360, 800);
  keyboard(false);
});

test.each([0, 24])(
  "keyboard avoidance accounts for window origin %s without duplicating native resize",
  async (origin) => {
    jest
      .mocked(useSafeAreaFrame)
      .mockReturnValue({ x: 0, y: origin, width: 360, height: 800 - origin });
    render(
      <KeyboardSafeArea>
        <RN.Text>表单内容</RN.Text>
      </KeyboardSafeArea>,
    );
    const layout = (height: number) =>
      fireEvent(screen.getByTestId("keyboard-safe-root"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
        persist: () => {},
      });
    layout(800 - origin);
    keyboard(true);
    await waitFor(() =>
      expect(screen.getByTestId("keyboard-safe-root")).toHaveStyle({
        paddingBottom: 400,
      }),
    );
    layout(400 - origin);
    await waitFor(() =>
      expect(screen.getByTestId("keyboard-safe-root")).toHaveStyle({
        paddingBottom: 0,
      }),
    );
    keyboard(false);
    layout(800 - origin);
    await waitFor(() =>
      expect(screen.getByTestId("keyboard-safe-root")).toHaveStyle({
        paddingBottom: 0,
      }),
    );
  },
);
afterEach(() => {
  cleanup();
  keyboard(false);
  jest.restoreAllMocks();
});

test.each([
  [320, 480, 1],
  [800, 360, 1],
  [360, 800, 2],
  [1024, 600, 1.3],
])(
  "form actions stay in scroll content at %s × %s, font scale %s",
  (width, height, scale) => {
    viewport(width, height, scale);
    render(
      <ProductDetail
        product={product}
        onClose={jest.fn()}
        edit={jest.fn()}
        openOrder={jest.fn()}
      />,
    );
    expect(screen.getByTestId("inline-form-actions")).toBeOnTheScreen();
    expect(screen.queryByTestId("fixed-form-actions")).toBeNull();
    expect(screen.getByRole("button", { name: "采购入库" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "销售出库" })).toBeEnabled();
  },
);

test("safe area space is deducted before deciding whether to pin form actions", () => {
  viewport(360, 550, 1, 48);
  render(<ProductEditor onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByTestId("inline-form-actions")).toBeOnTheScreen();
});

test("keyboard and rotation move actions without losing edited fields or changing submission", async () => {
  request.mockResolvedValue({ id: 2 });
  const saved = jest.fn();
  const editor = <ProductEditor onClose={jest.fn()} onSaved={saved} />;
  const result = render(editor);
  expect(screen.getByTestId("fixed-form-actions")).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText("商品名称"), "横屏编辑的商品");
  fireEvent.changeText(screen.getByLabelText("分类"), "较长的商品分类");
  keyboard(true);
  expect(screen.getByTestId("inline-form-actions")).toBeOnTheScreen();
  expect(screen.queryByTestId("fixed-form-actions")).toBeNull();
  viewport(800, 360, 2);
  result.rerender(editor);
  keyboard(false);
  expect(screen.getByLabelText("商品名称")).toHaveProp(
    "value",
    "横屏编辑的商品",
  );
  expect(screen.getByLabelText("分类")).toHaveProp("value", "较长的商品分类");
  fireEvent.press(screen.getByRole("button", { name: "保存商品" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith(
    "/products",
    "POST",
    expect.objectContaining({
      name: "横屏编辑的商品",
      category: "较长的商品分类",
    }),
  );
});

test("repeating the same order validation error scrolls back to its message each time", async () => {
  const scrollTo = jest.spyOn(RN.ScrollView.prototype, "scrollTo");
  render(
    <OrderEditor
      type="out"
      products={[product]}
      initialProduct={product}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
  fireEvent.changeText(screen.getByLabelText(`${product.name} 数量`), "999");
  fireEvent.press(screen.getByRole("button", { name: "确认出库" }));
  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true }),
  );
  scrollTo.mockClear();
  fireEvent.press(screen.getByRole("button", { name: "确认出库" }));
  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true }),
  );
  expect(request).not.toHaveBeenCalled();
});

test("password visibility preserves text and the controls lock while login is pending", async () => {
  viewport(320, 568, 2);
  let finish!: (auth: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <AuthScreen
      auth={{ initialized: true, authenticated: false }}
      server="https://erp.example.com"
      notice=""
      onSuccess={jest.fn()}
      onRefresh={jest.fn()}
      onServer={jest.fn()}
    />,
  );
  fireEvent.changeText(screen.getByLabelText("管理员账号"), "admin");
  fireEvent.changeText(
    screen.getByLabelText("密码"),
    "long-password-123456789",
  );
  fireEvent.press(screen.getByRole("button", { name: "显示密码" }));
  expect(screen.getByLabelText("密码")).toHaveProp("secureTextEntry", false);
  expect(screen.getByLabelText("密码")).toHaveProp(
    "value",
    "long-password-123456789",
  );
  fireEvent.press(screen.getByRole("button", { name: "登录" }));
  expect(screen.getByRole("button", { name: "隐藏密码" })).toBeDisabled();
  expect(screen.getByLabelText("密码")).toHaveProp("editable", false);
  await act(async () => finish({ initialized: true, authenticated: true }));
});

test("submitting a product disables both the back button and hardware dismissal", async () => {
  let finish!: (data: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const close = jest.fn();
  render(
    <ProductEditor product={product} onClose={close} onSaved={jest.fn()} />,
  );
  fireEvent.press(screen.getByRole("button", { name: "保存商品" }));
  expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "返回" }));
  fireEvent(screen.UNSAFE_getByType(RN.Modal), "requestClose");
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish({ id: product.id }));
});

test("keyboard hides navigation and restores the selected tab with the current search", async () => {
  jest.mocked(device.getServer).mockResolvedValue("https://erp.example.com");
  request.mockImplementation(async (path) =>
    path === "/auth/status"
      ? { initialized: true, authenticated: true, username: "admin" }
      : workspace,
  );
  render(<AppContent />);
  await screen.findByText("测试商户 · 主仓库");
  fireEvent.press(screen.getByRole("tab", { name: "商品" }));
  fireEvent.changeText(
    screen.getByLabelText("搜索商品名称、条码或分类"),
    "陶瓷",
  );
  keyboard(true);
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  keyboard(false);
  expect(
    screen.getByRole("tab", { name: "商品", selected: true }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("搜索商品名称、条码或分类")).toHaveProp(
    "value",
    "陶瓷",
  );
});

test("long product details remain complete and order field labels stay distinct", () => {
  viewport(320, 568, 2);
  const longProduct = {
    ...product,
    name: "超长商品名称".repeat(15),
    category: "超长分类".repeat(15),
    unit: "整箱包装单位".repeat(10),
  };
  const result = render(
    <ProductDetail
      product={longProduct}
      onClose={jest.fn()}
      edit={jest.fn()}
      openOrder={jest.fn()}
    />,
  );
  expect(
    screen.getByText(longProduct.name).props.numberOfLines,
  ).toBeUndefined();
  expect(
    screen.getByText(longProduct.category).props.numberOfLines,
  ).toBeUndefined();
  result.unmount();
  render(
    <OrderEditor
      type="in"
      products={[longProduct]}
      initialProduct={longProduct}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />,
  );
  expect(screen.getByText("数量")).toBeOnTheScreen();
  expect(screen.getByLabelText(`${longProduct.name} 数量`)).toHaveProp(
    "value",
    "1",
  );
  expect(screen.getByLabelText(`${longProduct.name} 单价`)).toHaveProp(
    "value",
    "10",
  );
});

test("unknown barcode does not offer permission settings, permission denial does", async () => {
  render(
    <ScannerScreen
      products={[product]}
      onClose={jest.fn()}
      openOrder={jest.fn()}
    />,
  );
  fireEvent.changeText(screen.getByLabelText("手动输入条码"), "UNKNOWN");
  fireEvent.press(screen.getByRole("button", { name: "查询商品" }));
  expect(screen.queryByRole("button", { name: "打开系统权限设置" })).toBeNull();
  jest
    .mocked(scanBarcode)
    .mockRejectedValue(new Error("摄像头权限未开启，请在系统设置中授权。"));
  fireEvent.press(screen.getByRole("button", { name: "打开摄像头扫码" }));
  expect(
    await screen.findByRole("button", { name: "打开系统权限设置" }),
  ).toBeEnabled();
});
