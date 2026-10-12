import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import './users.css';

export function ChangePassword({ onChanged }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    if (password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      await api('/auth/password', { method: 'POST', body: { current_password: current, password } });
      await onChanged();
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="account-fields" aria-label="修改密码">
    <h3>修改密码</h3>
    <p className="muted">修改后所有设备需要重新登录。</p>
    <label>当前密码<input type="password" autoComplete="current-password" maxLength={128} value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} /></label>
    <label>新密码<input type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
    <label>确认新密码<input type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="btn btn-primary" type="button" disabled={busy} onClick={save}>{busy ? '正在修改…' : '确认修改密码'}</button>
  </section>;
}

export function UserManager() {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('employee');
  const [resetUser, setResetUser] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = async () => setUsers(await api('/users'));
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const run = async (action, message) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(message); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const update = (user, next) => run(() => api(`/users/${user.id}`, {
    method: 'PUT', body: { role: user.role, active: user.active, ...next },
  }), '账号已更新');
  return <section aria-label="用户管理">
    <h3>用户管理</h3>
    <p className="muted">所有用户共享全部仓库。员工可管理商品、开单及自己的草稿；管理操作仅限管理员。</p>
    <div className="account-fields">
      <label>新账号<input autoComplete="off" maxLength={32} value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
      <label>初始密码<input type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <label>新账号角色<select value={role} onChange={e => setRole(e.target.value)} disabled={busy}><option value="employee">员工</option><option value="admin">管理员</option></select></label>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
        await api('/users', { method: 'POST', body: { username, password, role } });
        setUsername(''); setPassword('');
      }, '账号已创建')}>新增账号</button>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="user-list">
      {users.map(user => <div className="user-row" key={user.id}>
        <div><strong>{user.username}</strong><small>{user.active ? '正常' : '已停用'}</small></div>
        <label>角色<select aria-label={`${user.username}的角色`} value={user.role} disabled={busy} onChange={e => {
          const nextRole = e.target.value;
          if (window.confirm(`修改 ${user.username} 的角色？该账号需要重新登录。`)) void update(user, { role: nextRole });
        }}><option value="employee">员工</option><option value="admin">管理员</option></select></label>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => {
          if (window.confirm(`${user.active ? '停用' : '启用'}账号 ${user.username}？`)) void update(user, { active: user.active ? 0 : 1 });
        }}>{user.active ? '停用' : '启用'}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResetUser(user); setResetPassword(''); }}>重置密码</button>
      </div>)}
    </div>
    {resetUser && <div className="account-fields">
      <h4>重置 {resetUser.username} 的密码</h4>
      <label>重置后的密码<input type="password" autoComplete="new-password" maxLength={128} value={resetPassword} onChange={e => setResetPassword(e.target.value)} disabled={busy} /></label>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => {
        if (window.confirm(`重置 ${resetUser.username} 的密码并退出该账号的所有设备？`)) void run(async () => {
          await api(`/users/${resetUser.id}/password`, { method: 'POST', body: { password: resetPassword } });
          setResetUser(null); setResetPassword('');
        }, '密码已重置');
      }}>确认重置密码</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResetUser(null); setResetPassword(''); }}>取消重置</button>
    </div>}
  </section>;
}
