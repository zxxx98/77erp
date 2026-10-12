import React, { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { device } from "./native";
import { checkForUpdate, Update } from "./updates";
import { Button, Card, ErrorNotice, s, useSubmitLock } from "./ui";

export function UpdateCard() {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const lock = useSubmitLock();
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const code = await device.getVersionCode();
        if (mounted.current && Number.isSafeInteger(code))
          setVersion(`${Math.floor(code / 1000000)}.${Math.floor(code / 1000) % 1000}.${code % 1000}`);
      } catch { /* Manual checks report any version-reading failure. */ }
    })();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const check = async () => {
    if (!lock.enter()) return;
    setChecking(true); setError(""); setStatus(""); setUpdate(null);
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const latest = await checkForUpdate(abort.signal);
      if (!mounted.current) return;
      setUpdate(latest);
      setStatus(latest ? `发现新版本 ${latest.version}` : "当前已是最新版本");
    } catch (e) {
      if (mounted.current) setError(abort.signal.aborted ? "检查更新超时，请稍后重试。" : e instanceof Error ? e.message : "检查失败，请检查网络后重试。");
    } finally {
      clearTimeout(timer);
      if (mounted.current) setChecking(false);
      lock.leave();
    }
  };
  const install = async () => {
    if (!update || !lock.enter()) return;
    setDownloading(true); setError("");
    setStatus("正在从 GitHub 下载安装包，请保持应用在前台。首次更新需按系统提示允许安装应用。");
    try {
      await device.installUpdate(update.url);
      if (mounted.current) setStatus("已打开系统安装界面，请确认安装。取消后可再次点击立即更新。");
    } catch (e) {
      if (mounted.current) { setStatus(""); setError(e instanceof Error ? e.message : "更新失败，请稍后重试。"); }
    } finally {
      if (mounted.current) setDownloading(false);
      lock.leave();
    }
  };
  return <Card>
    <Text style={s.subtitle}>应用更新</Text>
    {version ? <Text style={s.caption}>当前版本 {version}</Text> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={s.caption}>{status}</Text> : null}
    <ErrorNotice message={error} />
    <Button title="检查更新" kind="secondary" busy={checking} disabled={downloading} onPress={() => void check()} />
    {update ? <Button title="立即更新" busy={downloading} disabled={checking} onPress={() => void install()} /> : null}
  </Card>;
}
