import { localizeError } from '../i18n/errors.js';
import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useRef, useState } from 'react';
import { api, setWarehouseId } from '../api.js';
import { PermissionContext } from '../permissions.jsx';
import { Production, ChangePassword, UserPreferences } from '../LazyComponents.jsx';
import { Button, Modal } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { useDataUpdates, DataUpdateNotice } from '../DataUpdates.jsx';
import { LoadingIndicator } from '../Loading.jsx';
import { mobileDevice } from '../device.js';
import './production-only.css';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.jsx';

export function ProductionOnlyShell({ admin, onLogout }) {
  useLocale();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  useEffect(() => {
    if (!mobileDevice || !preferencesOpen) return;
    const marker = `preferences-${Date.now()}`;
    history.pushState({ ...history.state, erpPreferences: marker }, '', location.href);
    const back = event => {
      if (history.state?.erpPreferences === marker) return;
      event.stopImmediatePropagation();
      setPreferencesOpen(false);
    };
    window.addEventListener('popstate', back, true);
    return () => {
      window.removeEventListener('popstate', back, true);
      if (history.state?.erpPreferences === marker) history.back();
    };
  }, [preferencesOpen]);
  const [data, setData] = useState(null), [error, setError] = useState(''), [password, setPassword] = useState(false), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = async () => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      let workspace;
      try { workspace = await api('/workspace'); }
      catch (e) { if (e.status !== 400) throw e; workspace = await api('/workspace', { warehouseId: 1 }); }
      if (request !== generation.current) return;
      setWarehouseId(workspace.warehouse_id); setData(workspace);
    } catch (e) { if (request === generation.current) setError(localizeError(e.message)); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const switchWarehouse = async id => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const workspace = await api('/workspace', { warehouseId: id });
      if (request !== generation.current) return false;
      setWarehouseId(workspace.warehouse_id); setData(workspace); setPassword(false);
      return true;
    } finally { if (request === generation.current) setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const user = data?.user || admin;
  const updatesAvailable = useDataUpdates(data || {}, admin.id);
  return <PermissionContext.Provider value={user}><div className="production-only-shell">
    <header className="production-only-header"><div><strong>{translate("system.77.erp.production.operations.only")}</strong><p>{user.name || user.username} · {user.production_group_name || translate("system.not.grouped")}</p></div><div className="production-only-actions">
      <Button onClick={() => setPreferencesOpen(true)}>{translate("system.preferences")}</Button>
      {data && <label>{translate("system.current.warehouse")}<Select aria-label={translate("system.current.warehouse")} disabled={busy} value={data.warehouse_id} onChange={async value => { if (!window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) return; setWarehouseId(Number(value)); await load(); }} >{data.warehouses?.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select></label>}
      <Button disabled={busy} onClick={() => { if (window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) setPassword(!password); }}>{password ? translate("system.return.to.production.order") : translate("system.change.password")}</Button><Button onClick={async () => { if (window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) { try { await onLogout(); } catch (e) { setError(localizeError(e.message)); } } }}>{translate("system.sign.out")}</Button>
      <LanguageSwitcher compact={mobileDevice} />
    </div></header>
    <main>{updatesAvailable && <DataUpdateNotice onRefresh={load} busy={busy} />}{error && <p role="alert" className="form-error">{error}</p>}{!data ? <div role="status"><LoadingIndicator />{translate("system.reading.production.workspace")}<Button onClick={load} disabled={busy}>{translate("system.reconnect")}</Button></div> : password ? <section className="panel bom-section"><ChangePassword onChanged={onLogout} /></section> : <Production key={`${data.warehouse_id}:${user.permissions_version}`} data={data} onChanged={load} onSwitchWarehouse={switchWarehouse} />}</main>
    {preferencesOpen && <Modal title={translate("system.preferences")} onClose={() => setPreferencesOpen(false)}><div className="form-body"><UserPreferences showTitle={false} /></div></Modal>}
  </div></PermissionContext.Provider>;
}
