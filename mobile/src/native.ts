import { DeviceEventEmitter, NativeModules, PermissionsAndroid } from "react-native";

export interface Device {
  getVersionCode(): Promise<number>;
  installUpdate(url: string): Promise<void>;
  getServer(): Promise<string>;
  setServer(address: string): Promise<string>;
  request(
    path: string,
    method: string,
    body: string,
  ): Promise<{ status: number; body: string }>;
  clearSession(): Promise<void>;
  scan(): Promise<string | null>;
  getStockQrPending(key: string): Promise<string | null>;
  setStockQrPending(key: string, value: string | null): Promise<void>;
  pickImage(): Promise<string | null>;
  uploadImage(uri: string, warehouseId: number): Promise<{ status: number; body: string }>;
}
export const device = NativeModules.ErpNative as Device;
export type UpdateProgress = { received: number; total: number; done: boolean };
// The native updater reports download bytes; total is -1 when the server omits a length.
export function onUpdateProgress(handler: (progress: UpdateProgress) => void) {
  const subscription = DeviceEventEmitter.addListener("updateProgress", (event) => {
    if (!event || typeof event.received !== "number" || typeof event.total !== "number") return;
    handler({ received: event.received, total: event.total, done: event.done === true });
  });
  return () => subscription.remove();
}
let warehouseId = 1;
export const getWarehouseId = () => warehouseId;
export const setWarehouseId = (id: number) => { warehouseId = id; };
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
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  selectedWarehouse = warehouseId,
): Promise<T> {
  let response;
  try {
    response = await device.request(
      `/api${path}${selectedWarehouse !== 1 && !path.startsWith("/auth/") ? `${path.includes("?") ? "&" : "?"}warehouse_id=${selectedWarehouse}` : ""}`,
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
  return decodeResponse<T>(response, path);
}
function decodeResponse<T>(response: { status: number; body: string }, path: string): T {
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
    throw new ApiError(data.error || "请求失败，请重试。", response.status, data.code);
  return data as T;
}
export async function uploadProductImage(uri: string): Promise<string> {
  let response;
  try { response = await device.uploadImage(uri, warehouseId); }
  catch (error) { throw new ApiError(error instanceof Error ? error.message : '图片上传失败，请重新选择图片重试。'); }
  const data = decodeResponse<{ url: string }>(response, '/uploads/product-image');
  if (typeof data.url !== 'string' || !data.url.startsWith('https://')) throw new ApiError('服务器未返回有效的图片 URL。');
  return data.url;
}
export async function scanBarcode(): Promise<string | null> {
  const permission = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: "允许扫描物料条码",
      message: "识别物料或出入库二维码；免确认出入库二维码会直接生成单据并更新库存。",
      buttonPositive: "继续",
      buttonNegative: "取消",
    },
  );
  if (permission !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error("摄像头权限未开启，请在系统设置中授权，或手动输入条码。");
  return device.scan();
}
