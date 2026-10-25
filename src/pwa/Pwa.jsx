import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton } from '../ui/controls.jsx';

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
  useLocale();
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
    onRegisterError: () => setRegistrationError(translate("system.the.application.failed.to.prepare.offline.but.can.still.be.used")),
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
      setMessage(translate("system.the.browser.has.reported.that.the.app.installation.is.complete.please"));
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
    if (standalone) { setMessage(translate("system.currently.open.in.the.desktop.app")); return; }
    if (installBusy.current) return;
    if (installPrompt) {
      installBusy.current = true;
      setInstalling(true);
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (!installed.current) setMessage(choice.outcome === 'accepted'
          ? translate("system.installation.confirmed.browser.and.system.processing.please.look.for.77.erp")
          : translate("system.installation.canceled"));
      }
      catch { setMessage(translate("system.unable.to.launch.the.installation.please.use.install.app.in.the")); }
      finally { setInstallPrompt(null); setInstalling(false); installBusy.current = false; }
      return;
    }
    if (installed.current) {
      setMessage(translate("system.please.first.search.for.77.erp.in.the.application.list.or"));
      return;
    }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    setMessage(!window.isSecureContext ? translate("system.installing.the.app.requires.https.please.use.a.secure.address.to") : ios ? translate("system.please.use.safari.s.share.menu.select.add.to.home.screen") : translate("system.please.select.install.or.install.app.from.the.browser.menu.and"));
  };
  const checkUpdate = async () => {
    if (!navigator.onLine) { setMessage(translate("system.currently.offline.please.connect.to.the.internet.to.check.for.updates")); return; }
    if (!registration.current) { setMessage(translate("system.the.app.is.not.ready.for.offline.yet.please.try.again")); return; }
    setChecking(true);
    try {
      await registration.current.update();
      if (registration.current.waiting) setNeedRefresh(true);
      setMessage(registration.current.waiting ? translate("system.new.version.is.ready") : registration.current.installing ? translate("system.the.new.version.is.being.downloaded.and.you.will.be.prompted") : translate("system.checked.for.updates"));
    } catch { setMessage(translate("system.unable.to.check.for.updates.please.check.the.network.and.try")); }
    finally { setChecking(false); }
  };
  const update = async () => {
    if (document.querySelector('[role="dialog"]')) { setMessage(translate("system.please.save.and.close.the.current.editing.page.before.updating.the")); return; }
    try { await updateServiceWorker(true); }
    catch { setMessage(translate("system.update.failed.please.check.the.network.and.try.again")); }
  };
  return <Context.Provider value={{ online, offlineReady, registrationError, needRefresh, checking, standalone, installing, installationReported, install, checkUpdate, update }}>
    {children}
    {(needRefresh || message) && <aside className="pwa-notice" aria-label={translate("system.application.status")} role="status">
      <span>{message || translate("system.new.version.is.ready")}</span>
      {needRefresh && <AntButton type="default" htmlType="button" onClick={update}><RefreshCw size={17} />{translate("system.update.app")}</AntButton>}
      <AntButton type="text" htmlType="button" className="pwa-notice-close" aria-label={translate("system.close.app.prompt")} onClick={() => { setMessage(''); setNeedRefresh(false); }}><X size={19} /></AntButton>
    </aside>}
  </Context.Provider>;
}

export function PwaActions() {
  useLocale();
  const { install, checkUpdate, update, needRefresh, online, offlineReady, registrationError, checking, standalone, installing, installationReported } = usePwa();
  return <section className="mw-card mw-stack">
    <h2>{translate("system.web.version.application")}</h2>
    <p className="mw-muted">{!online ? translate("system.currently.offline.confirm.business.operations.after.connecting.to.the.internet") : registrationError || (offlineReady ? translate("system.the.app.is.ready.to.open.offline") : translate("system.an.internet.connection.is.required.for.first.time.use"))}</p>
    {!standalone && <AntButton type="default" htmlType="button" className="mw-button" onClick={install} disabled={installing} aria-busy={installing}>{installing ? <LoadingIndicator size={20} /> : <Download size={19} />}{installing ? translate("system.requesting.installation") : installationReported ? translate("system.view.installation.instructions") : translate("system.install.app")}</AntButton>}
    <AntButton type="default" htmlType="button" className="mw-button" disabled={checking || !online} aria-busy={checking} onClick={needRefresh ? update : checkUpdate}>{checking ? <LoadingIndicator size={20} /> : <RefreshCw size={19} />}{checking ? translate("system.checking") : needRefresh ? translate("system.update.app") : translate("system.check.for.updates")}</AntButton>
  </section>;
}

export function OfflineNotice() {
  useLocale();
  const { online } = usePwa();
  return !online ? <div className="mw-offline" role="status"><WifiOff size={17} />{translate("system.currently.offline.editable.draft.confirm.after.connecting.to.the.internet")}</div> : null;
}
