import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Alert, AppState, AppStateStatus } from "react-native";
import { availableUpdate, useAppUpdate } from "../src/updates";
import { UpdateCard } from "../src/UpdateCard";
import { device, onUpdateProgress } from "../src/native";

jest.mock("../src/native", () => ({
  device: { getVersionCode: jest.fn(), installUpdate: jest.fn() },
  onUpdateProgress: jest.fn(() => () => {}),
}));
const release = (version = "1.3.0") => ({
  tag_name: `v${version}`, draft: false, prerelease: false,
  assets: [{ name: `77ERP-${version}-arm64.apk`, size: 100, state: "uploaded",
    browser_download_url: `https://github.com/zxxx98/77erp/releases/download/v${version}/77ERP-${version}-arm64.apk` }],
});
let change: (state: AppStateStatus) => void;
const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    change = callback;
    return { remove: jest.fn() };
  });
  AppState.currentState = "active";
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.mocked(device.installUpdate).mockReset().mockResolvedValue(undefined);
  jest.mocked(device.getVersionCode).mockResolvedValue(1002000);
  jest.mocked(onUpdateProgress).mockReset().mockReturnValue(() => {});
  globalThis.fetch = fetchMock.mockResolvedValue({ ok: true, json: async () => release() });
});
afterEach(() => { jest.restoreAllMocks(); fetchMock.mockReset(); globalThis.fetch = originalFetch; });

test("compares numeric Android versions and only offers a published matching APK", () => {
  expect(availableUpdate(release("1.10.0"), 1009000)?.version).toBe("1.10.0");
  for (const value of [release("1.2.0"), release("1.1.0"), release("1.1000.0"),
    { ...release(), prerelease: true }, { ...release(), draft: true },
    { ...release(), assets: [] }, { ...release(), tag_name: "v1.3.0-beta" },
    { ...release(), assets: [{ ...release().assets[0], browser_download_url: "https://example.com/app.apk" }] }, null]) {
    expect(availableUpdate(value, 1002000)).toBeNull();
  }
});

test("checks on launch and reopening, suppresses duplicate prompts and installs the APK", async () => {
  renderHook(useAppUpdate);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
  act(() => { change("background"); change("active"); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  act(() => { jest.mocked(Alert.alert).mock.calls[0]?.[2]?.[0]?.onPress?.(); });
  await act(async () => { change("background"); change("active"); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(2));
  await act(async () => { jest.mocked(Alert.alert).mock.calls[1]?.[2]?.[1]?.onPress?.(); });
  expect(device.installUpdate).toHaveBeenCalledWith(release().assets[0]?.browser_download_url);
});

test("network failure stays silent and a later reopen retries", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  renderHook(useAppUpdate);
  await act(async () => {});
  expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => { change("background"); change("active"); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
});

test("a response received after unmount never shows an update dialog", async () => {
  let resolve!: (value: unknown) => void;
  fetchMock.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = renderHook(useAppUpdate);
  await act(async () => {});
  view.unmount();
  await act(async () => { resolve({ ok: true, json: async () => release() }); });
  expect(Alert.alert).not.toHaveBeenCalled();
});

test("settings shows the installed version, checks manually and downloads before launching installation", async () => {
  let finish!: () => void;
  jest.mocked(device.installUpdate).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<UpdateCard />);
  await screen.findByText("当前版本 1.2.0");
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("发现新版本 1.3.0");
  fireEvent.press(screen.getByText("立即更新"));
  expect(device.installUpdate).toHaveBeenCalledWith(release().assets[0]?.browser_download_url);
  fireEvent.press(screen.getByText("立即更新"));
  expect(device.installUpdate).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(screen.getByText(/已打开系统安装界面/)).toBeTruthy();
});

test("manual checks report no update, network failures and allow retries", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => release("1.2.0") });
  render(<UpdateCard />);
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("当前已是最新版本");
  expect(screen.queryByText("立即更新")).toBeNull();
  fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("GitHub 请求次数受限，请稍后重试。");
  fetchMock.mockRejectedValueOnce(new Error("Network request failed"));
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("无法检查更新，请检查网络后重试。");
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("发现新版本 1.3.0");
});

test("manual checks time out and can be retried", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    render(<UpdateCard />);
    await act(async () => {});
    fireEvent.press(screen.getByText("检查更新"));
    await act(async () => {});
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByText("检查更新超时，请稍后重试。")).toBeTruthy();
    fireEvent.press(screen.getByText("检查更新"));
    await act(async () => {});
    expect(screen.getByText("发现新版本 1.3.0")).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

test("missing APK is reported and installation failures can be retried", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...release(), assets: [] }) });
  render(<UpdateCard />);
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("最新正式版本尚未提供可用的 ARM64 安装包，请稍后重试。");
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("立即更新");
  jest.mocked(device.installUpdate).mockRejectedValueOnce(new Error("未允许安装应用"));
  fireEvent.press(screen.getByText("立即更新"));
  await screen.findByText("未允许安装应用");
  fireEvent.press(screen.getByText("立即更新"));
  await screen.findByText(/已打开系统安装界面/);
});

test("download progress is shown as a percentage and cleared when installation opens", async () => {
  let emit!: (progress: { received: number; total: number; done: boolean }) => void;
  jest.mocked(onUpdateProgress).mockImplementation(handler => { emit = handler; return () => {}; });
  let finish!: () => void;
  jest.mocked(device.installUpdate).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<UpdateCard />);
  fireEvent.press(screen.getByText("检查更新"));
  await screen.findByText("发现新版本 1.3.0");
  fireEvent.press(screen.getByText("立即更新"));
  expect(await screen.findByText("已下载 0.0 MB")).toBeTruthy();
  act(() => { emit({ received: 5 * 1024 * 1024, total: 20 * 1024 * 1024, done: false }); });
  expect(screen.getByText("已下载 25%（5.0 MB / 20.0 MB）")).toBeTruthy();
  act(() => { emit({ received: 20 * 1024 * 1024, total: 20 * 1024 * 1024, done: true }); });
  expect(screen.getByText("已下载 25%（5.0 MB / 20.0 MB）")).toBeTruthy();
  await act(async () => { finish(); });
  expect(screen.queryByText(/已下载/)).toBeNull();
  expect(screen.getByText(/已打开系统安装界面/)).toBeTruthy();
});
