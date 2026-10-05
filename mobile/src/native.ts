import { NativeModules, PermissionsAndroid } from "react-native";

export interface Device {
  getVersionCode(): Promise<number>;
  getServer(): Promise<string>;
  setServer(address: string): Promise<string>;
  request(
    path: string,
    method: string,
    body: string,
  ): Promise<{ status: number; body: string }>;
  clearSession(): Promise<void>;
  scan(): Promise<string | null>;
  pickImage(): Promise<string | null>;
}
export const device = NativeModules.ErpNative as Device;
let unauthorized: (() => void) | undefined;
export function onUnauthorized(callback: () => void) {
  unauthorized = callback;
  return () => {
    if (unauthorized === callback) unauthorized = undefined;
  };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response;
  try {
    response = await device.request(
      `/api${path}`,
      method,
      JSON.stringify(body ?? {}),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法连接服务器。";
    throw new ApiError(
      path === "/orders" && method === "POST"
        ? `${message} 提交结果可能未知，请先检查操作记录再决定是否重试。`
        : message,
    );
  }
  if (response.status === 401 && !path.startsWith("/auth/")) unauthorized?.();
  if (response.status >= 300 && response.status < 400)
    throw new ApiError(
      "服务器返回跳转，请在连接设置中填写最终服务器地址。",
      response.status,
    );
  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new ApiError(
      "服务器没有返回有效的 ERP 数据，请检查地址。",
      response.status,
    );
  }
  if (response.status < 200 || response.status >= 300)
    throw new ApiError(data.error || "请求失败，请重试。", response.status);
  return data as T;
}
export async function scanBarcode(): Promise<string | null> {
  const permission = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: "允许扫描商品条码",
      message: "使用手机摄像头识别商品条码，扫码不会自动改变库存。",
      buttonPositive: "继续",
      buttonNegative: "取消",
    },
  );
  if (permission !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error("摄像头权限未开启，请在系统设置中授权，或手动输入条码。");
  return device.scan();
}
