import { useEffect } from "react";
import { Alert, AppState } from "react-native";
import { device } from "./native";

const RELEASE_API = "https://api.github.com/repos/zxxx98/77erp/releases/latest";
const DOWNLOAD_ROOT = "https://github.com/zxxx98/77erp/releases/download/";
export type Update = { version: string; url: string };

// Keep the comparison identical to Android's versionCode calculation.
export function availableUpdate(release: unknown, installedCode: number): Update | null {
  if (!release || typeof release !== "object" || !Number.isSafeInteger(installedCode) || installedCode < 0) return null;
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

export async function checkForUpdate(signal?: AbortSignal): Promise<Update | null> {
  const installedCode = await device.getVersionCode();
  if (!Number.isSafeInteger(installedCode) || installedCode < 1) throw new Error("无法读取当前应用版本，请重新打开应用后重试。");
  if (signal?.aborted) throw new Error("检查更新超时，请稍后重试。");
  const response = await fetch(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    signal,
  }).catch(() => {
    throw new Error(signal?.aborted ? "检查更新超时，请稍后重试。" : "无法检查更新，请检查网络后重试。");
  });
  if (response.status === 404) throw new Error("GitHub 暂无可用的正式版本。");
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429
    ? "GitHub 请求次数受限，请稍后重试。" : "无法检查更新，请检查网络后重试。");
  const release: unknown = await response.json();
  // Validate the release even when the installed version is already newer.
  if (!availableUpdate(release, 0)) throw new Error("最新正式版本尚未提供可用的 ARM64 安装包，请稍后重试。");
  return availableUpdate(release, installedCode);
}

export function useAppUpdate() {
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let promptOpen = false;
    let installing = false;
    let state = AppState.currentState;
    let controller: AbortController | undefined;
    const check = async () => {
      if (checking || promptOpen || installing) return;
      checking = true;
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 10000);
      try {
        const update = await checkForUpdate(controller.signal);
        if (!update || disposed || state !== "active") return;
        promptOpen = true;
        const dismiss = () => { promptOpen = false; };
        Alert.alert(
          "发现新版本",
          `77 ERP ${update.version} 已发布。点击立即更新下载安装包，再按系统提示覆盖安装。首次更新需允许此应用安装，应用设置会保留。`,
          [
            { text: "暂不更新", style: "cancel", onPress: dismiss },
            { text: "立即更新", onPress: () => {
              if (installing) return;
              installing = true;
              Alert.alert("正在下载更新", "正在从 GitHub 下载安装包，完成后将打开系统安装界面。请保持应用在前台。");
              void device.installUpdate(update.url).catch(error => {
                if (!disposed) Alert.alert("更新失败", error instanceof Error ? error.message : "下载失败，请稍后重试。");
              }).finally(() => { installing = false; dismiss(); });
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
