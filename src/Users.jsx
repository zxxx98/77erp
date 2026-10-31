import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Input as AntInput, Button as AntButton, Checkbox } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import { Select } from "./Dropdown.jsx";
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import './users.css';
import { EffectivePermissions } from './Positions.jsx';
import { combinePositionAuthorization } from '../shared/permissions.js';

function PositionPicker({ label, positions, value, onChange, disabled }) {
  return <fieldset className="user-position-picker" disabled={disabled} aria-label={label}>
    <legend>{label}</legend>
    <div>{positions.map(position => <Checkbox key={position.id} checked={value.includes(position.id)} disabled={disabled}
      onChange={event => onChange(event.target.checked ? [...value,position.id] : value.filter(id => id !== position.id))}>{position.name}</Checkbox>)}</div>
  </fieldset>;
}

export function ChangePassword({ onChanged }) {
  useLocale();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    if (password !== confirmation) { setError(translate("system.the.passwords.entered.twice.are.inconsistent")); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      await api('/auth/password', { method: 'POST', body: { current_password: current, password } });
      await onChanged();
    } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="account-fields" aria-label={translate("system.change.password")}>
    <h3>{translate("system.change.password")}</h3>
    <p className="muted">{translate("system.all.devices.need.to.log.in.again.after.modification")}</p>
    <label>{translate("system.current.password")}<AntInput type="password" autoComplete="current-password" maxLength={128} value={current} onChange={e => setCurrent(e.target.value)} disabled={busy} /></label>
    <label>{translate("system.new.password")}<AntInput type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
    <label>{translate("system.confirm.new.password")}<AntInput type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <AntButton type="primary" className="btn btn-primary" htmlType="button" disabled={busy} onClick={save}>{busy ? <LoadingStatus size={20}>{translate("system.modifying")}</LoadingStatus> : translate("system.confirm.password.change")}</AntButton>
  </section>;
}

