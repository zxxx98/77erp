import { useEffect } from "react";
import { Alert, AppState, Linking } from "react-native";
import { device } from "./native";

const RELEASE_API = "https://api.github.com/repos/zxxx98/77erp/releases/latest";
const DOWNLOAD_ROOT = "https://github.com/zxxx98/77erp/releases/download/";
type Update = { version: string; url: string };

// Keep the comparison identical to Android's versionCode calculation.
export function availableUpdate(release: unknown, installedCode: number): Update | null {
  if (!release || typeof release !== "object" || !Number.isSafeInteger(installedCode) || installedCode < 1) return null;
  const value = release as Record<string, unknown>;
  if (value.draft !== false || value.prerelease !== false || typeof value.tag_name !== "string") return null;
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.tag_name);
  if (!match) return null;
  const major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3]);
  const code = major * 1000000 + minor * 1000 + patch;
  if (major > 2099 || minor > 999 || patch > 999 || code <= installedCode) return null;
  const version = value.tag_name.slice(1);
  const name = `77ERP-${version}-arm64.apk`;
  const url = `${DOWNLOAD_ROOT}${value.tag_name}/${name}`;
  if (!Array.isArray(value.assets) || !value.assets.some(asset =>
    asset && asset.name === name && asset.browser_download_url === url && asset.size > 0 && asset.state === "uploaded"
  )) return null;
  return { version, url };
}

export function useAppUpdate() {
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let promptOpen = false;
    let state = AppState.currentState;
    let controller: AbortController | undefined;
    const check = async () => {
      if (checking || promptOpen) return;
      checking = true;
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 10000);
      try {
        const installedCode = await device.getVersionCode();
        if (disposed || controller.signal.aborted) return;
        const response = await fetch(RELEASE_API, {
          headers: { Accept: "application/vnd.github+json" },
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const update = availableUpdate(await response.json(), installedCode);
        if (!update || disposed || state !== "active") return;
        promptOpen = true;
        const dismiss = () => { promptOpen = false; };
        Alert.alert(
          "发现新版本",
          `77 ERP ${update.version} 已发布。下载后打开 APK，按系统提示覆盖安装即可保留应用设置。`,
          [
            { text: "暂不更新", style: "cancel", onPress: dismiss },
            { text: "下载更新", onPress: () => {
              void Linking.openURL(update.url).catch(() => {
                if (!disposed) Alert.alert("无法打开下载", "请检查浏览器是否可用，稍后重新打开应用重试。");
              }).finally(dismiss);
            } },
          ],
          { cancelable: true, onDismiss: dismiss },
        );
      } catch {
        // Offline, rate limited or unavailable releases must not block ERP work.
      } finally {
        clearTimeout(timer);
        checking = false;
      }
    };
    void check();
    const subscription = AppState.addEventListener("change", next => {
      const reopened = state !== "active" && next === "active";
      state = next;
      if (reopened) void check();
    });
    return () => {
      disposed = true;
      controller?.abort();
      subscription.remove();
    };
  }, []);
}
