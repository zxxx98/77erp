import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Button as AntButton, Input as AntInput } from './ui/controls.jsx';

import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { Dropdown } from './Dropdown.jsx';
import './customer-part-numbers.css';

export function CustomerPartNumbersEditor({ value = [], onChange, disabled }) {
  useLocale();
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
    }).catch(e => { if (!controller.signal.aborted) setLoadError(localizeError(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const update = (index, patch) => { setError(''); onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row)); };
  const confirm = index => {
    const row = value[index];
    const part_number = row.part_number.trim();
    if (!row.customer_id || !part_number) { setError(translate("warehouse.please.select.the.customer.and.fill.in.the.customer.material.number")); return; }
    if (value.some((other, i) => i !== index && other.customer_id === row.customer_id && other.part_number.trim() === part_number)) {
      setError(translate("warehouse.the.material.number.of.the.same.customer.cannot.be.repeated")); return;
    }
    update(index, { part_number, _editing: false });
  };
  return <section className="customer-parts-editor" aria-label={translate("warehouse.customer.material.number.configuration")}>
    <div className="customer-parts-heading"><h3>{translate("warehouse.customer.material.number.configuration")}</h3><AntButton type="default" htmlType="button" className="btn btn-secondary" disabled={disabled || value.length >= 100} onClick={() => {
      setError(''); onChange([...value, { customer_id: '', customer_name: '', part_number: '', _editing: true }]);
    }}><Plus size={16} aria-hidden="true" />{translate("warehouse.add.customer.material.number")}</AntButton></div>
    <p className="customer-parts-hint">{translate("warehouse.select.the.customer.and.fill.in.the.material.number.click.to")}</p>
    {loadError && <div className="form-error" role="alert">{loadError} <AntButton type="default" htmlType="button" className="btn btn-secondary" onClick={() => setAttempt(n => n + 1)}>{translate("warehouse.reload.client")}</AntButton></div>}
    {!loading && !loadError && !contacts.some(c => c.active) && <p className="customer-parts-hint">{translate("warehouse.there.are.currently.no.activated.customers.please.add.customers.in.the")}</p>}
    {value.length > 0 && <div className="customer-parts-labels" aria-hidden="true"><span>{translate("warehouse.customer")}</span><span>{translate("warehouse.customer.part.number")}</span></div>}
    <div className="customer-parts-list">{value.map((row, index) => <div className="customer-parts-row" key={index}>
      {row._editing ? <>
        <Dropdown label={translate("warehouse.customer.2", { v0: index + 1 })} searchable placeholder={translate("warehouse.select.customer")} loading={loading} disabled={disabled || !!loadError}
          value={row.customer_id} options={contacts.filter(c => c.active || c.id === row.customer_id).map(c => ({ value: c.id, label: `${c.name}${c.active ? '' : translate("warehouse.deactivated.2")}`, disabled: !c.active }))}
          onSelect={option => update(index, { customer_id: Number(option.value), customer_name: contacts.find(c => c.id === Number(option.value))?.name || '' })} />
        <AntInput aria-label={translate("warehouse.customer.part.number.2", { v0: index + 1 })} maxLength={100} placeholder={translate("warehouse.enter.customer.item.number")} value={row.part_number} disabled={disabled}
          onChange={e => update(index, { part_number: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); confirm(index); } }} />
      </> : <><span className="customer-parts-name">{contacts.find(c => c.id === row.customer_id)?.name || row.customer_name}</span><strong className="customer-parts-number">{row.part_number}</strong></>}
      <div className="customer-parts-actions">
        <AntButton type="text" htmlType="button" className="icon-button" aria-label={translate("warehouse.customer.part.number.3", { v0: row._editing ? translate("warehouse.confirm") : translate("warehouse.edit"), v1: index + 1 })} title={row._editing ? translate("warehouse.confirm.entry") : translate("warehouse.edit.item.number")} disabled={disabled || (row._editing && (loading || !!loadError))} onClick={() => row._editing ? confirm(index) : update(index, { _editing: true })}>
          {row._editing ? <Check size={18} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
        </AntButton>
        <AntButton type="text" htmlType="button" className="icon-button" aria-label={translate("warehouse.remove.customer.item.number", { v0: index + 1 })} title={translate("warehouse.remove.item.number")} disabled={disabled} onClick={() => { setError(''); onChange(value.filter((_, i) => i !== index)); }}><Trash2 size={16} aria-hidden="true" /></AntButton>
      </div>
    </div>)}</div>
    {error && <div className="form-error" role="alert">{error}</div>}
  </section>;
}

export function CustomerPartNumbersDetail({ value = [] }) {
  useLocale();
  if (!value.length) return null;
  return <section className="customer-parts-detail" aria-label={translate("warehouse.customer.part.number")}><h4>{translate("warehouse.customer.part.number")}</h4>
    <dl>{value.map(row => <div key={JSON.stringify([row.customer_id, row.part_number])}><dt>{row.customer_name}</dt><dd>{row.part_number}</dd></div>)}</dl>
  </section>;
}
