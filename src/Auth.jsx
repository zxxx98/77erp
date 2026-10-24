import { Form as AntForm } from 'antd';
import { Select } from './Dropdown.jsx';
import { Spin, Button as AntButton, Input as AntInput } from './ui/controls.jsx';

import { LoadingIndicator } from './Loading.jsx';
import { useEffect, useState } from "react";
import { ArrowRight, Boxes, Eye, EyeOff, LockKeyhole, PackageCheck, ShieldCheck, TriangleAlert, UserRound, Warehouse } from "lucide-react";
import { api } from "./api.js";
import "./auth.css";
import { clearUserDrafts } from './pwa/drafts.js';

export function AuthGate({ children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    setError("");
    try {
      setState(await api("/auth/status"));
    } catch (e) {
      setError(navigator.onLine === false ? '当前离线，请联网后登录。' : e.message);
    }
  };
  useEffect(() => {
    refresh();
    const unauthorized = () => {
      setState({ initialized: true, authenticated: false });
      setNotice("登录已失效，请重新登录。");
    };
    window.addEventListener("erp:unauthorized", unauthorized);
    window.addEventListener('online', refresh);
    return () => { window.removeEventListener("erp:unauthorized", unauthorized); window.removeEventListener('online', refresh); };
  }, []);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.dispatchEvent(new Event('erp:logout'));
    let cleanupNotice = '';
    try { await clearUserDrafts(state.id); }
    catch { cleanupNotice = '已退出登录，本地草稿清理失败，请检查浏览器存储设置。'; }
    setState({ initialized: true, authenticated: false });
    setNotice(cleanupNotice);
  };
  if (!state) {
    return (
      <main className="auth-loading" aria-live="polite">
        {error ? (
          <><p role="alert">{error}</p><AntButton type="primary" htmlType="button" className="btn btn-primary" onClick={refresh}>重新连接</AntButton></>
        ) : (
          <><LoadingIndicator size={64} /><p>正在连接工作空间…</p></>
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
      setError(e.message);
      if (e.status === 409) await onConflict();
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="77 ERP">
        <div className="brand auth-brand">
          <span className="brand-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 12h11l-7 17m10-17h10l-7 17" /></svg></span>
          <div><strong>77 <span>ERP</span></strong><small>轻量进销存</small></div>
        </div>
        <div className="auth-intro-content">
          <span className="auth-eyebrow">工作空间</span>
          <h2>物料、库存与单据<br />集中管理</h2>
          <p>记录每一次入库与出库，掌握当前库存。</p>
          <div className="auth-workflow" aria-hidden="true">
            <div className="auth-workflow-heading"><Warehouse size={20} /><span>库存工作空间</span><span className="auth-workflow-dot" /></div>
            <div className="auth-workflow-steps">
              <span><PackageCheck size={25} /><small>采购入库</small></span>
              <ArrowRight size={18} />
              <span className="auth-workflow-stock"><Boxes size={30} /><small>库存管理</small></span>
              <ArrowRight size={18} />
              <span><PackageCheck size={25} /><small>销售出库</small></span>
            </div>
            <div className="auth-workflow-footer"><ShieldCheck size={15} />账号登录后访问</div>
          </div>
        </div>
        <span className="auth-intro-footer">77 ERP · 轻量进销存系统</span>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="auth-form-icon">{setup ? <ShieldCheck size={24} /> : <LockKeyhole size={24} />}</span>
          <div className="auth-form-heading">
            <span className="auth-eyebrow">{setup ? "首次初始化" : "账号登录"}</span>
            <h1>{setup ? "设置管理员" : "账号登录"}</h1>
            <p>{setup ? "首次使用，请创建管理员账号。" : "使用管理员分配的账号登录。"}</p>
          </div>
          <AntForm noValidate layout="vertical" className="auth-form" onFinish={submit} disabled={busy}
            initialValues={{ baseCurrency: 'USD' }} scrollToFirstError={{ focus: true }}>
            <AntForm.Item name="username" label={setup ? '管理员账号' : '账号'} rules={[
              { required: true, message: '请输入账号' },
              ...(setup ? [{ pattern: /^[A-Za-z0-9_.\-]{3,32}$/, message: '账号须为 3–32 位字母、数字或 ._-' }] : []),
            ]}>
              <AntInput prefix={<UserRound size={17} />} autoComplete="username" autoCapitalize="none" spellCheck={false}
                maxLength={32} placeholder={setup ? '设置管理员账号' : '请输入账号'} />
            </AntForm.Item>
            {setup && <AntForm.Item name="name" label="管理员名称（选填）"><AntInput prefix={<UserRound size={17} />} maxLength={60} /></AntForm.Item>}
            {setup && <AntForm.Item name="baseCurrency" label="基准币种" extra="初始化后不可修改，业务数据将以该币种为准。">
              <Select><option value="USD">美元（USD）</option><option value="CNY">人民币（CNY）</option></Select>
            </AntForm.Item>}
            <AntForm.Item name="password" label={setup ? '设置密码' : '密码'} rules={[
              { required: true, message: '请输入密码' }, ...(setup ? [{ min: 8, message: '密码至少需要 8 个字符' }] : []),
            ]}>
              <AntInput.Password prefix={<LockKeyhole size={17} />} autoComplete={setup ? 'new-password' : 'current-password'}
                maxLength={128} placeholder={setup ? '设置 8–128 位密码' : '请输入密码'}
                iconRender={visible => visible ? <EyeOff size={17} aria-label="隐藏密码" /> : <Eye size={17} aria-label="显示密码" />} />
            </AntForm.Item>
            {setup && <AntForm.Item name="confirmation" label="确认密码" dependencies={['password']} rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue('password')
                ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致。')) }),
            ]}><AntInput.Password prefix={<LockKeyhole size={17} />} autoComplete="new-password" maxLength={128} placeholder="再次输入密码" /></AntForm.Item>}
            {(error || notice) && <div className="form-error auth-error" role="alert"><TriangleAlert size={16} /><span>{error || notice}</span></div>}
            <AntButton type="primary" className="auth-submit" htmlType="submit" loading={busy && { icon: <span aria-hidden="true"><Spin size="small" /></span> }} block>
              {setup ? '创建管理员并进入' : '登录'}<ArrowRight size={17} />
            </AntButton>
          </AntForm>
          <p className="auth-form-note"><ShieldCheck size={15} />{setup ? "管理员可以在设置中添加员工账号。" : "登录后访问此工作空间。"}</p>
        </div>
        <span className="auth-form-footer">物料管理 · 扫码入出库 · 库存管理</span>
      </section>
    </main>
  );
}
