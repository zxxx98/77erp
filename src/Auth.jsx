import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Form as AntForm } from 'antd';
import { Select } from './Dropdown.jsx';
import { Spin, Button as AntButton, Input as AntInput } from './ui/controls.jsx';

import { LoadingIndicator } from './Loading.jsx';
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, TriangleAlert, UserRound } from "lucide-react";
import { api } from "./api.js";
import "./auth.css";
import { clearUserDrafts } from './pwa/drafts.js';
import { LanguageSwitcher } from './i18n/LanguageSwitcher.jsx';
import { setLanguageUser } from './i18n/index.js';

export function AuthGate({ children }) {
  useLocale();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setLanguageUser(state); }, [state?.authenticated, state?.id, state?.language]);
  const refresh = async () => {
    setError("");
    try {
      setState(await api("/auth/status"));
    } catch (e) {
      setError(navigator.onLine === false ? translate("system.currently.offline.please.log.in.after.connecting.to.the.internet") : e.message);
    }
  };
  useEffect(() => {
    refresh();
    const unauthorized = () => {
      setState({ initialized: true, authenticated: false });
      setNotice(translate("system.login.has.expired.please.log.in.again"));
    };
    window.addEventListener("erp:unauthorized", unauthorized);
    window.addEventListener('online', refresh);
    window.addEventListener('erp:permissions-changed', refresh);
    return () => { window.removeEventListener("erp:unauthorized", unauthorized); window.removeEventListener('online', refresh); window.removeEventListener('erp:permissions-changed', refresh); };
  }, []);
  useEffect(() => {
    if (!state?.authenticated) return;
    const controller = new AbortController();
    let checking = false;
    const inspect = async () => {
      if (checking || !navigator.onLine || document.visibilityState !== 'visible') return;
      checking = true;
      try { const next = await api('/auth/status', { signal: controller.signal }); if (!controller.signal.aborted) setState(previous => previous?.permissions_version !== next.permissions_version || previous?.id !== next.id || previous?.access_mode !== next.access_mode || previous?.language !== next.language ? next : previous); }
      catch {} finally { checking = false; }
    };
    const timer = setInterval(inspect, 15000);
    window.addEventListener('focus', inspect); window.addEventListener('online', inspect);
    document.addEventListener('visibilitychange', inspect);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', inspect); window.removeEventListener('online', inspect); document.removeEventListener('visibilitychange', inspect); };
  }, [state?.authenticated]);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.dispatchEvent(new Event('erp:logout'));
    let cleanupNotice = '';
    try { await clearUserDrafts(state.id); }
    catch { cleanupNotice = translate("system.logged.out.local.draft.cleanup.failed.please.check.browser.storage.settings"); }
    setState({ initialized: true, authenticated: false });
    setNotice(cleanupNotice);
  };
  if (!state) {
    return (
      <main className="auth-loading" aria-live="polite">
        <div className="auth-language"><LanguageSwitcher /></div>
        {error ? (
          <><p role="alert">{error}</p><AntButton type="primary" htmlType="button" className="btn btn-primary" onClick={refresh}>{translate("system.reconnect")}</AntButton></>
        ) : (
          <><LoadingIndicator size={64} /><p>{translate("system.connecting.to.workspace")}</p></>
        )}
      </main>
    );
  }
  if (state.authenticated) return children(state, logout);
  return (
    <AuthPage
      key={String(state.initialized)}
      setup={!state.initialized}
      notice={notice || error}
      onSuccess={(next) => { setNotice(""); setState(next); }}
      onConflict={refresh}
    />
  );
}

