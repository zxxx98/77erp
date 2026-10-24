import { useEffect, useRef, useState } from 'react';
import { api, setWarehouseId } from '../api.js';
import { PermissionContext } from '../permissions.jsx';
import { Production, ChangePassword } from '../LazyComponents.jsx';
import { Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { useDataUpdates, DataUpdateNotice } from '../DataUpdates.jsx';
import { LoadingIndicator } from '../Loading.jsx';
import './production-only.css';

export function ProductionOnlyShell({ admin, onLogout }) {
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
    } catch (e) { if (request === generation.current) setError(e.message); }
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
    <header className="production-only-header"><div><strong>77 ERP · 仅生产作业</strong><p>{user.name || user.username} · {user.production_group_name || '未分组'}</p></div><div className="production-only-actions">
      {data && <label>当前仓库<Select aria-label="当前仓库" disabled={busy} value={data.warehouse_id} onChange={async value => { if (!window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) return; setWarehouseId(Number(value)); await load(); }} >{data.warehouses?.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</Select></label>}
      <Button disabled={busy} onClick={() => { if (window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) setPassword(!password); }}>{password ? '返回生产单' : '修改密码'}</Button><Button onClick={async () => { if (window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) { try { await onLogout(); } catch (e) { setError(e.message); } } }}>退出登录</Button>
    </div></header>
    <main>{updatesAvailable && <DataUpdateNotice onRefresh={load} busy={busy} />}{error && <p role="alert" className="form-error">{error}</p>}{!data ? <div role="status"><LoadingIndicator />正在读取生产工作空间…<Button onClick={load} disabled={busy}>重新连接</Button></div> : password ? <section className="panel bom-section"><ChangePassword onChanged={onLogout} /></section> : <Production key={`${data.warehouse_id}:${user.permissions_version}`} data={data} onChanged={load} onSwitchWarehouse={switchWarehouse} />}</main>
  </div></PermissionContext.Provider>;
}
