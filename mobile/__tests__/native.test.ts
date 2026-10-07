import { NativeModules, PermissionsAndroid } from "react-native";

NativeModules.ErpNative = { request: jest.fn(), scan: jest.fn() };
const { api, onUnauthorized, scanBarcode, setWarehouseId } =
  require("../src/native") as typeof import("../src/native");
const transport = NativeModules.ErpNative;
beforeEach(() => jest.clearAllMocks());

test("native client sends JSON to the existing API without exposing cookies", async () => {
  transport.request.mockResolvedValue({
    status: 201,
    body: '{"number":"RK1"}',
  });
  await expect(api("/orders", "POST", { type: "in" })).resolves.toEqual({
    number: "RK1",
  });
  expect(transport.request).toHaveBeenCalledWith(
    "/api/orders",
    "POST",
    '{"type":"in"}',
  );
});
test("expired sessions return to login, while a wrong password does not expire the application state", async () => {
  const expired = jest.fn();
  const unsubscribe = onUnauthorized(expired);
  transport.request.mockResolvedValue({
    status: 401,
    body: '{"error":"请登录"}',
  });
  await expect(api("/auth/login", "POST")).rejects.toThrow("请登录");
  expect(expired).not.toHaveBeenCalled();
  await expect(api("/data")).rejects.toThrow("请登录");
  expect(expired).toHaveBeenCalledTimes(1);
  unsubscribe();
});
test("redirects and HTML responses never render as application pages", async () => {
  transport.request
    .mockResolvedValueOnce({ status: 302, body: "" })
    .mockResolvedValueOnce({ status: 200, body: "<html>not ERP</html>" });
  await expect(api("/data")).rejects.toThrow("跳转");
  await expect(api("/data")).rejects.toThrow("有效的 ERP 数据");
});
test("an uncertain order response warns to inspect history and never retries a POST", async () => {
  transport.request.mockRejectedValue(new Error("网络中断"));
  await expect(api("/orders", "POST", {})).rejects.toThrow("先检查操作记录");
  expect(transport.request).toHaveBeenCalledTimes(1);
});
test("camera permission denied does not launch scanner; cancellation is a normal result", async () => {
  jest
    .spyOn(PermissionsAndroid, "request")
    .mockResolvedValueOnce("denied")
    .mockResolvedValueOnce("granted");
  await expect(scanBarcode()).rejects.toThrow("摄像头权限未开启");
  expect(transport.scan).not.toHaveBeenCalled();
  transport.scan.mockResolvedValue(null);
  await expect(scanBarcode()).resolves.toBeNull();
});


test("selected warehouse is carried on reads, writes and existing queries without changing authentication", async () => {
  transport.request.mockResolvedValue({ status: 200, body: '{}' });
  setWarehouseId(2);
  try {
    await api("/data");
    expect(transport.request).toHaveBeenLastCalledWith("/api/data?warehouse_id=2", "GET", "{}");
    await api("/orders", "POST", { type: "in" });
    expect(transport.request).toHaveBeenLastCalledWith("/api/orders?warehouse_id=2", "POST", '{"type":"in"}');
    await api("/reports/profit?from=2026-01-01");
    expect(transport.request).toHaveBeenLastCalledWith("/api/reports/profit?from=2026-01-01&warehouse_id=2", "GET", "{}");
    await api("/auth/status");
    expect(transport.request).toHaveBeenLastCalledWith("/api/auth/status", "GET", "{}");
  } finally { setWarehouseId(1); }
});
