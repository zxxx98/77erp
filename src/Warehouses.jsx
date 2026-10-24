import { ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput, Radio as AntRadio, Button as AntButton, Checkbox as AntCheckbox } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import React, { useRef, useState } from 'react';
import { api, getWarehouseId } from './api.js';

export function WarehouseManager({ warehouses, onRefresh, onBusy }) {
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
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const remove = async warehouse => {
    if (lock.current || !window.confirm(`确定删除仓库「${warehouse.name}」？该仓库的物料档案、分类、全部历史单据（含退货和作废单据）、盘点／报损记录、收付款记录、模板及出入库二维码（含使用记录）将一并永久删除，无法恢复。所有物料库存均为 0 时才可删除。${warehouse.id === getWarehouseId() ? '删除后将切换到主仓库。' : ''}`)) return;
    lock.current = true;
    setBusy(true); onBusy?.(true); setError('');
    try {
      await api(`/warehouses/${warehouse.id}`, { method: 'DELETE', body: {} });
      setEditing(null);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  return <section className="operation-panel">
    <h3>仓库管理</h3>
    {busy && <p><LoadingStatus>正在处理仓库…</LoadingStatus></p>}
    <p>新增仓库后可在页面顶部切换。分类、物料、库存、单据和模板按仓库独立管理。</p>
    <label>新仓库名称<AntInput maxLength={60} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
    <AntConfigProvider componentDisabled={busy}><fieldset className="warehouse-reuse" disabled={busy}>
      <legend>是否复用当前仓库「{current?.name}」的物料分类和物料信息？</legend>
      <AntRadio  name="warehouse-reuse" checked={!reuseCatalog} onChange={() => setReuseCatalog(false)}>不复用，创建空仓库</AntRadio>
      <AntRadio  name="warehouse-reuse" checked={reuseCatalog} onChange={() => setReuseCatalog(true)}>复用分类和物料信息</AntRadio>
      <p>复用全部分类及物料档案（含停用状态），新仓库库存为 0，不复制单据、盘点记录、模板和出入库二维码。后续修改独立保存，可手动选择跨仓库同步。</p>
    </fieldset></AntConfigProvider>
    <AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={busy || !name.trim()} onClick={() => save(null, name)}>新增仓库</AntButton>
    <p>主仓库保留；其他仓库所有物料库存均为 0 时可删除，其档案、业务历史及配置会一并永久清除。</p>
    {warehouses.map(w => <div className="warehouse-row" key={w.id}>
      {editing?.id === w.id
        ? <AntInput aria-label={`修改${w.name}名称`} maxLength={60} value={editing.name} disabled={busy} onChange={e => setEditing({ ...editing, name: e.target.value })} />
        : <strong>{w.name}</strong>}
      <div className="warehouse-row-actions">
        {editing?.id === w.id
          ? <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => save(w.id, editing.name)}>保存名称</AntButton>
          : <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => setEditing({ ...w })}>改名</AntButton>}
        {w.id !== 1 && <AntButton type="default" htmlType="button" className="btn" disabled={busy} aria-label={`删除仓库 ${w.name}`} onClick={() => remove(w)}>删除仓库</AntButton>}
      </div>
    </div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function ProductSync({ warehouses, warehouseId, targets, setTargets, disabled }) {
  const others = warehouses.filter(w => w.id !== warehouseId);
  if (!others.length) return <div className="info-box">在系统设置中新增仓库后，可选择将物料同步到其他仓库。</div>;
  return <AntConfigProvider componentDisabled={disabled}><fieldset className="product-sync" disabled={disabled}>
    <legend>同步到其他仓库（选填）</legend>
    <p>本次保存同步物料档案和参考价格，并在目标仓库匹配或创建对应分类路径。目标仓库新物料库存为 0；已有物料保留各自库存和成本。未勾选的仓库保留原档案。</p>
    {others.map(w => <AntCheckbox key={w.id} checked={targets.includes(w.id)} onChange={e => setTargets(e.target.checked ? [...targets, w.id] : targets.filter(id => id !== w.id))}>{w.name}</AntCheckbox>)}
  </fieldset></AntConfigProvider>;
}
