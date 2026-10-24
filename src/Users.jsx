import { Input as AntInput, Button as AntButton, Checkbox as AntCheckbox } from 'antd';

import { LoadingStatus } from './Loading.jsx';
import { Select } from "./Dropdown.jsx";
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import './users.css';
import { permissionOptions } from '../shared/permissions.js';

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
    <label>当前密码<AntInput type="password" autoComplete="current-password" maxLength={128} value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} /></label>
    <label>新密码<AntInput type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
    <label>确认新密码<AntInput type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <AntButton type="primary" className="btn btn-primary" htmlType="button" disabled={busy} onClick={save}>{busy ? <LoadingStatus size={20}>正在修改…</LoadingStatus> : '确认修改密码'}</AntButton>
  </section>;
}

export function UserManager({ Modal, onChanged }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [nameUser, setNameUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('employee');
  const [permissionUser, setPermissionUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
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
    try { await action(); await load(); await onChanged?.(); setNotice(message); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const update = (user, next) => run(() => api(`/users/${user.id}`, {
    method: 'PUT', body: { role: user.role, active: user.active, ...next },
  }), '账号已更新');
  return <section aria-label="用户管理">
    <h3>用户管理</h3>
    {busy && <p><LoadingStatus>正在更新账号…</LoadingStatus></p>}
    <p className="muted">所有用户共享全部仓库。新员工默认只读，由管理员配置业务权限；管理员拥有全部权限。</p>
    <div className="account-fields">
      <label>新账号<AntInput autoComplete="off" maxLength={32} value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
      <label>账号名称<AntInput maxLength={60} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="例如：张三" /></label>
      <label>初始密码<AntInput type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <label>新账号角色<Select aria-label="新账号角色" value={role} onChange={e => setRole(e)} disabled={busy}><option value="employee">员工</option><option value="admin">管理员</option></Select></label>
      <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
        await api('/users', { method: 'POST', body: { username, password, role, name } });
        setUsername(''); setPassword(''); setName('');
      }, '账号已创建')}>新增账号</AntButton>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="table-scroll user-list">
      <table className="data-table user-table">
        <thead><tr><th>账号</th><th>状态</th><th>角色</th><th>操作</th></tr></thead>
        <tbody>
          {users.map(user => <tr className="user-row" key={user.id}>
            <td><strong>{user.name}</strong><small className="user-login">账号：{user.username}</small><AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => { setNameUser(user); setEditName(user.name); }}>修改名称</AntButton></td>
            <td>{user.active ? '正常' : '已停用'}</td>
            <td><Select aria-label={`${user.username}的角色`} value={user.role} disabled={busy} onChange={e => {
              const nextRole = e;
              if (window.confirm(`修改 ${user.username} 的角色？该账号需要重新登录。`)) void update(user, { role: nextRole });
            }}><option value="employee">员工</option><option value="admin">管理员</option></Select></td>
            <td><div className="user-actions">
              <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => {
                if (window.confirm(`${user.active ? '停用' : '启用'}账号 ${user.username}？`)) void update(user, { active: user.active ? 0 : 1 });
              }}>{user.active ? '停用' : '启用'}</AntButton>
              {user.role === 'employee' ? <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPermissionUser(user); setPermissions([...user.permissions]); setError(''); }}>权限配置</AntButton> : <span className="muted">全部权限</span>}
              <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResetUser(user); setResetPassword(''); }}>重置密码</AntButton>
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {nameUser && <Modal title={`修改 ${nameUser.username} 的名称`} onClose={() => { if (!busy) { setNameUser(null); setError(''); } }}>
      <div className="form-body account-fields"><label>名称<AntInput maxLength={60} value={editName} disabled={busy} onChange={e => setEditName(e.target.value)} /></label>
        <p className="muted">留空时显示登录账号。名称用于新单据的开单人，历史记录保留原名称。</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
          await api(`/users/${nameUser.id}`, { method: 'PUT', body: { role: nameUser.role, active: nameUser.active, name: editName } });
          setNameUser(null);
        }, '名称已更新')}>保存名称</AntButton>
      </div>
    </Modal>}
    {permissionUser && <Modal title={`${permissionUser.username} 的权限配置`} className="permission-dialog" onClose={() => { if (!busy) { setPermissionUser(null); setError(''); } }}>
      <div className="form-body">
        <p className="muted">物料、库存、历史单据及扫码查询默认可查看，修改自己的密码始终开放。</p>
        {permissionUser.legacy_permissions && <p className="info-box">此账号目前沿用原员工权限。保存后按下面的模块授权，勾选模块包含该模块的全部操作。</p>}
        <div className="permission-options">{permissionOptions.map(option => <AntCheckbox key={option.key} checked={permissions.includes(option.key)} disabled={busy} onChange={e => setPermissions(current => e.target.checked ? [...current, option.key] : current.filter(key => key !== option.key))}>

          <span><strong>{option.label}</strong><small>{option.description}</small></span>
        </AntCheckbox>)}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="permission-dialog-actions">
          <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPermissionUser(null); setError(''); }}>取消配置</AntButton>
          <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
            await api(`/users/${permissionUser.id}/permissions`, { method: 'PUT', body: { permissions, version: permissionUser.permissions_version } });
            setPermissionUser(null);
          }, '权限配置已保存，立即生效')}>保存权限</AntButton>
        </div>
      </div>
    </Modal>}
    {resetUser && <div className="account-fields">
      <h4>重置 {resetUser.username} 的密码</h4>
      <label>重置后的密码<AntInput type="password" autoComplete="new-password" maxLength={128} value={resetPassword} onChange={e => setResetPassword(e.target.value)} disabled={busy} /></label>
      <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => {
        if (window.confirm(`重置 ${resetUser.username} 的密码并退出该账号的所有设备？`)) void run(async () => {
          await api(`/users/${resetUser.id}/password`, { method: 'POST', body: { password: resetPassword } });
          setResetUser(null); setResetPassword('');
        }, '密码已重置');
      }}>确认重置密码</AntButton>
      <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResetUser(null); setResetPassword(''); }}>取消重置</AntButton>
    </div>}
  </section>;
}
