import React, { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react-native";
import { StockQrManager, StockQrExecution, StockQr } from "../src/stock-qr";
import { Button } from "../src/ui";
import { api, device, ApiError } from "../src/native";
import { product, workspace } from "./fixtures";

jest.mock("../src/native", () => ({
  api: jest.fn(),
  scanBarcode: jest.fn(),
  device: { getStockQrPending: jest.fn(), setStockQrPending: jest.fn() },
  ApiError: class extends Error {
    constructor(
      message: string,
      public status = 0,
    ) {
      super(message);
    }
  },
}));
const request = jest.mocked(api),
  storage = jest.mocked(device);
const second = {
  ...product,
  id: 2,
  name: "组合箱",
  barcode: "QR-BOX",
  unit: "箱",
};
const items = [product, second].map((p, i) => ({
  product_id: p.id,
  name: p.name,
  barcode: p.barcode,
  unit: p.unit,
  stock: p.stock,
  quantity: i ? 2 : 5,
  price_cents: 1000,
  amount_cents: i ? 2000 : 5000,
}));
const qr: StockQr = {
  id: 1,
  qr_id: "a08f04e0-6420-4c84-9c07-189e70c95539",
  warehouse_id: 1,
  warehouse_name: "主仓库",
  name: "组合入库",
  type: "in",
  items,
  max_scans: 3,
  used_scans: 0,
  remaining_scans: 3,
  require_confirmation: true,
  enabled: true,
  partner_id: 1,
  partner_name: "供应商",
  note: "",
  version: 1,
};
const preview = {
  ...qr,
  preview_token: "test-preview-token",
  expires_at: "2099-01-01",
  total_cents: 7000,
};
const result = { id: 1, number: "RK20261013000001", items, remaining_scans: 2 };
const label = {
  format: "77erp",
  version: 1,
  type: "stock_operation",
  source_id: "source",
  warehouse_id: 1,
  qr_id: qr.qr_id,
};
beforeEach(() => {
  jest.clearAllMocks();
  storage.getStockQrPending.mockResolvedValue(null);
  storage.setStockQrPending.mockResolvedValue(undefined);
});
function Flow({ saved = jest.fn() }: { saved?: (s: string) => void }) {
  const [current, setCurrent] = useState<object | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        title="模拟扫码"
        disabled={busy}
        onPress={() => setCurrent({ ...label })}
      />
      <StockQrExecution
        label={current}
        onLabelDone={() => setCurrent(null)}
        mode="in"
        warehouseId={1}
        storageKey="server:source:worker:1"
        onSaved={saved}
        onBusy={setBusy}
      />
    </>
  );
}
async function scan() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "模拟扫码" }).props.accessibilityState
        .disabled,
    ).toBe(false),
  );
  fireEvent.press(screen.getByRole("button", { name: "模拟扫码" }));
}

test("manager defaults to confirmation and saves independently configured quantities for a product combination", async () => {
  request.mockImplementation(async (path, method) =>
    method === "POST" ? qr : { rows: [], total: 0 },
  );
  render(
    <StockQrManager
      data={{
        ...workspace,
        products: [product, second],
        warehouse_id: 1,
        instance_id: "source",
      }}
      onClose={jest.fn()}
    />,
  );
  fireEvent.press(await screen.findByRole("button", { name: "新建二维码" }));
  expect(screen.getByLabelText("需要二次确认").props.value).toBe(true);
  for (const p of [product, second]) {
    fireEvent.changeText(screen.getByLabelText("搜索添加物料"), p.name);
    fireEvent.press(
      screen.getByRole("button", { name: `添加 ${p.name} · ${p.barcode}` }),
    );
  }
  fireEvent.changeText(
    screen.getByLabelText(`${product.name} 单次数量（个）`),
    "5",
  );
  fireEvent.changeText(
    screen.getByLabelText(`${second.name} 单次数量（箱）`),
    "2",
  );
  fireEvent.changeText(screen.getByLabelText("往来单位"), "供应商");
  fireEvent.press(screen.getByRole("button", { name: "保存二维码" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/stock-qrs",
      "POST",
      expect.objectContaining({
        require_confirmation: true,
        items: [
          { product_id: 1, quantity: 5, price_cents: 1000 },
          { product_id: 2, quantity: 2, price_cents: 1000 },
        ],
      }),
    ),
  );
  expect(await screen.findByLabelText("出入库二维码")).toBeTruthy();
});

test("confirmation shows every product and cancellation never sends an execute request", async () => {
  request.mockResolvedValue(preview);
  render(<Flow />);
  await scan();
  expect(await screen.findByRole("button", { name: "确认入库" })).toBeTruthy();
  expect(screen.getByText("组合箱")).toBeTruthy();
  expect(screen.getByText("陶瓷杯")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "取消" }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(storage.setStockQrPending).not.toHaveBeenCalled();
});

test("no-confirmation executes one entire order and persists its retry identity before sending", async () => {
  const saved = jest.fn();
  request.mockImplementation(async (path) =>
    path === "/stock-qrs/preview"
      ? { ...preview, require_confirmation: false }
      : result,
  );
  render(<Flow saved={saved} />);
  await scan();
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(`单据 ${result.number} 已保存`),
  );
  const command = request.mock.calls.find(([path]) =>
    path.endsWith("/execute"),
  );
  expect(command?.[2]).toEqual(
    expect.objectContaining({
      preview_token: "test-preview-token",
      confirmed: false,
      request_id: expect.any(String),
    }),
  );
  expect(storage.setStockQrPending.mock.invocationCallOrder[0]).toBeLessThan(
    request.mock.invocationCallOrder[1]!,
  );
  expect(storage.setStockQrPending).toHaveBeenLastCalledWith(
    "server:source:worker:1",
    null,
  );
  expect(screen.queryByText("确认入库")).toBeNull();
});

test("timeout retains original request across unmount and retries it without another preview", async () => {
  request.mockImplementation(async (path) => {
    if (path === "/stock-qrs/preview")
      return { ...preview, require_confirmation: false };
    throw new ApiError("网络中断");
  });
  const view = render(<Flow />);
  await scan();
  await screen.findByRole("button", { name: "重试原扫码请求" });
  const raw = storage.setStockQrPending.mock.calls[0]?.[1];
  expect(raw).toBeTruthy();
  const original = request.mock.calls.find(([path]) =>
    path.endsWith("/execute"),
  )?.[2];
  view.unmount();
  storage.getStockQrPending.mockResolvedValue(raw!);
  request.mockClear();
  request.mockResolvedValue(result);
  const saved = jest.fn();
  render(<Flow saved={saved} />);
  fireEvent.press(
    await screen.findByRole("button", { name: "重试原扫码请求" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[2]).toEqual(original);
});

test("definitive stock failure stops the whole operation and clears only its pending request", async () => {
  request.mockImplementation(async (path) => {
    if (path === "/stock-qrs/preview")
      return { ...preview, require_confirmation: false };
    throw new ApiError("组合箱库存不足", 409);
  });
  render(<Flow />);
  await scan();
  expect(await screen.findByText("组合箱库存不足")).toBeTruthy();
  await waitFor(() =>
    expect(storage.setStockQrPending).toHaveBeenLastCalledWith(
      "server:source:worker:1",
      null,
    ),
  );
  expect(screen.queryByRole("button", { name: "重试原扫码请求" })).toBeNull();
});
