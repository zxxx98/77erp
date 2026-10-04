import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert, AppState, AppStateStatus, Linking } from "react-native";
import { availableUpdate, useAppUpdate } from "../src/updates";
import { device } from "../src/native";

jest.mock("../src/native", () => ({ device: { getVersionCode: jest.fn() } }));
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
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  jest.mocked(device.getVersionCode).mockResolvedValue(1002000);
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

test("checks on launch and reopening, suppresses duplicate prompts and opens the APK", async () => {
  renderHook(useAppUpdate);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
  act(() => { change("background"); change("active"); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  act(() => { jest.mocked(Alert.alert).mock.calls[0]?.[2]?.[0]?.onPress?.(); });
  await act(async () => { change("background"); change("active"); });
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(2));
  await act(async () => { jest.mocked(Alert.alert).mock.calls[1]?.[2]?.[1]?.onPress?.(); });
  expect(Linking.openURL).toHaveBeenCalledWith(release().assets[0]?.browser_download_url);
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
