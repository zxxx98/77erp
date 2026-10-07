import React, { useState } from 'react';
import { api } from './api.js';

export function WarehouseManager({ warehouses, onRefresh }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (id, value) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(id ? `/warehouses/${id}` : '/warehouses', { method: id ? 'PUT' : 'POST', body: { name: value } });
      setName(''); setEditing(null);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="operation-panel">
    <h3>仓库管理</h3>
    <p>新增仓库后可在页面顶部切换。库存、单据和草稿按仓库独立管理。</p>
    <label>新仓库名称<input maxLength={60} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
    <button type="button" className="btn btn-secondary" disabled={busy || !name.trim()} onClick={() => save(null, name)}>新增仓库</button>
    {warehouses.map(w => <div className="warehouse-row" key={w.id}>
      {editing?.id === w.id ? <>
        <input aria-label={`修改${w.name}名称`} maxLength={60} value={editing.name} disabled={busy} onChange={e => setEditing({ ...editing, name: e.target.value })} />
        <button type="button" className="btn" disabled={busy} onClick={() => save(w.id, editing.name)}>保存名称</button>
      </> : <><strong>{w.name}</strong><button type="button" className="btn" disabled={busy} onClick={() => setEditing({ ...w })}>改名</button></>}
    </div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function ProductSync({ warehouses, warehouseId, targets, setTargets, disabled }) {
  const others = warehouses.filter(w => w.id !== warehouseId);
  if (!others.length) return <div className="info-box">在系统设置中新增仓库后，可选择将商品同步到其他仓库。</div>;
  return <fieldset className="product-sync" disabled={disabled}>
    <legend>同步到其他仓库（选填）</legend>
    <p>本次保存同步商品档案和参考价格。目标仓库新商品库存为 0；已有商品保留各自库存和成本。未勾选的仓库保留原档案。</p>
    {others.map(w => <label key={w.id}><input type="checkbox" checked={targets.includes(w.id)} onChange={e => setTargets(e.target.checked ? [...targets, w.id] : targets.filter(id => id !== w.id))} />{w.name}</label>)}
  </fieldset>;
}