function AuthPage({ setup, notice, onSuccess, onConflict }) {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async ({ username, name, password, baseCurrency }) => {

    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const state = await api(setup ? "/auth/setup" : "/auth/login", {
        method: "POST", body: { username: username.trim(), password, ...(setup ? { name, base_currency: baseCurrency } : {}) },
      });
      onSuccess(state);
    } catch (e) {
      setError(localizeError(e.message));
      if (e.status === 409) await onConflict();
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-card" aria-label="77 ERP">
        <div className="auth-brand-row">
          <span className="brand-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 12h11l-7 17m10-17h10l-7 17" /></svg></span>
          <div className="auth-brand-copy">
            <strong>77 <span>ERP</span></strong>
            <small>{translate("system.inventory.management")}</small>
          </div>
        </div>
        <div className="auth-form-heading">
          <h1>{setup ? translate("system.set.up.administrator") : translate("system.sign.in")}</h1>
          <p>{setup ? translate("system.for.first.time.use.please.create.an.administrator.account") : translate("system.log.in.using.the.account.assigned.by.the.administrator")}</p>
        </div>
        <AntForm noValidate layout="vertical" className="auth-form" onFinish={submit} disabled={busy}
          initialValues={{ baseCurrency: 'USD' }} scrollToFirstError={{ focus: true }}>
          <AntForm.Item name="username" label={setup ? translate("system.administrator.account") : translate("system.account")} rules={[
            { required: true, message: translate("system.please.enter.account.number") },
            ...(setup ? [{ pattern: /^[A-Za-z0-9_.\-]{3,32}$/, message: translate("system.account.number.must.be.3.32.letters.numbers.or") }] : []),
          ]}>
            <AntInput prefix={<UserRound size={15} />} autoComplete="username" autoCapitalize="none" spellCheck={false}
              maxLength={32} placeholder={setup ? translate("system.set.up.an.administrator.account") : translate("system.please.enter.account.number")} />
          </AntForm.Item>
          {setup && <AntForm.Item name="name" label={translate("system.administrator.name.optional")}><AntInput prefix={<UserRound size={15} />} maxLength={60} /></AntForm.Item>}
          {setup && <AntForm.Item name="baseCurrency" label={translate("system.base.currency")} extra={translate("system.it.cannot.be.modified.after.initialization.and.business.data.will.be")}>
            <Select><option value="USD">{translate("system.us.dollar.usd")}</option><option value="CNY">{translate("system.chinese.yuan.cny")}</option></Select>
          </AntForm.Item>}
          <AntForm.Item name="password" label={setup ? translate("system.set.password") : translate("system.password")} rules={[
            { required: true, message: translate("system.please.enter.password") }, ...(setup ? [{ min: 8, message: translate("system.password.requires.at.least.8.characters") }] : []),
          ]}>
            <AntInput.Password prefix={<LockKeyhole size={15} />} autoComplete={setup ? 'new-password' : 'current-password'}
              maxLength={128} placeholder={setup ? translate("system.set.an.8.128.bit.password") : translate("system.please.enter.password")}
              iconRender={visible => visible ? <EyeOff size={15} aria-label={translate("system.hide.password")} /> : <Eye size={15} aria-label={translate("system.show.password")} />} />
          </AntForm.Item>
          {setup && <AntForm.Item name="confirmation" label={translate("system.confirm.password")} dependencies={['password']} rules={[
            { required: true, message: translate("system.please.enter.password.again") },
            ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('password')
              ? Promise.resolve() : Promise.reject(new Error(translate("system.the.passwords.entered.twice.are.inconsistent"))) }),
          ]}><AntInput.Password prefix={<LockKeyhole size={15} />} autoComplete="new-password" maxLength={128} placeholder={translate("system.enter.password.again")} /></AntForm.Item>}
          {(error || notice) && <div className="form-error auth-error" role="alert"><TriangleAlert size={15} /><span>{error || notice}</span></div>}
          <AntButton type="primary" className="auth-submit" htmlType="submit" loading={busy && { icon: <span aria-hidden="true"><Spin size="small" /></span> }} block>
            {setup ? translate("system.create.an.administrator.and.enter") : translate("system.sign.in.2")}<ArrowRight size={15} />
          </AntButton>
        </AntForm>
        {setup && <p className="auth-form-note">{translate("system.administrators.can.add.employee.accounts.in.settings")}</p>}
      </section>
      <footer className="auth-page-footer">{translate("system.77.erp.lightweight.purchase.sales.and.inventory.system")}</footer>
    </main>
  );
}
