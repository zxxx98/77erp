import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { useEffect, useRef, useState } from 'react';
import { Select } from './Dropdown.jsx';
import { Input, Button, Checkbox } from './ui/controls.jsx';
import { api } from './api.js';
import { permissionOptions } from './i18n/display.js';
import { LoadingStatus } from './Loading.jsx';
import './users.css';

export function EffectivePermissions({ permissions = [], legacy = false, accessMode = 'standard', standardPermissions = [] }) {
  useLocale();
  return <div className="effective-permissions">
    {legacy && <p className="info-box">{translate("system.inherit.the.old.employee.permissions.retain.historical.operation.restrictions.the.following")}</p>}
    <p className="muted">{accessMode === 'production_only' ? translate("system.production.operations.only.only.view.the.production.orders.and.registration.batches") : permissions.includes('basic_view') ? translate("system.materials.inventory.historical.documents.and.qr.code.queries.can.be.viewed") : translate("system.basic.pages.require.permission")}</p>
    {permissions.length ? <ul>{permissionOptions.filter(option => permissions.includes(option.key)).map(option => <li key={option.key}><strong>{option.label}</strong>{(!legacy || standardPermissions.includes(option.key)) && <small>{option.description}</small>}</li>)}</ul> : <p>{translate("system.read.only.position.no.additional.business.operation.permissions")}</p>}
  </div>;
}
export function PositionManager({ Modal, onChanged }) {
  useLocale();
  const [positions, setPositions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = async () => { const rows = await api('/positions'); setPositions(rows); setLoaded(true); return rows; };
  useEffect(() => { load().catch(e => setError(localizeError(e.message))); }, []);
  const run = async (action, message) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setConflict(false);
    try { await action(); await load(); await onChanged?.(); setNotice(message); }
    catch (e) { setError(localizeError(e.message)); setConflict(e.status === 409); }
    finally { lock.current = false; setBusy(false); }
  };
  const open = position => { setError(''); setConflict(false); setEditor(position ? { ...position, permissions: [...position.permissions], convert_legacy: false } : { name: '', description: '', permissions: [], access_mode: 'standard', member_count: 0 }); };
  const refresh = () => run(async () => {
    const rows = await load();
    if (editor?.id) {
      const latest = rows.find(row => row.id === editor.id);
      if (!latest) throw new Error(translate("system.this.position.has.been.deleted.please.close.editing.and.select.the"));
      setEditor(current => ({ ...current, version: latest.version, member_count: latest.member_count, legacy_permissions: latest.legacy_permissions }));
    }
  }, translate("system.the.latest.version.has.been.refreshed.and.the.edited.content.has"));
  const save = () => {
    if (!editor.name.trim()) { setError(translate("system.please.fill.in.the.position.name")); return; }
    void run(async () => {
      await api(editor.id ? `/positions/${editor.id}` : '/positions', { method: editor.id ? 'PUT' : 'POST', body: {
        name: editor.name, description: editor.description, permissions: editor.permissions, access_mode: editor.access_mode || 'standard',
        ...(editor.id ? { version: editor.version } : {}), ...(editor.convert_legacy ? { convert_legacy: true } : {}),
      } });
      setEditor(null);
    }, translate("system.the.position.has.been.saved.and.the.associated.employee.permissions.will"));
  };
  return <section aria-label={translate("system.position.configuration")} className="position-manager settings-list-layout">
    <div className="settings-section-heading"><h3>{translate("system.position.configuration")}</h3><p>{translate("system.each.employee.chooses.a.position.adjusting.position.permissions.will.affect.all")}</p></div>
    <Button type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => open(null)}>{translate("system.new.positions")}</Button>
    {busy && <p><LoadingStatus>{translate("system.updating.positions")}</LoadingStatus></p>}
    {!editor && error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loaded && !error && <p><LoadingStatus>{translate("system.loading.jobs")}</LoadingStatus></p>}
    {loaded && !positions.length && <p className="muted">{translate("system.there.are.currently.no.positions.please.add.new.positions.first.and")}</p>}
    {!!positions.length && <div className="user-list position-list"><table className="data-table position-table"><thead><tr><th>{translate("system.position")}</th><th>{translate("system.permissions")}</th><th>{translate("system.associated.employees")}</th><th>{translate("system.operation")}</th></tr></thead><tbody>
      {positions.map(position => <tr key={position.id} className="position-row"><td><strong>{position.name}</strong>{position.description && <small className="position-description">{position.description}</small>}</td>
        <td>{position.legacy_permissions && <strong className="position-legacy">{translate("system.old.permissions.compatible")}</strong>}<span>{position.permissions.length ? permissionOptions.filter(option => position.permissions.includes(option.key)).map(option => option.label).join('、') : translate("system.read.only")}</span></td>
        <td>{position.member_count}{" "}{translate("system.people")}</td><td><div className="position-actions"><Button htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => open(position)}>{translate("system.edit")}</Button><Button htmlType="button" className="btn btn-secondary" disabled={busy || position.member_count > 0} title={position.member_count ? translate("system.please.adjust.the.positions.of.all.employees.first.including.deactivated.accounts") : undefined} onClick={() => {
          if (window.confirm(translate("system.delete.post", { v0: position.name }))) void run(() => api(`/positions/${position.id}`, { method: 'DELETE', body: { version: position.version } }), translate("system.post.has.been.deleted"));
        }}>{translate("system.delete")}</Button></div>{position.member_count > 0 && <small className="position-delete-hint">{translate("system.there.is.an.employee.association.and.cannot.be.deleted.yet")}</small>}</td></tr>)}
    </tbody></table></div>}
    {!editor && conflict && <Button htmlType="button" className="btn" disabled={busy} onClick={refresh}>{translate("system.refresh.job.list")}</Button>}
    {editor && <Modal title={editor.id ? translate("system.editor.position", { v0: positions.find(row => row.id === editor.id)?.name || editor.name }) : translate("system.new.positions")} className="permission-dialog" onClose={() => { if (!busy) { setEditor(null); setError(''); setConflict(false); } }}>
      <div className="form-body"><div className="account-fields"><label>{translate("system.job.title")}<Input maxLength={60} value={editor.name} disabled={busy} onChange={e => setEditor(current => ({ ...current, name: e.target.value }))} /></label><label>{translate("system.job.description")}<Input.TextArea maxLength={200} rows={3} value={editor.description} disabled={busy} onChange={e => setEditor(current => ({ ...current, description: e.target.value }))} /></label></div>
      <p className="info-box">{translate("system.saving.will.synchronize.the.effects")}{" "}{editor.member_count}{" "}{translate("system.employees.including.deactivated.accounts")}</p>
      {editor.legacy_permissions && <div className="position-legacy-notice"><p>{translate("system.this.position.inherits.the.old.employee.permissions.modifying.only.the.name")}</p><Checkbox checked={!!editor.convert_legacy} disabled={busy} onChange={e => {
        if (!e.target.checked || window.confirm(translate("system.are.you.sure.you.want.to.switch.employees.in.this.position", { v0: editor.member_count }))) setEditor(current => ({ ...current, convert_legacy: e.target.checked }));
      }}>{translate("system.i.confirm.switching.to.standard.module.permissions")}</Checkbox></div>}
      <label>{translate("system.access.mode")}<Select aria-label={translate("system.access.mode")} value={editor.access_mode || 'standard'} disabled={busy || (editor.legacy_permissions && !editor.convert_legacy)} onChange={value => setEditor(current => ({ ...current, access_mode: value, permissions: value === 'production_only' ? ['production_register'] : current.permissions }))}><option value="standard">{translate("system.standard.workspace")}</option><option value="production_only">{translate("system.production.jobs.only")}</option></Select></label>
      {editor.access_mode === 'production_only' && <p className="info-box">{translate("system.only.production.orders.and.batch.registration.for.this.group.are.open")}</p>}
      <div className="permission-options">{permissionOptions.map(option => <Checkbox key={option.key} checked={editor.permissions.includes(option.key)} disabled={busy || (editor.access_mode === 'production_only' && option.key !== 'operation_accept') || (editor.legacy_permissions && !editor.convert_legacy)} onChange={e => setEditor(current => ({ ...current, permissions: e.target.checked ? [...current.permissions, option.key] : current.permissions.filter(key => key !== option.key) }))}><span><strong>{option.label}</strong><small>{option.description}</small></span></Checkbox>)}</div>
      {!editor.permissions.length && <p className="muted">{translate("system.when.the.business.module.is.not.checked.this.position.is.a")}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {conflict && <Button htmlType="button" className="btn" disabled={busy} onClick={refresh}>{translate("system.refresh.version.and.preserve.input")}</Button>}
      <div className="permission-dialog-actions"><Button htmlType="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditor(null); setError(''); setConflict(false); }}>{translate("system.cancel")}</Button><Button type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={save}>{translate("system.save.post")}</Button></div>
      </div>
    </Modal>}
  </section>;
}
