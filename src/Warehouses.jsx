import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput, Radio as AntRadio, Button as AntButton, Checkbox as AntCheckbox } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import React, { useRef, useState } from 'react';
import { api, getWarehouseId } from './api.js';

export function WarehouseManager({ warehouses, onRefresh, onBusy }) {
  useLocale();
  const [name, setName] = useState('');
  const [reuseCatalog, setReuseCatalog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const current = warehouses.find(w => w.id === getWarehouseId());
  const save = async (id, value) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); onBusy?.(true); setError('');
    try {
      await api(id ? `/warehouses/${id}` : '/warehouses', { method: id ? 'PUT' : 'POST', body: { name: value, ...(!id ? { reuse_catalog: reuseCatalog } : {}) } });
      setName(''); setEditing(null);
      await onRefresh();
    } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const remove = async warehouse => {
    if (lock.current || !window.confirm(translate("system.are.you.sure.you.want.to.delete.the.warehouse.the.warehouse", { v0: warehouse.name, v1: warehouse.id === getWarehouseId() ? translate("system.after.deletion.it.will.switch.to.the.main.warehouse") : '' }))) return;
    lock.current = true;
    setBusy(true); onBusy?.(true); setError('');
    try {
      await api(`/warehouses/${warehouse.id}`, { method: 'DELETE', body: {} });
      setEditing(null);
      await onRefresh();
    } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  return <section className="operation-panel">
    <h3>{translate("system.warehouse.management")}</h3>
    {busy && <p><LoadingStatus>{translate("system.processing.warehouse")}</LoadingStatus></p>}
    <p>{translate("system.after.adding.a.new.warehouse.you.can.switch.it.at.the")}</p>
    <label>{translate("system.new.warehouse.name")}<AntInput maxLength={60} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
    <AntConfigProvider componentDisabled={busy}><fieldset className="warehouse-reuse" disabled={busy}>
      <legend>{translate("system.whether.to.reuse.the.current.warehouse")}{current?.name}{translate("system.material.classification.and.material.information")}</legend>
      <AntRadio  name="warehouse-reuse" checked={!reuseCatalog} onChange={() => setReuseCatalog(false)}>{translate("system.no.reuse.create.an.empty.warehouse")}</AntRadio>
      <AntRadio  name="warehouse-reuse" checked={reuseCatalog} onChange={() => setReuseCatalog(true)}>{translate("system.reuse.classification.and.material.information")}</AntRadio>
      <p>{translate("system.reuse.all.classification.and.material.files.including.deactivated.status.the.new")}</p>
    </fieldset></AntConfigProvider>
    <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy || !name.trim()} onClick={() => save(null, name)}>{translate("system.add.new.warehouse")}</AntButton>
    <p>{translate("system.the.main.warehouse.is.retained.all.material.inventories.in.other.warehouses")}</p>
    {warehouses.map(w => <div className="warehouse-row" key={w.id}>
      {editing?.id === w.id
        ? <AntInput aria-label={translate("system.modify.name.2", { v0: w.name })} maxLength={60} value={editing.name} disabled={busy} onChange={e => setEditing({ ...editing, name: e.target.value })} />
        : <strong>{w.name}</strong>}
      <div className="warehouse-row-actions">
        {editing?.id === w.id
          ? <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => save(w.id, editing.name)}>{translate("system.save.name")}</AntButton>
          : <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => setEditing({ ...w })}>{translate("system.change.name")}</AntButton>}
        {w.id !== 1 && <AntButton type="default" htmlType="button" className="btn" disabled={busy} aria-label={translate("system.delete.warehouse", { v0: w.name })} onClick={() => remove(w)}>{translate("system.delete.warehouse.2")}</AntButton>}
      </div>
    </div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function ProductSync({ warehouses, warehouseId, targets, setTargets, disabled }) {
  useLocale();
  const others = warehouses.filter(w => w.id !== warehouseId);
  if (!others.length) return <div className="info-box">{translate("system.after.adding.a.warehouse.in.the.system.settings.you.can.choose")}</div>;
  return <AntConfigProvider componentDisabled={disabled}><fieldset className="product-sync" disabled={disabled}>
    <legend>{translate("system.synchronize.to.other.warehouses.optional")}</legend>
    <p>{translate("system.this.time.the.synchronized.material.files.and.reference.prices.are.saved")}</p>
    {others.map(w => <AntCheckbox key={w.id} checked={targets.includes(w.id)} onChange={e => setTargets(e.target.checked ? [...targets, w.id] : targets.filter(id => id !== w.id))}>{w.name}</AntCheckbox>)}
  </fieldset></AntConfigProvider>;
}
