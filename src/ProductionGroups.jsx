import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Input, Button } from './ui/controls.jsx';
import './users.css';

export function ProductionGroupManager({ onChanged }) {
  useLocale();
  const [groups, setGroups] = useState([]), [editor, setEditor] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = async () => setGroups(await api('/production-groups'));
  useEffect(() => { load().catch(e => setError(localizeError(e.message))); }, []);
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await load(); await onChanged?.(); }
    catch (e) { setError(localizeError(e.message)); }
    finally { setBusy(false); }
  };
  return <section aria-label={translate("system.production.team.configuration")} className="position-manager settings-list-layout">
    <div className="settings-section-heading"><h3>{translate("system.production.team.configuration")}</h3><p>{translate("system.each.employee.can.choose.a.group.the.group.itself.does.not")}</p></div>
    <Button htmlType="button" disabled={busy} onClick={() => setEditor({ name: '', description: '' })}>{translate("system.add.new.production.team")}</Button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {editor && <div className="account-fields"><label>{translate("system.group.name")}<Input maxLength={60} value={editor.name} disabled={busy} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label><label>{translate("system.group.description")}<Input.TextArea maxLength={200} value={editor.description} disabled={busy} onChange={e => setEditor({ ...editor, description: e.target.value })} /></label><div className="position-actions"><Button htmlType="button" disabled={busy || !editor.name.trim()} onClick={() => run(async () => { await api(editor.id ? `/production-groups/${editor.id}` : '/production-groups', { method: editor.id ? 'PUT' : 'POST', body: editor }); setEditor(null); })}>{translate("system.save.group")}</Button><Button htmlType="button" disabled={busy} onClick={() => setEditor(null)}>{translate("system.cancel")}</Button></div></div>}
    <div className="user-list"><table className="data-table"><thead><tr><th>{translate("system.group.2")}</th><th>{translate("system.description")}</th><th>{translate("system.operation")}</th></tr></thead><tbody>{groups.map(group => <tr key={group.id}><td>{group.name}</td><td>{group.description || '—'}</td><td><div className="position-actions"><Button htmlType="button" disabled={busy} onClick={() => { setEditor({ ...group }); setError(''); }}>{translate("system.edit")}</Button><Button htmlType="button" disabled={busy} onClick={() => { if (window.confirm(translate("system.delete.production.team.it.cannot.be.deleted.if.there.are.employees", { v0: group.name }))) run(() => api(`/production-groups/${group.id}`, { method: 'DELETE', body: { version: group.version } })); }}>{translate("system.delete")}</Button></div></td></tr>)}</tbody></table></div>
    {!groups.length && <p className="muted">{translate("system.there.is.currently.no.production.team")}</p>}
  </section>;
}
