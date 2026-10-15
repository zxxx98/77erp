import { LoadingIndicator } from '../Loading.jsx';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';
import './pwa.css';

const Context = createContext(null);
export const usePwa = () => useContext(Context);
const appModes = ['standalone', 'fullscreen', 'minimal-ui'];
const inAppWindow = () => appModes.some(mode => matchMedia(`(display-mode: ${mode})`).matches) || navigator.standalone === true;

export function PwaProvider({ children }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [installationReported, setInstallationReported] = useState(false);
  const [standalone, setStandalone] = useState(inAppWindow);
  const [message, setMessage] = useState('');
  const [registrationError, setRegistrationError] = useState('');
  const [checking, setChecking] = useState(false);
  const registration = useRef(null);
  const installBusy = useRef(false);
  const installed = useRef(false);
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, value) => { registration.current = value; },
    onRegisterError: () => setRegistrationError('应用离线准备失败，联网时仍可正常使用。'),
  });
  useEffect(() => {
    const status = () => setOnline(navigator.onLine);
    const beforeInstall = event => {
      event.preventDefault();
      installed.current = false;
      setInstallationReported(false);
      setInstallPrompt(event);
    };
    // This browser event cannot verify a launcher icon or completion of Android's WebAPK install.
    const onInstalled = () => {
      installed.current = true;
      setInstallationReported(true);
      setInstallPrompt(null);
      setMessage('浏览器已报告应用安装完成。请在应用列表或系统“应用管理”中查找 77 ERP；网页无法确认桌面图标是否已生成。');
    };
    const displayQueries = appModes.map(mode => matchMedia(`(display-mode: ${mode})`));
    const displayChanged = () => setStandalone(inAppWindow());
    displayQueries.forEach(query => query.addEventListener('change', displayChanged));
    window.addEventListener('online', status);
    window.addEventListener('offline', status);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    const update = () => { if (navigator.onLine && document.visibilityState === 'visible') registration.current?.update().catch(() => {}); };
    const interval = setInterval(update, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('online', status);
      window.removeEventListener('offline', status);
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      displayQueries.forEach(query => query.removeEventListener('change', displayChanged));
      document.removeEventListener('visibilitychange', update);
      clearInterval(interval);
    };
  }, []);
  const install = async () => {
    if (standalone) { setMessage('当前已在桌面应用中打开。'); return; }
    if (installBusy.current) return;
    if (installPrompt) {
      installBusy.current = true;
      setInstalling(true);
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (!installed.current) setMessage(choice.outcome === 'accepted'
          ? '已确认安装，浏览器和系统正在处理。请稍后在应用列表查找 77 ERP；当前尚未确认安装完成。'
          : '已取消安装。');
      }
      catch { setMessage('无法调起安装，请使用浏览器菜单中的“安装应用”；“创建快捷方式”会在浏览器中打开。'); }
      finally { setInstallPrompt(null); setInstalling(false); installBusy.current = false; }
      return;
    }
    if (installed.current) {
      setMessage('请先在应用列表或系统“应用管理”中查找 77 ERP，再从应用图标打开。若两处都没有，请在浏览器菜单重新检查安装状态；“创建快捷方式”会保留浏览器地址栏。');
      return;
    }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    setMessage(!window.isSecureContext ? '安装应用需要 HTTPS，请使用安全地址访问。' : ios ? '请使用 Safari 的分享菜单，选择“添加到主屏幕”，再从主屏幕图标打开。' : '请在浏览器菜单中选择 Install（安装）或“安装应用”，完成后从应用图标打开。Create shortcut（创建快捷方式）会保留浏览器地址栏。');
  };
  const checkUpdate = async () => {
    if (!navigator.onLine) { setMessage('当前离线，请联网后检查更新。'); return; }
    if (!registration.current) { setMessage('应用尚未完成离线准备，请稍后重试。'); return; }
    setChecking(true);
    try {
      await registration.current.update();
      if (registration.current.waiting) setNeedRefresh(true);
      setMessage(registration.current.waiting ? '新版本已就绪。' : registration.current.installing ? '正在下载新版本，完成后会提示更新。' : '已检查更新。');
    } catch { setMessage('无法检查更新，请检查网络后重试。'); }
    finally { setChecking(false); }
  };
  const update = async () => {
    if (document.querySelector('[role="dialog"]')) { setMessage('请先保存并关闭当前编辑页面，再更新应用。'); return; }
    try { await updateServiceWorker(true); }
    catch { setMessage('更新失败，请检查网络后重试。'); }
  };
  return <Context.Provider value={{ online, offlineReady, registrationError, needRefresh, checking, standalone, installing, installationReported, install, checkUpdate, update }}>
    {children}
    {(needRefresh || message) && <aside className="pwa-notice" aria-label="应用状态" role="status">
      <span>{message || '新版本已就绪。'}</span>
      {needRefresh && <button type="button" onClick={update}><RefreshCw size={17} />更新应用</button>}
      <button type="button" className="pwa-notice-close" aria-label="关闭应用提示" onClick={() => { setMessage(''); setNeedRefresh(false); }}><X size={19} /></button>
    </aside>}
  </Context.Provider>;
}

export function PwaActions() {
  const { install, checkUpdate, update, needRefresh, online, offlineReady, registrationError, checking, standalone, installing, installationReported } = usePwa();
  return <section className="mw-card mw-stack">
    <h2>网页版应用</h2>
    <p className="mw-muted">{!online ? '当前离线，联网后确认业务操作。' : registrationError || (offlineReady ? '应用已准备好离线打开。' : '首次使用需要联网。')}</p>
    {!standalone && <button type="button" className="mw-button" onClick={install} disabled={installing} aria-busy={installing}>{installing ? <LoadingIndicator size={20} /> : <Download size={19} />}{installing ? '正在请求安装…' : installationReported ? '查看安装说明' : '安装应用'}</button>}
    <button type="button" className="mw-button" disabled={checking || !online} aria-busy={checking} onClick={needRefresh ? update : checkUpdate}>{checking ? <LoadingIndicator size={20} /> : <RefreshCw size={19} />}{checking ? '正在检查…' : needRefresh ? '更新应用' : '检查更新'}</button>
  </section>;
}

export function OfflineNotice() {
  const { online } = usePwa();
  return !online ? <div className="mw-offline" role="status"><WifiOff size={17} />当前离线 · 可编辑草稿，联网后确认</div> : null;
}
