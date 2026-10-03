import { useEffect, useState } from "react";
import { ArrowRight, Boxes, Eye, EyeOff, LoaderCircle, LockKeyhole, PackageCheck, ShieldCheck, TriangleAlert, UserRound, Warehouse } from "lucide-react";
import { api } from "./api.js";
import "./auth.css";

export function AuthGate({ children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    setError("");
    try {
      setState(await api("/auth/status"));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    refresh();
    const unauthorized = () => {
      setState({ initialized: true, authenticated: false });
      setNotice("登录已失效，请重新登录。");
    };
    window.addEventListener("erp:unauthorized", unauthorized);
    return () => window.removeEventListener("erp:unauthorized", unauthorized);
  }, []);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setState({ initialized: true, authenticated: false });
    setNotice("");
  };
  if (!state) {
    return (
      <main className="auth-loading" aria-live="polite">
        {error ? (
          <><p role="alert">{error}</p><button className="btn btn-primary" onClick={refresh}>重新连接</button></>
        ) : (
          <><LoaderCircle className="spin" size={24} /><p>正在连接工作空间…</p></>
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (setup && password !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const state = await api(setup ? "/auth/setup" : "/auth/login", {
        method: "POST", body: { username: username.trim(), password },
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
          <h2>商品、库存与单据<br />集中管理</h2>
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
            <div className="auth-workflow-footer"><ShieldCheck size={15} />管理员登录后访问</div>
          </div>
        </div>
        <span className="auth-intro-footer">77 ERP · 轻量进销存系统</span>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <span className="auth-form-icon">{setup ? <ShieldCheck size={24} /> : <LockKeyhole size={24} />}</span>
          <div className="auth-form-heading">
            <span className="auth-eyebrow">{setup ? "首次初始化" : "账号登录"}</span>
            <h1>{setup ? "设置管理员" : "管理员登录"}</h1>
            <p>{setup ? "首次使用，请创建管理员账号。" : "使用初始化时设置的管理员账号登录。"}</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="auth-username">管理员账号</label>
            <div className="auth-input">
              <UserRound size={17} />
              <input id="auth-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={setup ? 3 : undefined} maxLength={32} pattern={setup ? "[A-Za-z0-9_.\\-]{3,32}" : undefined} placeholder={setup ? "设置管理员账号" : "请输入管理员账号"} value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
            </div>
            {setup && <p className="auth-field-hint">3–32 位字母、数字或 ._-</p>}
            <label htmlFor="auth-password">{setup ? "设置密码" : "密码"}</label>
            <div className="auth-input">
              <LockKeyhole size={17} />
              <input id="auth-password" name="password" type={visible ? "text" : "password"} autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 8 : undefined} maxLength={128} placeholder={setup ? "设置 8–128 位密码" : "请输入密码"} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              <button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(!visible)} disabled={busy}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
            {setup && <>
              <label htmlFor="auth-confirmation">确认密码</label>
              <div className="auth-input"><LockKeyhole size={17} /><input id="auth-confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="再次输入密码" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} /></div>
            </>}
            {(error || notice) && <div className="form-error auth-error" role="alert"><TriangleAlert size={16} /><span>{error || notice}</span></div>}
            <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
              {busy ? <><LoaderCircle size={17} className="spin" />{setup ? "正在创建…" : "正在登录…"}</> : <>{setup ? "创建管理员并进入" : "登录"}<ArrowRight size={17} /></>}
            </button>
          </form>
          <p className="auth-form-note"><ShieldCheck size={15} />{setup ? "当前系统仅使用一个管理员账号，请妥善保存密码。" : "仅管理员可访问此工作空间。"}</p>
        </div>
        <span className="auth-form-footer">商品管理 · 扫码入出库 · 库存管理</span>
      </section>
    </main>
  );
}
