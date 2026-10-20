import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { Dropdown } from './Dropdown.jsx';
import './customer-part-numbers.css';

export function CustomerPartNumbersEditor({ value = [], onChange, disabled }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    api('/contacts', { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted) setContacts(rows.filter(c => c.role === 'customer'));
    }).catch(e => { if (!controller.signal.aborted) setLoadError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const update = (index, patch) => { setError(''); onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row)); };
  const confirm = index => {
    const row = value[index];
    const part_number = row.part_number.trim();
    if (!row.customer_id || !part_number) { setError('请选择客户并填写客户料号。'); return; }
    if (value.some((other, i) => i !== index && other.customer_id === row.customer_id && other.part_number.trim() === part_number)) {
      setError('同一客户的料号不能重复。'); return;
    }
    update(index, { part_number, _editing: false });
  };
  return <section className="customer-parts-editor" aria-label="客户料号配置">
    <div className="customer-parts-heading"><h3>客户料号配置</h3><button type="button" className="btn btn-secondary" disabled={disabled || value.length >= 100} onClick={() => {
      setError(''); onChange([...value, { customer_id: '', customer_name: '', part_number: '', _editing: true }]);
    }}><Plus size={16} aria-hidden="true" />增加客户料号</button></div>
    <p className="customer-parts-hint">选择客户并填写料号，点击勾选确认后随物料一起保存。</p>
    {loadError && <div className="form-error" role="alert">{loadError} <button type="button" className="btn btn-secondary" onClick={() => setAttempt(n => n + 1)}>重新加载客户</button></div>}
    {!loading && !loadError && !contacts.some(c => c.active) && <p className="customer-parts-hint">暂无已启用客户，请先在往来单位中添加客户。</p>}
    {value.length > 0 && <div className="customer-parts-labels" aria-hidden="true"><span>客户</span><span>客户料号</span></div>}
    <div className="customer-parts-list">{value.map((row, index) => <div className="customer-parts-row" key={index}>
      {row._editing ? <>
        <Dropdown label={`客户 ${index + 1}`} searchable placeholder="选择客户" loading={loading} disabled={disabled || !!loadError}
          value={row.customer_id} options={contacts.filter(c => c.active || c.id === row.customer_id).map(c => ({ value: c.id, label: `${c.name}${c.active ? '' : '（已停用）'}`, disabled: !c.active }))}
          onSelect={option => update(index, { customer_id: Number(option.value), customer_name: contacts.find(c => c.id === Number(option.value))?.name || '' })} />
        <input aria-label={`客户料号 ${index + 1}`} maxLength={100} placeholder="输入客户料号" value={row.part_number} disabled={disabled}
          onChange={e => update(index, { part_number: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); confirm(index); } }} />
      </> : <><span className="customer-parts-name">{contacts.find(c => c.id === row.customer_id)?.name || row.customer_name}</span><strong className="customer-parts-number">{row.part_number}</strong></>}
      <div className="customer-parts-actions">
        <button type="button" className="icon-button" aria-label={`${row._editing ? '确认' : '编辑'}客户料号 ${index + 1}`} title={row._editing ? '确认录入' : '编辑料号'} disabled={disabled || (row._editing && (loading || !!loadError))} onClick={() => row._editing ? confirm(index) : update(index, { _editing: true })}>
          {row._editing ? <Check size={18} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-button" aria-label={`移除客户料号 ${index + 1}`} title="移除料号" disabled={disabled} onClick={() => { setError(''); onChange(value.filter((_, i) => i !== index)); }}><Trash2 size={16} aria-hidden="true" /></button>
      </div>
    </div>)}</div>
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>;
}

export function CustomerPartNumbersDetail({ value = [] }) {
  if (!value.length) return null;
  return <section className="customer-parts-detail" aria-label="客户料号"><h4>客户料号</h4>
    <dl>{value.map(row => <div key={JSON.stringify([row.customer_id, row.part_number])}><dt>{row.customer_name}</dt><dd>{row.part_number}</dd></div>)}</dl>
  </section>;
}