export function UserManager({ Modal, onChanged }) {
  useLocale();
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [nameUser, setNameUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('employee');
  const [permissionUser, setPermissionUser] = useState(null);
  const [positions, setPositions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [positionIds, setPositionIds] = useState([]);
  const [positionUser, setPositionUser] = useState(null);
  const [nextPositions, setNextPositions] = useState([]);
  const preview = combinePositionAuthorization(positions.filter(position => nextPositions.includes(position.id)));
  const [conflict, setConflict] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = async () => {
    const [accounts, jobs, teams] = await Promise.all([api('/users'), api('/positions'), api('/production-groups')]);
    setGroups(teams);
    setUsers(accounts); setPositions(jobs); return accounts;
  };
  useEffect(() => { load().catch(e => setError(localizeError(e.message))); }, []);
  const run = async (action, message) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setConflict(false);
    try { await action(); await load(); await onChanged?.(); setNotice(message); }
    catch (e) { setError(localizeError(e.message)); setConflict(e.status === 409); }
    finally { lock.current = false; setBusy(false); }
  };
  const update = (user, next) => run(() => api(`/users/${user.id}`, {
    method: 'PUT', body: { role: user.role, active: user.active, ...next },
  }), translate("system.account.has.been.updated"));
  return <section aria-label={translate("system.user.management")}>
    <h3>{translate("system.user.management")}</h3>
    {busy && <p><LoadingStatus>{translate("system.updating.account")}</LoadingStatus></p>}
    <p className="muted">{translate("system.all.repositories.are.shared.by.all.users.employees.obtain.business.permissions")}</p>
    <div className="account-fields">
      <label>{translate("system.new.account")}<AntInput autoComplete="off" maxLength={32} value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></label>
      <label>{translate("system.account.name")}<AntInput maxLength={60} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder={translate("system.for.example.zhang.san")} /></label>
      <label>{translate("system.initial.password")}<AntInput type="password" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <label>{translate("system.new.account.role")}<Select aria-label={translate("system.new.account.role")} value={role} onChange={e => setRole(e)} disabled={busy}><option value="employee">{translate("system.employee")}</option><option value="admin">{translate("system.administrator")}</option></Select></label>
      {role === 'employee' && <PositionPicker label={translate("system.new.account.position")} positions={positions} value={positionIds} disabled={busy} onChange={setPositionIds} />}
      {role === 'employee' && <label>{translate("system.new.account.production.team")}<Select aria-label={translate("system.new.account.production.team")} value={groupId} disabled={busy} onChange={setGroupId}><option value="">{translate("system.not.grouped")}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>}
      {role === 'employee' && !positions.length && <p className="muted">{translate("system.please.go.to.the.post.configuration.to.add.a.new.position")}</p>}
      <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => {
        if (role === 'employee' && !positionIds.length) { setError(translate("system.please.select.the.new.employee.s.position")); return; }
        void run(async () => {
        await api('/users', { method: 'POST', body: { username, password, role, name, ...(role === 'employee' ? { position_ids: positionIds, production_group_id: groupId ? Number(groupId) : null } : {}) } });
        setUsername(''); setPassword(''); setName('');
      }, translate("system.account.has.been.created")); }}>{translate("system.add.account")}</AntButton>
    </div>
    {error && !nameUser && !positionUser && !resetUser && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="table-scroll user-list">
      <table className="data-table user-table">
        <thead><tr><th>{translate("system.account")}</th><th>{translate("system.status")}</th><th>{translate("system.roles.positions.and.production.teams")}</th><th>{translate("system.operation")}</th></tr></thead>
        <tbody>
          {users.map(user => <tr className="user-row" key={user.id}>
            <td><strong>{user.name}</strong><small className="user-login">{translate("system.account.2")}{user.username}</small><AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => { setNameUser(user); setEditName(user.name); }}>{translate("system.modify.name")}</AntButton></td>
            <td>{user.active ? translate("system.normal") : translate("system.deactivated")}</td>
            <td><Select aria-label={translate("system.s.role", { v0: user.username })} value={user.role} disabled={busy} onChange={e => {
              const nextRole = e;
              if (nextRole === 'employee') { setPositionUser({ ...user, downgrade: true }); setNextPositions([]); setError(''); setConflict(false); }
              else if (window.confirm(translate("system.modify.s.role.this.account.needs.to.be.logged.in.again", { v0: user.username }))) void update(user, { role: nextRole });
            }}><option value="employee">{translate("system.employee")}</option><option value="admin">{translate("system.administrator")}</option></Select>{user.role === 'employee' && <AntButton className="btn user-position-button" aria-label={translate("system.s.position", { v0: user.username })} disabled={busy} onClick={() => { setPositionUser(user); setNextPositions(user.position_ids || []); setError(''); setConflict(false); }}>{user.position_names?.join('、') || translate("system.no.position.assigned.please.fix.it")}</AntButton>}{user.role === 'employee' && <Select aria-label={translate("system.s.production.team", { v0: user.username })} value={user.production_group_id ?? ''} disabled={busy} onChange={value => run(() => api(`/users/${user.id}/production-group`, { method: 'PUT', body: { production_group_id: value ? Number(value) : null, version: user.permissions_version } }), translate("system.the.production.team.has.been.updated.and.the.permissions.will.take"))}><option value="">{translate("system.not.grouped")}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</Select>}</td>
            <td><div className="user-actions">
              <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => {
                if (window.confirm(translate("system.account.3", { v0: user.active ? translate("system.deactivate") : translate("system.activate"), v1: user.username }))) void update(user, { active: user.active ? 0 : 1 });
              }}>{user.active ? translate("system.deactivate") : translate("system.activate")}</AntButton>
              {user.role === 'employee' ? <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPermissionUser(user); setError(''); }}>{translate("system.view.permissions")}</AntButton> : <span className="muted">{translate("system.all.permissions")}</span>}
              <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResetUser(user); setResetPassword(''); setError(''); }}>{translate("system.reset.password")}</AntButton>
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {nameUser && <Modal title={translate("system.modify.the.name.of", { v0: nameUser.username })} onClose={() => { if (!busy) { setNameUser(null); setError(''); } }}>
      <div className="form-body account-fields"><label>{translate("system.name")}<AntInput maxLength={60} value={editName} disabled={busy} onChange={e => setEditName(e.target.value)} /></label>
        <p className="muted">{translate("system.if.left.blank.the.login.account.will.be.displayed.the.name")}</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
          await api(`/users/${nameUser.id}`, { method: 'PUT', body: { role: nameUser.role, active: nameUser.active, name: editName } });
          setNameUser(null);
        }, translate("system.name.updated"))}>{translate("system.save.name")}</AntButton>
      </div>
    </Modal>}
    {permissionUser && <Modal title={translate("system.effective.permissions.for", { v0: permissionUser.username })} className="permission-dialog" onClose={() => setPermissionUser(null)}>
      <div className="form-body"><p>{translate("system.position.2")}<strong>{permissionUser.position_names?.join('、') || translate("system.unassigned.position")}</strong></p><p className="muted">{translate("system.permissions.are.configured.uniformly.by.position.and.are.only.for.viewing")}</p><EffectivePermissions permissions={permissionUser.permissions} legacy={permissionUser.legacy_permissions} accessMode={permissionUser.access_mode} standardPermissions={permissionUser.standard_permissions} /></div>
    </Modal>}
    {positionUser && <Modal title={positionUser.downgrade ? translate("system.change.to.employee", { v0: positionUser.username }) : translate("system.adjust.s.position", { v0: positionUser.username })} onClose={() => { if (!busy) { setPositionUser(null); setError(''); setConflict(false); } }}>
      <div className="form-body account-fields"><p className="muted">{positionUser.downgrade ? translate("system.please.select.an.employee.position.first.after.modifying.the.role.the") : translate("system.the.permissions.for.the.selected.position.will.be.used.immediately.after")}</p>
        <PositionPicker label={translate("system.staff.positions")} positions={positions} value={nextPositions} disabled={busy} onChange={setNextPositions} />
        {!!nextPositions.length && <EffectivePermissions permissions={preview.permissions} legacy={preview.legacy_permissions} accessMode={preview.access_mode} standardPermissions={preview.standard_permissions} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {conflict && <AntButton htmlType="button" disabled={busy} onClick={() => run(async () => {
          const latest = (await load()).find(user => user.id === positionUser.id);
          if (!latest) throw new Error(translate("system.this.account.no.longer.exists.please.close.and.refresh.the.list"));
          if (latest.role !== positionUser.role) throw new Error(translate("system.the.account.role.has.been.changed.please.close.and.select.again"));
          setPositionUser(current => ({ ...current, ...latest }));
        }, translate("system.the.account.version.has.been.refreshed.and.the.position.selection.has"))}>{translate("system.refresh.version.and.keep.selection")}</AntButton>}
        <div className="permission-dialog-actions"><AntButton htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPositionUser(null); setError(''); }}>{translate("system.cancel")}</AntButton><AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => {
          if (!nextPositions.length) { setError(translate("system.please.select.a.staff.position")); return; }
          void run(async () => {
            await api(positionUser.downgrade ? `/users/${positionUser.id}` : `/users/${positionUser.id}/position`, { method: 'PUT', body: positionUser.downgrade ? { role: 'employee', active: positionUser.active, position_ids: nextPositions } : { position_ids: nextPositions, version: positionUser.permissions_version } });
            setPositionUser(null);
          }, translate("system.the.position.has.been.updated.and.the.permissions.will.take.effect"));
        }}>{translate("system.save.post")}</AntButton></div>
      </div>
    </Modal>}
    {resetUser && <Modal title={`${translate("system.reset")} ${resetUser.username} ${translate("system.password.2")}`} onClose={() => { if (!busy) { setResetUser(null); setResetPassword(''); setError(''); } }}>
      <div className="form-body account-fields">
        <label>{translate("system.password.after.reset")}<AntInput type="password" autoComplete="new-password" maxLength={128} value={resetPassword} onChange={e => setResetPassword(e.target.value)} disabled={busy} /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => {
          if (window.confirm(translate("system.reset.s.password.and.log.out.of.all.devices.with.this", { v0: resetUser.username }))) void run(async () => {
            await api(`/users/${resetUser.id}/password`, { method: 'POST', body: { password: resetPassword } });
            setResetUser(null); setResetPassword('');
          }, translate("system.password.reset"));
        }}>{translate("system.confirm.password.reset")}</AntButton>
        <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setResetUser(null); setResetPassword(''); setError(''); }}>{translate("system.cancel.reset")}</AntButton>
      </div>
    </Modal>}
  </section>;
}
