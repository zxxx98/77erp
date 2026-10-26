import { useMemo, useState } from 'react';
import { useQuery, queryPath } from '../queries.js';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { Button, QueryStatus } from '../components/common.jsx';
import { ProcessGraph } from './ProcessGraph.jsx';

export function RoutePicker({ value, onChange, warehouseId, inherit = false, inheritedValue = null, disabled = false }) {
  useLocale();
  const [q, setQ] = useState(''), [preview, setPreview] = useState(false);
  const data = useMemo(() => ({ warehouse_id: warehouseId }), [warehouseId]);
  const list = useQuery(queryPath('/process-routes', { q, limit: 100 }), data, 150);
  const effectiveId = value ?? (inherit ? inheritedValue : null);
  const current = useQuery(effectiveId ? `/process-routes/${effectiveId}` : null, data);
  const options = (list.result?.routes || []).filter(route => route.enabled || route.id === value);
  const chosen = current.result || options.find(route => route.id === effectiveId);
  return <div className="process-picker">
    <Input type="search" aria-label={t('route.search')} placeholder={t('route.search')} value={q} disabled={disabled} onChange={event => setQ(event.target.value)} />
    <Select aria-label={t(inherit ? 'route.override' : 'route.default')} value={value ?? ''} disabled={disabled || !!list.error} onChange={next => { onChange(next === '' ? null : Number(next)); setPreview(false); }}>
      <option value="">{t(inherit ? 'route.inherit' : 'route.none')}{inherit && !value && chosen ? ` · ${chosen.name}` : ''}</option>
      {value && !options.some(route => route.id === value) && <option value={value}>{chosen?.name || t('route.selected', { id: value })}</option>}
      {options.map(route => <option key={route.id} value={route.id}>{route.name}{!route.enabled ? ` · ${t('route.disabled')}` : ''}</option>)}
    </Select>
    <QueryStatus query={list} />
    {effectiveId && <Button disabled={disabled || !chosen} onClick={() => setPreview(!preview)}>{t(preview ? 'route.close' : 'route.view')}</Button>}
    {preview && chosen && <div className="process-picker-preview"><strong>{chosen.name}</strong><ProcessGraph graph={chosen.graph} /></div>}
  </div>;
}
